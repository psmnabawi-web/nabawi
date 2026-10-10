const {setGlobalOptions} = require('firebase-functions/v2');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const {getStorage} = require('firebase-admin/storage');
const sharp = require('sharp');
const {CONTROL_POINTS} = require('./control-points');
const aiModule = require('./ai');
const {clamp, safeShort} = aiModule;

// Bucket Storage: dari FIREBASE_CONFIG (deploy via firebase CLI) atau nama default project (deploy via gcloud).
function defaultBucket(){
  try{const cfg=JSON.parse(process.env.FIREBASE_CONFIG||'{}');if(cfg.storageBucket)return cfg.storageBucket}catch{}
  const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||'';
  return process.env.STORAGE_BUCKET||(project?`${project}.firebasestorage.app`:undefined);
}
initializeApp({storageBucket:defaultBucket()});
setGlobalOptions({region:'asia-southeast1', memory:'1GiB', timeoutSeconds:120, maxInstances:10});

const POINT_MAP = Object.fromEntries(CONTROL_POINTS.map(x=>[x.id,x]));
const TOTAL_WEIGHT = CONTROL_POINTS.reduce((s,x)=>s+x.weight,0);
const AREA_LIST = [...new Set(CONTROL_POINTS.map(x=>x.area))];
function escXml(s=''){return String(s).replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','\"':'&quot;'}[c]))}
function zoneParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
}
const SHIFT_RULES={
  SHIFT_1:{label:'Shift 1',cutoff:'12:00',hour:12,minute:0,second:59},
  SHIFT_2:{label:'Shift 2',cutoff:'17:00',hour:17,minute:0,second:59},
  SHIFT_3:{label:'Shift 3',cutoff:'23:59',hour:23,minute:59,second:59}
};
function operationalMetaWib(date=new Date()){
  const p=zoneParts(date),hour=Number(p.hour),minute=Number(p.minute),second=Number(p.second),calendarDate=`${p.year}-${p.month}-${p.day}`,sec=hour*3600+minute*60+second;
  let slot='SHIFT_3';
  if(sec<=12*3600+59)slot='SHIFT_1';else if(sec<=17*3600+59)slot='SHIFT_2';
  return{slot,slotLabel:SHIFT_RULES[slot].label,operationalDate:calendarDate,calendarDate,secondOfDay:sec};
}
function pseudoWibMs(date=new Date()){const p=zoneParts(date);return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second))}
function deadlineMeta(session,now=new Date()){
  const rule=SHIFT_RULES[session.slot];if(!rule)throw new Error('Shift session tidak dikenal.');
  const [y,m,d]=String(session.operationalDate||'').split('-').map(Number);if(!y||!m||!d)throw new Error('Tanggal session tidak valid.');
  const deadlinePseudo=Date.UTC(y,m-1,d,rule.hour,rule.minute,rule.second),nowPseudo=pseudoWibMs(now),diffMs=nowPseudo-deadlinePseudo;
  // Jakarta UTC+7, tidak memakai DST.
  const deadlineActual=new Date(Date.UTC(y,m-1,d,rule.hour-7,rule.minute,rule.second));
  return{deadlineTime:rule.cutoff,deadlineAt:Timestamp.fromDate(deadlineActual),onTime:diffMs<=0,latenessMinutes:diffMs>0?Math.ceil(diffMs/60000):0,deadlineDisplay:`${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y} ${rule.cutoff} WIB`};
}
function displayWib(date=new Date()){
  const p=zoneParts(date);return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} WIB`;
}
function scoreLabel(score){if(score>=95)return'EXCELLENT';if(score>=90)return'GOOD';if(score>=80)return'NEED IMPROVEMENT';return'CRITICAL'}
async function stampImage(buffer, lines){
  const base=sharp(buffer).rotate();
  const meta=await base.metadata();
  const width=Math.max(1,meta.width||1200);
  const height=Math.min(116,Math.max(74,Math.round((meta.height||800)*0.14)));
  const font1=Math.max(14,Math.min(24,Math.round(width/50)));
  const font2=Math.max(12,Math.min(20,Math.round(width/60)));
  const line1=escXml(safeShort(lines[0]||'',120));
  const line2=escXml(safeShort(lines[1]||'',120));
  const svg=Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#000" opacity="0.68"/>
    <text x="22" y="${Math.round(height*0.40)}" fill="#fff" font-size="${font1}" font-family="Arial, sans-serif" font-weight="700">${line1}</text>
    <text x="22" y="${Math.round(height*0.75)}" fill="#fff" font-size="${font2}" font-family="Arial, sans-serif">${line2}</text>
  </svg>`);
  return await base.composite([{input:svg,gravity:'south'}]).jpeg({quality:82,mozjpeg:true}).toBuffer();
}

function aggregate(results){
  const done=CONTROL_POINTS.filter(p=>results[p.id] && Number.isFinite(Number(results[p.id].score)));
  const weight=done.reduce((s,p)=>s+p.weight,0);
  const earned=done.reduce((s,p)=>s+p.weight*clamp(results[p.id].score,0,100)/100,0);
  const score=weight?+(earned/weight*100).toFixed(1):0;
  const areaScores={};
  for(const area of AREA_LIST){
    const pts=done.filter(p=>p.area===area),w=pts.reduce((s,p)=>s+p.weight,0),e=pts.reduce((s,p)=>s+p.weight*clamp(results[p.id].score,0,100)/100,0);
    areaScores[area]=w?+(e/w*100).toFixed(1):null;
  }
  const vals=done.map(p=>results[p.id]);
  const cleanCount=vals.filter(x=>x.status==='CLEAN').length;
  const needCleaningCount=vals.filter(x=>x.status==='NEED_CLEANING').length;
  const dirtyCount=vals.filter(x=>x.status==='DIRTY').length;
  const invalidCount=vals.filter(x=>x.status==='INVALID').length;
  return{completedCount:done.length,controlPointCount:CONTROL_POINTS.length,score,scoreLabel:scoreLabel(score),areaScores,cleanCount,needCleaningCount,dirtyCount,invalidCount,complete:done.length===CONTROL_POINTS.length};
}

exports.scoreEvidence = onCall({secrets:['GEMINI_API_KEY']},async request=>{
  const data=request.data||{};
  const sessionId=String(data.sessionId||'').trim();
  const pointId=String(data.pointId||'').trim();
  const rawPaths=Array.isArray(data.rawPaths)?data.rawPaths.map(String).slice(0,2):[];
  const point=POINT_MAP[pointId];
  if(!sessionId||!point||!rawPaths.length)throw new HttpsError('invalid-argument','Session, titik kontrol, atau foto tidak valid.');
  for(const p of rawPaths){
    const prefix=`audit-evidence-raw/${sessionId}/${pointId}/`;
    if(!p.startsWith(prefix))throw new HttpsError('permission-denied','Path evidence tidak sesuai session/titik kontrol.');
  }

  const db=getFirestore();
  const sessionRef=db.collection('audits').doc(sessionId);
  const sessionSnap=await sessionRef.get();
  if(!sessionSnap.exists)throw new HttpsError('failed-precondition','Session control belum dibuat.');
  const session=sessionSnap.data();
  if(session.scoringMode!=='AI_VISION_V1')throw new HttpsError('failed-precondition','Session bukan mode AI auto scoring.');
  const createdDate=session.createdAt?.toDate?.();
  if(createdDate){
    const official=operationalMetaWib(createdDate);
    if(session.slot!==official.slot||session.operationalDate!==official.operationalDate){
      throw new HttpsError('failed-precondition','Sesi evidence tidak sesuai timestamp server. Refresh halaman dan ambil foto ulang.');
    }
  }

  const bucket=getStorage().bucket();
  const buffers=[],mimeTypes=[];
  try{
    for(const path of rawPaths){
      const file=bucket.file(path);
      const [meta]=await file.getMetadata();
      if(!String(meta.contentType||'').startsWith('image/'))throw new HttpsError('invalid-argument','Evidence harus berupa gambar.');
      if(Number(meta.size||0)>8*1024*1024)throw new HttpsError('invalid-argument','Ukuran foto terlalu besar.');
      const [buf]=await file.download();buffers.push(buf);mimeTypes.push(meta.contentType||'image/jpeg');
    }

    const ai=await aiModule.analyzeImages(point,buffers,mimeTypes,session,{logger});
    const now=new Date(),capturedDisplay=displayWib(now);
    const finalPaths=[];
    for(let i=0;i<buffers.length;i++){
      const stamped=await stampImage(buffers[i],[`${capturedDisplay} · ${String(session.slotLabel||session.slot||'').toUpperCase()} · ${session.storeName||''}`,`${pointId} · AI SCORE ${ai.score} · ${ai.status}`]);
      const finalPath=`audit-evidence/${sessionId}/${pointId}/${Date.now()}_${i}.jpg`;
      await bucket.file(finalPath).save(stamped,{resumable:false,metadata:{contentType:'image/jpeg',cacheControl:'public,max-age=31536000,immutable'}});
      finalPaths.push(finalPath);
    }

    const result={
      pointId,area:point.area,title:point.title,score:ai.score,status:ai.status,validPhoto:ai.validPhoto,confidence:ai.confidence,
      reason:ai.reason,issues:ai.issues,evidencePaths:finalPaths,capturedAt:Timestamp.fromDate(now),capturedDisplay,
      model:ai.model,aiProvider:ai.provider,structuredOutput:ai.structuredOutput===true,fallbackReason:ai.fallbackReason||''
    };
    logger.info('scoreEvidence ok',{sessionId,pointId,provider:ai.provider,model:ai.model,score:ai.score,status:ai.status,fallback:ai.fallbackReason||''});

    let aggregateResult;
    await db.runTransaction(async tx=>{
      const snap=await tx.get(sessionRef);
      if(!snap.exists)throw new Error('Session hilang saat scoring.');
      const current=snap.data();
      if(current.status==='AUTO_SCORED')throw new HttpsError('failed-precondition','Session sudah Final Submit dan tidak dapat diubah.');
      const results={...(current.results||{}),[pointId]:result};
      aggregateResult=aggregate(results);
      const patch={results,...aggregateResult,status:aggregateResult.complete?'READY_TO_SUBMIT':'IN_PROGRESS',updatedAt:Timestamp.fromDate(now),lastScoredPoint:pointId,scoringModel:ai.model,scoringProvider:ai.provider};
      if(aggregateResult.complete&&!current.scoringCompletedAt)patch.scoringCompletedAt=Timestamp.fromDate(now);
      tx.update(sessionRef,patch);
    });

    await Promise.all(rawPaths.map(p=>bucket.file(p).delete({ignoreNotFound:true}).catch(()=>null)));
    return{ok:true,result,session:aggregateResult};
  }catch(err){
    logger.error('scoreEvidence failed',{sessionId,pointId,error:err?.message||String(err)});
    if(err instanceof HttpsError)throw err;
    const code=err?.code==='AI_QUOTA'?'resource-exhausted':err?.code==='AI_SERVER'?'unavailable':err?.code==='AI_CONFIG'?'failed-precondition':'internal';
    throw new HttpsError(code,(code==='internal'?'AI scoring gagal: ':'')+safeShort(err?.message||'unknown error',180));
  }
});

exports.finalizeSession = onCall(async request=>{
  const sessionId=String(request.data?.sessionId||'').trim();
  if(!sessionId)throw new HttpsError('invalid-argument','sessionId wajib diisi.');
  const db=getFirestore(),ref=db.collection('audits').doc(sessionId),now=new Date();
  let output=null;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)throw new HttpsError('not-found','Session tidak ditemukan.');
    const current=snap.data()||{};
    if(current.scoringMode!=='AI_VISION_V1')throw new HttpsError('failed-precondition','Session bukan mode AI auto scoring.');
    if(current.status==='AUTO_SCORED'){
      output={...current,id:sessionId};return;
    }
    const summary=aggregate(current.results||{});
    if(!summary.complete)throw new HttpsError('failed-precondition',`Evidence belum lengkap: ${summary.completedCount}/${CONTROL_POINTS.length}.`);
    const dl=deadlineMeta(current,now),submissionStatus=dl.onTime?'ON_TIME':'LATE';
    const patch={...summary,status:'AUTO_SCORED',submittedAt:Timestamp.fromDate(now),completedAt:Timestamp.fromDate(now),submissionStatus,deadlineTime:dl.deadlineTime,deadlineAt:dl.deadlineAt,deadlineDisplay:dl.deadlineDisplay,latenessMinutes:dl.latenessMinutes,updatedAt:Timestamp.fromDate(now)};
    tx.update(ref,patch);output={...current,...patch,id:sessionId};
  });
  const clientSession=output?{
    id:sessionId,storeId:output.storeId||'',storeCode:output.storeCode||'',storeName:output.storeName||'',officerId:output.officerId||'',officerName:output.officerName||'',
    operationalDate:output.operationalDate||'',calendarDate:output.calendarDate||'',slot:output.slot||'',slotLabel:output.slotLabel||SHIFT_RULES[output.slot]?.label||'',status:output.status||'AUTO_SCORED',
    score:output.score,scoreLabel:output.scoreLabel,completedCount:output.completedCount,controlPointCount:output.controlPointCount,cleanCount:output.cleanCount,needCleaningCount:output.needCleaningCount,dirtyCount:output.dirtyCount,invalidCount:output.invalidCount,areaScores:output.areaScores||{},
    submissionStatus:output.submissionStatus||'',deadlineTime:output.deadlineTime||SHIFT_RULES[output.slot]?.cutoff||'',deadlineDisplay:output.deadlineDisplay||'',latenessMinutes:Number(output.latenessMinutes||0),submittedDisplay:output.submittedAt?.toDate?displayWib(output.submittedAt.toDate()):displayWib(now),submittedAtMillis:output.submittedAt?.toDate?output.submittedAt.toDate().getTime():now.getTime()
  }:null;
  return{ok:true,session:clientSession};
});

