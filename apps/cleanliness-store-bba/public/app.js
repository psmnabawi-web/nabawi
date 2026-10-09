import {initializeApp} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {getFirestore,doc,getDoc,setDoc,addDoc,collection,getDocs,query,orderBy,limit,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {getStorage,ref,uploadBytes,getDownloadURL} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import {firebaseConfig} from "./firebase-config.js";
import {CONTROL_POINTS,SCORE_CONFIG,CREW_MASTER,STORE_MASTER} from "./master-data.js";

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const state={stores:[],ready:false,currentSessionId:'',currentSession:null,currentResults:{},scoring:new Set(),resultUrls:{},finalizing:false};
const areas=[...new Set(CONTROL_POINTS.map(x=>x.area))];
const configured=firebaseConfig.apiKey&&!String(firebaseConfig.apiKey).startsWith('PASTE_');
const APP_TIMEZONE='Asia/Jakarta',TZ_LABEL='WIB';
const SESSION_ORDER=['SHIFT_1','SHIFT_2','SHIFT_3'];
const SESSION_LABEL={SHIFT_1:'Shift 1',SHIFT_2:'Shift 2',SHIFT_3:'Shift 3'};
const SHIFT_RULES={
  SHIFT_1:{label:'Shift 1',cutoff:'12:00',cutoffSecond:12*3600+59},
  SHIFT_2:{label:'Shift 2',cutoff:'17:00',cutoffSecond:17*3600+59},
  SHIFT_3:{label:'Shift 3',cutoff:'23:59',cutoffSecond:23*3600+59*60+59}
};
let db,storage,functions,scoreEvidenceFn,finalizeSessionFn;

function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(m,e=false){const t=$('#toast');t.textContent=m;t.className='toast show'+(e?' error':'');clearTimeout(toast.x);toast.x=setTimeout(()=>t.className='toast',3500)}
function setConnection(text,ok=false,bad=false){const p=$('#connectionPill');p.textContent=text;p.className='connection-pill'+(ok?' online':'')+(bad?' offline':'')}
function saveLocal(key,value){try{localStorage.setItem(key,value)}catch{}}
function loadLocal(key){try{return localStorage.getItem(key)||''}catch{return''}}
function pointById(id){return CONTROL_POINTS.find(x=>x.id===id)}
function scoreLabel(score){return SCORE_CONFIG.labels.find(x=>score>=x.min)?.label||'CRITICAL'}
function badge(s){if(['EXCELLENT','GOOD','AUTO_SCORED','CLEAN','ON_TIME'].includes(s))return'green';if(['NEED IMPROVEMENT','IN_PROGRESS','READY_TO_SUBMIT','NEED_CLEANING'].includes(s))return'amber';if(['CRITICAL','DIRTY','INVALID','MISSING','LATE'].includes(s))return'red';return'blue'}
function statusText(s){return({CLEAN:'BERSIH',NEED_CLEANING:'PERLU CLEANING',DIRTY:'KOTOR',INVALID:'INVALID'})[s]||s||'-'}
function statusClass(s){return s==='CLEAN'?'clean':s==='NEED_CLEANING'?'need':s==='DIRTY'?'dirty':'invalid'}
function fmtScore(v){return Number.isFinite(Number(v))?Number(v).toFixed(1).replace('.0',''):'-'}

function zonedParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:APP_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
}
function operationalMeta(date=new Date()){
  const p=zonedParts(date),hour=Number(p.hour),minute=Number(p.minute),second=Number(p.second),calendarDate=`${p.year}-${p.month}-${p.day}`,sec=hour*3600+minute*60+second;
  let slot='SHIFT_3';
  if(sec<=SHIFT_RULES.SHIFT_1.cutoffSecond)slot='SHIFT_1';
  else if(sec<=SHIFT_RULES.SHIFT_2.cutoffSecond)slot='SHIFT_2';
  const rule=SHIFT_RULES[slot];
  return{slot,slotLabel:rule.label,operationalDate:calendarDate,calendarDate,time:`${p.hour}:${p.minute}:${p.second}`,display:`${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} ${TZ_LABEL}`,cutoff:rule.cutoff,cutoffSecond:rule.cutoffSecond,secondOfDay:sec};
}
function displayDateKey(key=''){if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return key||'-';const [y,m,d]=key.split('-');return`${d}/${m}/${y}`}
function shiftDateKey(key,days){const [y,m,d]=key.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d+days));return dt.toISOString().slice(0,10)}
function dueSlotsFor(meta){return SESSION_ORDER.filter(slot=>SHIFT_RULES[slot].cutoffSecond<meta.secondOfDay)}
function activeSlotFor(meta){return meta.slot}
function deadlineText(slot){return SHIFT_RULES[slot]?.cutoff||'-'}
function submissionText(a){return a?.submissionStatus==='ON_TIME'?'ON TIME':a?.submissionStatus==='LATE'?'LATE':'-'}
function dateFromKey(key){return /^\d{4}-\d{2}-\d{2}$/.test(key||'')?new Date(key+'T00:00:00+07:00'):new Date(0)}
function timeFromSession(a){if(a?.submittedDisplay){const m=String(a.submittedDisplay).match(/\b(\d{2}:\d{2})(?::\d{2})?\s*WIB/i);if(m)return m[1]}const d=Number.isFinite(Number(a?.submittedAtMillis))?new Date(Number(a.submittedAtMillis)):a?.submittedAt?.toDate?.()||a?.completedAt?.toDate?.()||a?.updatedAt?.toDate?.()||a?.createdAt?.toDate?.();if(!d)return'-';const p=zonedParts(d);return`${p.hour}:${p.minute}`}
function updateClock(){
  const d=new Date();$('#clock').innerHTML=new Intl.DateTimeFormat('id-ID',{timeZone:APP_TIMEZONE,weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(d)+'<br>'+new Intl.DateTimeFormat('id-ID',{timeZone:APP_TIMEZONE,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d);
  const m=operationalMeta(d);if($('#autoControlTime'))$('#autoControlTime').textContent=m.display;if($('#autoSessionBadge')){$('#autoSessionBadge').textContent=`${m.slotLabel.toUpperCase()} · ${displayDateKey(m.operationalDate)}`;$('#autoSessionBadge').className=`session-pill ${m.slot.toLowerCase().replace('_','-')}`}if($('#autoDeadline'))$('#autoDeadline').textContent=`${m.cutoff} ${TZ_LABEL}`;
}
setInterval(updateClock,1000);updateClock();

$('#evidenceTotal').textContent=CONTROL_POINTS.length;
function crewForStore(storeId){return CREW_MASTER.filter(c=>c.storeId===storeId).sort((a,b)=>a.name.localeCompare(b.name,'id'))}
function areaSlug(area){return String(area).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')}
function captureReady(){return !!($('#captureStore')?.value&&$('#captureOfficer')?.value)}
function updateCaptureAvailability(){const ready=captureReady();$('#evidenceItems')?.classList.toggle('locked',!ready);$('#captureLockNote')?.classList.toggle('hidden',ready)}
function pendingPointIds(){return CONTROL_POINTS.filter(p=>!state.currentResults?.[p.id]).map(p=>p.id)}
function scrollToNextPending(){const id=pendingPointIds()[0];if(!id)return;const card=$(`#card-${id}`);if(!card)return;card.scrollIntoView({behavior:'smooth',block:'center'});card.classList.add('flash');setTimeout(()=>card.classList.remove('flash'),1600)}
function renderAreaNav(){const nav=$('#areaNav');if(!nav)return;nav.innerHTML=areas.map(area=>`<button type="button" class="area-chip" data-area="${areaSlug(area)}"><span>${esc(area)}</span><b></b></button>`).join('');$$('.area-chip',nav).forEach(b=>b.onclick=()=>{$(`#area-${b.dataset.area}`)?.scrollIntoView({behavior:'smooth',block:'start'})});updateAreaNav()}
function updateAreaNav(){for(const area of areas){const chip=$(`.area-chip[data-area="${areaSlug(area)}"]`);if(!chip)continue;const items=CONTROL_POINTS.filter(p=>p.area===area),done=items.filter(p=>state.currentResults?.[p.id]).length;chip.querySelector('b').textContent=`${done}/${items.length}`;chip.classList.toggle('done',done===items.length);chip.classList.toggle('partial',done>0&&done<items.length)}}
function renderCrewMaster(storeId=$('#captureStore')?.value||'',preferredId=''){
  const sel=$('#captureOfficer');if(!sel)return;
  const saved=preferredId||loadLocal('cleanliness_capture_officer_id'),list=crewForStore(storeId);
  if(!storeId){sel.innerHTML='<option value="">Pilih store terlebih dahulu</option>';sel.disabled=true;updateCaptureAvailability();return}
  if(!list.length){sel.innerHTML='<option value="">Belum ada crew terdaftar untuk store ini</option>';sel.disabled=true;updateCaptureAvailability();return}
  sel.innerHTML='<option value="">Pilih crew</option>'+list.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.id)}</option>`).join('');
  sel.disabled=false;if(list.some(c=>c.id===saved))sel.value=saved;
  updateCaptureAvailability();
}
renderCrewMaster();
$('#captureOfficer').addEventListener('change',e=>{saveLocal('cleanliness_capture_officer_id',e.target.value);updateCaptureAvailability()});
$('#captureStore').addEventListener('change',async e=>{saveLocal('cleanliness_capture_store_id',e.target.value);renderCrewMaster(e.target.value);await loadCurrentSession(true)});
$('#menuBtn').onclick=()=>$('.sidebar').classList.toggle('open');
$$('.nav-item').forEach(b=>b.onclick=()=>{showPage(b.dataset.page);$('.sidebar').classList.remove('open')});

async function showPage(p){
  $$('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${p}`));$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===p));
  const t={dashboard:['Dashboard','AI scoring & compliance kontrol 3 shift'],capture:['Evidence Kebersihan','Foto langsung dinilai aplikasi'],stores:['Master Store','Pengaturan daftar store']}[p];
  $('#pageTitle').textContent=t[0];$('#pageSubtitle').textContent=t[1];if(!state.ready)return;
  if(p==='dashboard')await loadDashboard();if(p==='capture'){renderCapture();await loadCurrentSession(false)}if(p==='stores')await loadStoresAdmin();
}

async function boot(){
  if(!configured){$('#bootText').textContent='Firebase belum dikonfigurasi. Jalankan deploy.sh.';setConnection('Config Error',false,true);return}
  try{
    $('#bootText').textContent='Menyiapkan aplikasi...';
    const app=initializeApp(firebaseConfig);
    db=getFirestore(app);storage=getStorage(app);functions=getFunctions(app,'asia-southeast1');
    scoreEvidenceFn=httpsCallable(functions,'scoreEvidence',{timeout:120000});
    finalizeSessionFn=httpsCallable(functions,'finalizeSession',{timeout:30000});

    // FAST BOOT: master store/crew sudah dibundel di master-data.js, jadi tidak perlu
    // menunggu round-trip Firestore sebelum UI ditampilkan.
    await loadStores();
    state.ready=true;
    setConnection('Online',true);
    $('#bootOverlay').classList.add('hidden');

    // Dashboard dimuat setelah UI terbuka. Jika Firestore lambat, user tetap bisa masuk aplikasi.
    showPage('dashboard').catch(e=>{console.warn('Dashboard load warning',e);toast('Dashboard masih memuat data. Coba Refresh jika perlu.',true)});

    // Sinkronisasi master ke Firestore berjalan di background dan tidak memblokir boot.
    setTimeout(()=>ensureMasterStores().catch(e=>console.warn('Background master sync gagal:',e)),1200);
  }catch(e){
    $('#bootText').textContent='Gagal menyiapkan aplikasi: '+e.message;
    setConnection('Offline',false,true);
  }
}

async function ensureMasterStores(){
  const activeIds=new Set(STORE_MASTER.map(s=>s.id));
  await Promise.allSettled(STORE_MASTER.map(async store=>{
    const refDoc=doc(db,'stores',store.id),snap=await getDoc(refDoc);
    if(!snap.exists()){
      await setDoc(refDoc,{code:store.code,name:store.name,active:true,source:'MASTER_APP_XLSX',createdAt:serverTimestamp()});
      return;
    }
    const cur=snap.data()||{};
    if(cur.code!==store.code||cur.name!==store.name||cur.active===false||cur.source!=='MASTER_APP_XLSX'){
      await setDoc(refDoc,{code:store.code,name:store.name,active:true,source:'MASTER_APP_XLSX'},{merge:true});
    }
  }));
  try{
    const snap=await getDocs(collection(db,'stores'));
    await Promise.allSettled(snap.docs.map(async d=>{
      const v=d.data()||{};
      if((v.source==='MASTER_APP'||v.source==='MASTER_APP_XLSX')&&!activeIds.has(d.id)&&v.active!==false){
        await setDoc(doc(db,'stores',d.id),{active:false},{merge:true});
      }
    }));
  }catch(e){console.warn('Deactivate old master skipped',e)}
}

async function loadStores(){
  // Single source of truth untuk dropdown adalah master-data.js, bukan query Firestore.
  // Ini membuat opening app instan dan tetap jalan saat koneksi Firestore sedang lambat.
  state.stores=STORE_MASTER.map(s=>({...s,active:true,source:'MASTER_LOCAL'})).sort((a,b)=>(a.name||'').localeCompare(b.name||'','id'));
  for(const sel of [$('#captureStore'),$('#dashStoreFilter')]){
    const current=sel.value,saved=sel.id==='captureStore'?loadLocal('cleanliness_capture_store_id'):'',first=sel.id==='dashStoreFilter'?'<option value="">Semua Store</option>':'<option value="">Pilih store</option>';
    sel.innerHTML=first+state.stores.map(x=>`<option value="${x.id}">${esc((x.code?x.code+' - ':'')+x.name)}</option>`).join('');
    const target=current||saved;if(target&&state.stores.some(x=>x.id===target))sel.value=target;
  }
  renderCrewMaster($('#captureStore').value);
}

function sessionIdFor(storeId,meta){return`${storeId}_${meta.operationalDate}_${meta.slot}`}
async function ensureSession(){
  const storeId=$('#captureStore').value,officerId=$('#captureOfficer').value,crew=CREW_MASTER.find(c=>c.id===officerId&&c.storeId===storeId);
  if(!storeId)throw new Error('Pilih Store terlebih dahulu.');
  if(!crew)throw new Error('Pilih Nama Crew yang terdaftar pada store tersebut.');
  saveLocal('cleanliness_capture_officer_id',officerId);
  const store=state.stores.find(x=>x.id===storeId),meta=operationalMeta(new Date()),sessionId=sessionIdFor(storeId,meta),dref=doc(db,'audits',sessionId);let snap=await getDoc(dref);
  if(!snap.exists()){
    await setDoc(dref,{storeId,storeCode:store?.code||'',storeName:store?.name||'',officerId:crew.id,officerName:crew.name,operationalDate:meta.operationalDate,calendarDate:meta.calendarDate,slot:meta.slot,slotLabel:meta.slotLabel,status:'IN_PROGRESS',scoringMode:'AI_VISION_V1',results:{},controlPointCount:CONTROL_POINTS.length,createdAt:serverTimestamp()});snap=await getDoc(dref);
  }else{
    const existing=snap.data()||{};
    if(existing.officerId&&existing.officerId!==crew.id){
      const registered=CREW_MASTER.find(c=>c.id===existing.officerId&&c.storeId===storeId);
      if(registered){renderCrewMaster(storeId,registered.id);$('#captureOfficer').value=registered.id;$('#captureOfficer').disabled=true;}
      throw new Error(`Sesi ${meta.slotLabel} store ini sudah dimulai oleh ${existing.officerName||existing.officerId}.`);
    }
    if(!existing.officerId){
      await setDoc(dref,{officerId:crew.id,officerName:crew.name},{merge:true});
      snap=await getDoc(dref);
    }
  }
  if(!snap.exists())throw new Error('Session gagal dibuat. Coba ulangi sekali lagi.');
  const sessionData=snap.data()||{};
  state.currentSessionId=sessionId;state.currentSession={id:sessionId,...sessionData};state.currentResults=sessionData.results||{};
  renderCrewMaster(storeId,state.currentSession.officerId||crew.id);$('#captureOfficer').value=state.currentSession.officerId||crew.id;$('#captureOfficer').disabled=true;
  return state.currentSession;
}
async function loadCurrentSession(forceRender=true){
  state.currentSessionId='';state.currentSession=null;state.currentResults={};state.resultUrls={};
  const storeId=$('#captureStore').value;renderCrewMaster(storeId);
  if(storeId){
    const meta=operationalMeta(new Date()),sid=sessionIdFor(storeId,meta),snap=await getDoc(doc(db,'audits',sid));if(snap.exists()){
      const sessionData=snap.data()||{};state.currentSessionId=sid;state.currentSession={id:sid,...sessionData};state.currentResults=sessionData.results||{};
      if(state.currentSession.officerId&&CREW_MASTER.some(c=>c.id===state.currentSession.officerId&&c.storeId===storeId)){renderCrewMaster(storeId,state.currentSession.officerId);$('#captureOfficer').value=state.currentSession.officerId;$('#captureOfficer').disabled=true}
    }
  }
  if(forceRender)renderCapture();else{renderCaptureResults();updateSessionSummary()}
}

function renderCapture(){
  $('#evidenceItems').innerHTML=areas.map(area=>{const items=CONTROL_POINTS.filter(x=>x.area===area);return`<section class="area-group" id="area-${areaSlug(area)}"><div class="area-title"><h3>${esc(area)}</h3><span>${items.length} titik kontrol</span></div>${items.map(captureCard).join('')}</section>`}).join('');
  $$('.evidence-file').forEach(i=>i.onchange=()=>handleEvidence(i));renderAreaNav();updateCaptureAvailability();renderCaptureResults();updateSessionSummary();
}
const CAMERA_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.2"/><path d="M8.5 6l1.4-2.2h4.2L15.5 6"/></svg>';
function captureCard(it){return`<article class="audit-item" id="card-${it.id}"><div class="audit-item-head"><div><h4>${esc(it.title)}</h4><div class="audit-meta"><span>${esc(it.area)}</span><span class="point-state" id="state-${it.id}">Belum difoto</span></div></div><span class="code-pill">${it.id}</span></div><div class="photo-guide"><b>Foto yang diambil:</b> ${esc(it.photoGuide)}</div><ul class="criteria">${it.passCriteria.map(c=>`<li>${esc(c)}</li>`).join('')}</ul><label class="file-box" id="filebox-${it.id}"><span class="file-cta">${CAMERA_ICON}<b id="filelabel-${it.id}">Ambil Foto</b><small>1 foto wajib, maksimum 2</small></span><input class="evidence-file" data-id="${it.id}" type="file" accept="image/*" capture="environment" multiple></label><div class="thumbs" id="thumb-${it.id}"></div><div id="result-${it.id}"></div></article>`}
function renderCaptureResults(){
  for(const p of CONTROL_POINTS){const r=state.currentResults[p.id];if(r)renderPointResult(p.id,r,state.resultUrls[p.id]||[])}
  hydrateResultUrls();
}
async function hydrateResultUrls(){
  for(const p of CONTROL_POINTS){const r=state.currentResults[p.id];if(!r||state.resultUrls[p.id]||!Array.isArray(r.evidencePaths))continue;try{const urls=await Promise.all(r.evidencePaths.map(x=>getDownloadURL(ref(storage,x))));state.resultUrls[p.id]=urls;renderPointResult(p.id,r,urls)}catch{}}
}
function renderPointResult(id,r,urls=[]){
  const box=$(`#result-${id}`);if(!box)return;
  const card=$(`#card-${id}`),st=$(`#state-${id}`),fl=$(`#filelabel-${id}`);
  if(card){card.classList.add('is-done');card.dataset.status=statusClass(r.status)}
  if(st){st.textContent=`${fmtScore(r.score)} · ${statusText(r.status)}`;st.className=`point-state ${statusClass(r.status)}`}
  if(fl)fl.textContent=r.status==='INVALID'?'Ambil Ulang Foto':'Foto Ulang';const issues=(r.issues||[]).length?`<ul class="score-issues">${r.issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';const photos=urls.length?`<div class="thumbs">${urls.map(u=>`<a href="${esc(u)}" target="_blank"><img class="result-photo" src="${esc(u)}"></a>`).join('')}</div>`:'';
  box.innerHTML=`<div class="score-result ${statusClass(r.status)}"><div class="score-result-head"><div><span class="score-number">${fmtScore(r.score)}</span><span class="tiny muted"> /100</span></div><span class="score-status">${statusText(r.status)}</span></div><div class="score-reason">${esc(r.reason||'')}</div>${issues}<div class="score-meta"><span>${esc(r.capturedDisplay||'')}</span><span>Confidence ${Math.round((Number(r.confidence)||0)*100)}%</span></div>${photos}${r.status==='INVALID'?'<div class="invalid-photo-note">Foto tidak cukup valid. Ambil ulang evidence.</div>':'<div class="retake-hint">Jika kondisi sudah diperbaiki, ambil foto ulang untuk mengganti score.</div>'}</div>`;
}
function setScoringUi(id,on,text='AI sedang menganalisis foto...'){
  const card=$(`#card-${id}`),filebox=$(`#filebox-${id}`),box=$(`#result-${id}`);card?.classList.toggle('is-scoring',on);filebox?.classList.toggle('disabled',on);
  if(on)box.innerHTML=`<div class="score-result scoring"><div class="score-result-head"><span class="ai-pill"><span class="ai-spinner"></span> AI SCORING</span><b>...</b></div><div class="score-reason">${esc(text)}</div></div>`;
}
function updateSessionSummary(){
  const vals=Object.values(state.currentResults||{}),done=vals.length,pct=Math.round(done/CONTROL_POINTS.length*100);$('#evidenceCount').textContent=done;$('#evidenceProgress').style.width=pct+'%';$('#progressPercent').textContent=pct+'%';
  const map=state.currentResults||{},pts=CONTROL_POINTS.filter(p=>map[p.id]),w=pts.reduce((s,p)=>s+p.weight,0),e=pts.reduce((s,p)=>s+p.weight*(Number(map[p.id].score)||0)/100,0),score=w?e/w*100:null;
  const complete=done===CONTROL_POINTS.length;
  $('#currentSessionScore').textContent=score==null?'-':fmtScore(score);
  $('#sessionScoreLabel').textContent=complete?'Final Score Kebersihan':'Score Sementara';
  $('#currentSessionStatus').textContent=done===0?'Belum ada evidence yang dinilai':complete?`26/26 selesai · ${scoreLabel(score)}`:`${done}/${CONTROL_POINTS.length} titik sudah dinilai · score belum final`;
  const btn=$('#submitSessionScore'),hint=$('#submitSessionHint'),session=state.currentSession||{};
  const finalized=session.status==='AUTO_SCORED';
  if(btn){btn.disabled=!complete||state.finalizing;btn.textContent=finalized?'Lihat Score Final':complete?'Submit & Lihat Score Kebersihan':`Lengkapi ${done}/${CONTROL_POINTS.length} Evidence`;}
  if(hint){const dl=deadlineText(session.slot||operationalMeta(new Date()).slot);hint.textContent=finalized?`Final submit ${submissionText(session)} pada ${timeFromSession(session)} WIB.`:complete?`Seluruh titik sudah dinilai. Final submit maksimal ${dl} WIB agar tercatat ON TIME.`:`Masih ${CONTROL_POINTS.length-done} titik kontrol yang harus difoto. Batas submit ${dl} WIB.`;}
  const csCount=$('#csCount'),csScore=$('#csScore'),csFill=$('#csFill'),csAction=$('#csAction');
  if(csCount)csCount.textContent=`${done}/${CONTROL_POINTS.length}`;
  if(csScore)csScore.textContent=score==null?'Belum ada score':`Score ${fmtScore(score)}`;
  if(csFill)csFill.style.width=pct+'%';
  if(csAction){csAction.disabled=state.finalizing||(complete&&!finalized&&btn?.disabled);csAction.textContent=finalized?'Lihat Score Final':complete?'Submit & Lihat Score':`Berikutnya (${CONTROL_POINTS.length-done})`;csAction.className='btn small '+(complete?'primary':'secondary');$('#captureSticky')?.classList.toggle('complete',complete)}
  updateAreaNav();
}

function currentScoreSummary(){
  const map=state.currentResults||{},pts=CONTROL_POINTS.filter(p=>map[p.id]);
  const weight=pts.reduce((s,p)=>s+p.weight,0);
  const earned=pts.reduce((s,p)=>s+p.weight*(Number(map[p.id].score)||0)/100,0);
  const score=weight?earned/weight*100:0;
  const results=Object.values(map);
  return{score:+score.toFixed(1),clean:results.filter(r=>r.status==='CLEAN').length,need:results.filter(r=>r.status==='NEED_CLEANING').length,dirty:results.filter(r=>r.status==='DIRTY').length,invalid:results.filter(r=>r.status==='INVALID').length,done:results.length};
}
async function submitAndOpenFinalScore(){
  const s=currentScoreSummary();
  if(s.done!==CONTROL_POINTS.length)return toast(`Lengkapi seluruh ${CONTROL_POINTS.length} titik kontrol terlebih dahulu.`,true);
  if(!state.currentSessionId)return toast('Session belum tersedia. Pilih store dan crew kembali.',true);
  try{
    if(state.currentSession?.status!=='AUTO_SCORED'){
      state.finalizing=true;updateSessionSummary();
      const response=await finalizeSessionFn({sessionId:state.currentSessionId});
      const payload=response.data;if(!payload?.ok)throw new Error('Final submit gagal disimpan.');
      state.currentSession={...(state.currentSession||{}),...(payload.session||{})};
      toast(`Final submit ${payload.session?.submissionStatus==='ON_TIME'?'ON TIME':'LATE'} · Score ${fmtScore(payload.session?.score)}`);
    }
    openFinalScoreModal();
  }catch(e){toast(e?.message?.replace(/^FirebaseError:\s*/,'')||'Gagal melakukan final submit.',true)}finally{state.finalizing=false;updateSessionSummary()}
}
function openFinalScoreModal(){
  const s=currentScoreSummary();
  if(s.done!==CONTROL_POINTS.length)return toast(`Lengkapi seluruh ${CONTROL_POINTS.length} titik kontrol terlebih dahulu.`,true);
  const modal=$('#finalScoreModal'),session=state.currentSession||{},store=state.stores.find(x=>x.id===$('#captureStore').value);
  $('#finalScoreValue').textContent=fmtScore(s.score);
  const lbl=scoreLabel(s.score);$('#finalScoreBadge').textContent=lbl;$('#finalScoreBadge').className='final-score-badge '+badge(lbl);
  const sub=submissionText(session),subClass=session.submissionStatus==='ON_TIME'?'green':session.submissionStatus==='LATE'?'red':'blue';
  $('#finalScoreMeta').innerHTML=`<div><span>Store</span><b>${esc(store?.name||session.storeName||'-')}</b></div><div><span>Crew</span><b>${esc(session.officerName||$('#captureOfficer option:checked')?.textContent||'-')}</b></div><div><span>Shift</span><b>${esc(session.slotLabel||session.slot||'-')} · Max ${esc(session.deadlineTime||deadlineText(session.slot))} WIB</b></div><div><span>Submission</span><b><span class="badge ${subClass}">${esc(sub)}</span> ${esc(timeFromSession(session))} WIB</b></div>`;
  $('#finalScoreBreakdown').innerHTML=`<div class="final-mini clean"><span>Bersih</span><b>${s.clean}</b></div><div class="final-mini need"><span>Perlu Cleaning</span><b>${s.need}</b></div><div class="final-mini dirty"><span>Kotor</span><b>${s.dirty}</b></div><div class="final-mini invalid"><span>Invalid</span><b>${s.invalid}</b></div>`;
  const warn=$('#finalScoreWarning');const warnings=[];if(s.invalid)warnings.push(`${s.invalid} evidence INVALID dihitung 0.`);if(session.submissionStatus==='LATE')warnings.push(`Final submit melewati batas ${session.deadlineTime||deadlineText(session.slot)} WIB${Number(session.latenessMinutes)>0?` sekitar ${session.latenessMinutes} menit`:''}.`);warn.classList.toggle('hidden',warnings.length===0);warn.textContent=warnings.join(' ');
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');document.body.classList.add('modal-open');
}
function closeFinalScoreModal(){const m=$('#finalScoreModal');m?.classList.add('hidden');m?.setAttribute('aria-hidden','true');document.body.classList.remove('modal-open')}

async function imageSource(file){if('createImageBitmap'in window)return await createImageBitmap(file);return await new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Foto tidak dapat dibaca'))};img.src=url})}
async function compress(file){const src=await imageSource(file),max=1280,scale=Math.min(1,max/Math.max(src.width,src.height)),c=document.createElement('canvas');c.width=Math.round(src.width*scale);c.height=Math.round(src.height*scale);c.getContext('2d').drawImage(src,0,0,c.width,c.height);return await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Gagal kompres foto')),'image/jpeg',.74))}

async function handleEvidence(input){
  const pointId=input.dataset.id,point=pointById(pointId),files=[...input.files].slice(0,2);if(!files.length)return;
  if(state.scoring.has(pointId))return;
  try{
    const session=await ensureSession();if(session.status==='AUTO_SCORED')throw new Error('Sesi ini sudah Final Submit dan tidak dapat diubah lagi.');const freshMeta=operationalMeta(new Date());if(session.slot!==freshMeta.slot||session.operationalDate!==freshMeta.operationalDate){await loadCurrentSession(true);throw new Error('Sesi waktu sudah berubah. Pilih foto kembali pada sesi aktif.')}
    state.scoring.add(pointId);setScoringUi(pointId,true,'Upload evidence dan analisis kondisi visual...');
    const thumb=$(`#thumb-${pointId}`);thumb.innerHTML=files.map(f=>`<img class="thumb" src="${URL.createObjectURL(f)}" alt="Preview">`).join('');
    const rawPaths=[];
    for(const file of files){const blob=await compress(file),name=(crypto.randomUUID?.()||`${Date.now()}_${Math.random().toString(16).slice(2)}`)+'.jpg',path=`audit-evidence-raw/${session.id}/${pointId}/${name}`;await uploadBytes(ref(storage,path),blob,{contentType:'image/jpeg'});rawPaths.push(path)}
    setScoringUi(pointId,true,'AI membaca objek, kebersihan, noda, grease, kerapian, dan kesesuaian visual...');
    const response=await scoreEvidenceFn({sessionId:session.id,pointId,rawPaths});const payload=response.data;if(!payload?.ok)throw new Error('AI tidak mengembalikan score.');
    const result=payload.result;state.currentResults[pointId]=result;state.currentSession={...(state.currentSession||{}),...payload.session,results:state.currentResults};
    const urls=await Promise.all((result.evidencePaths||[]).map(x=>getDownloadURL(ref(storage,x))));state.resultUrls[pointId]=urls;renderPointResult(pointId,result,urls);updateSessionSummary();
    toast(`${point.title}: score ${fmtScore(result.score)} (${statusText(result.status)})`);
  }catch(e){const msg=e?.message?.replace(/^FirebaseError:\s*/,'')||'Gagal melakukan AI scoring.';setScoringUi(pointId,false);$(`#result-${pointId}`).innerHTML=`<div class="score-result invalid"><div class="score-result-head"><b>Scoring gagal</b><span class="score-status">RETRY</span></div><div class="score-reason">${esc(msg)}</div></div>`;toast(msg,true)}finally{state.scoring.delete(pointId);setScoringUi(pointId,false);input.value=''}
}


$('#submitSessionScore').onclick=submitAndOpenFinalScore;
$('#csAction').onclick=()=>{const done=Object.keys(state.currentResults||{}).length;if(done===CONTROL_POINTS.length)return submitAndOpenFinalScore();if(!captureReady()){$('#captureStore').scrollIntoView({behavior:'smooth',block:'center'});return toast('Pilih store dan nama crew terlebih dahulu.',true)}scrollToNextPending()};
$$('[data-close-score-modal]').forEach(x=>x.onclick=closeFinalScoreModal);
$('#goDashboardAfterScore').onclick=async()=>{closeFinalScoreModal();await showPage('dashboard')};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFinalScoreModal()});

async function audits(max=500){try{const s=await getDocs(query(collection(db,'audits'),orderBy('createdAt','desc'),limit(max)));return s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>a.scoringMode==='AI_VISION_V1')}catch{const s=await getDocs(collection(db,'audits'));return s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>a.scoringMode==='AI_VISION_V1')}}
$('#refreshDash').onclick=loadDashboard;$('#dashStoreFilter').onchange=loadDashboard;$('#dashPeriod').onchange=loadDashboard;
async function loadDashboard(){
  await loadStores();const days=+$('#dashPeriod').value||30,cut=new Date(Date.now()-days*86400000),sid=$('#dashStoreFilter').value,all=(await audits()).filter(a=>dateFromKey(a.operationalDate)>=cut&&(!sid||a.storeId===sid)),complete=all.filter(a=>a.status==='AUTO_SCORED'),avg=complete.length?complete.reduce((s,a)=>s+(Number(a.score)||0),0)/complete.length:0;
  const current=operationalMeta(new Date()),due=dueSlotsFor(current),storeScope=sid?state.stores.filter(s=>s.id===sid):state.stores;
  let dueTotal=0,onTimeDue=0;
  const dateKeys=all.map(a=>a.operationalDate).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k||'')).sort();
  if(dateKeys.length&&storeScope.length){
    const periodStart=shiftDateKey(current.operationalDate,-Math.max(0,days-1)),startKey=dateKeys[0]>periodStart?dateKeys[0]:periodStart;
    for(let key=startKey;key<=current.operationalDate;key=shiftDateKey(key,1)){
      const slots=key<current.operationalDate?SESSION_ORDER:due;
      for(const store of storeScope)for(const slot of slots){dueTotal++;if(all.some(a=>a.storeId===store.id&&a.operationalDate===key&&a.slot===slot&&a.status==='AUTO_SCORED'&&a.submissionStatus==='ON_TIME'))onTimeDue++;}
    }
  }
  const compliance=dueTotal?onTimeDue/dueTotal*100:0;
  const need=complete.reduce((s,a)=>s+(a.needCleaningCount||0),0),dirty=complete.reduce((s,a)=>s+(a.dirtyCount||0)+(a.invalidCount||0),0),late=complete.filter(a=>a.submissionStatus==='LATE').length;
  const data=[['AVG SCORE',complete.length?avg.toFixed(1):'-','Final submitted','◎','teal'],['ON-TIME COMPLIANCE',dueTotal?Math.round(compliance)+'%':'-','Shift jatuh tempo yang on time','✓','green'],['FINAL SUBMIT',complete.length,'Periode terpilih','▣','blue'],['LATE SUBMIT',late,'Melewati cut-off shift','!','amber'],['KOTOR / INVALID',dirty,'Hasil AI <70 / salah foto','×','purple']];
  $('#kpis').innerHTML=data.map(x=>`<div class="kpi"><div class="kpi-icon ${x[4]}">${x[3]}</div><div class="kpi-copy"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div></div>`).join('');
  renderDailyRecap(all,current,storeScope);renderTrend(complete);renderAreas(complete);renderWeakPoints(complete);renderStores(complete);renderRecent(all);
}
function sessionCell(a,mode='due',slot=''){
  const dl=deadlineText(slot);
  if(mode==='future')return`<div class="session-status future"><b>Belum waktunya</b><span>Max ${dl}</span></div>`;
  if(mode==='active'&&!a)return`<div class="session-status active"><b>Belum mulai</b><span>Shift aktif · Max ${dl}</span></div>`;
  if(!a)return`<div class="session-status missing"><b>Belum Submit</b><span>Max ${dl}</span></div>`;
  if(a.status==='AUTO_SCORED'){const legacy=!a.submissionStatus,on=a.submissionStatus==='ON_TIME';return`<div class="session-status ${legacy?'done':on?'done':'late'}"><b>${fmtScore(a.score)} · ${legacy?'FINAL':on?'ON TIME':'LATE'}</b><span>${timeFromSession(a)} WIB${legacy?'':` · Max ${dl}`}</span></div>`;}
  if(a.status==='READY_TO_SUBMIT')return`<div class="session-status ready"><b>Siap Submit</b><span>${a.completedCount||CONTROL_POINTS.length}/${CONTROL_POINTS.length} · Max ${dl}</span></div>`;
  return`<div class="session-status pending"><b>${a.completedCount||0}/${CONTROL_POINTS.length}</b><span>Progress · Max ${dl}</span></div>`;
}
function renderDailyRecap(all,current,stores){
  $('#dailyRecapDate').textContent=displayDateKey(current.operationalDate);const due=dueSlotsFor(current),active=current.slot,activeIdx=SESSION_ORDER.indexOf(active);
  const today=a=>a.operationalDate===current.operationalDate;
  const rows=stores.map(s=>{
    const noCrew=!crewForStore(s.id).length,sess=slot=>all.find(x=>x.storeId===s.id&&today(x)&&x.slot===slot);
    const dueSess=due.map(sess),onTime=dueSess.filter(a=>a?.status==='AUTO_SCORED'&&a.submissionStatus==='ON_TIME').length,late=dueSess.filter(a=>a?.status==='AUTO_SCORED'&&a.submissionStatus==='LATE').length,missing=due.length-onTime-late,act=sess(active);
    // urutan: belum submit > terlambat > sedang progress > belum mulai > semua beres; store tanpa crew paling bawah
    const rank=noCrew?9:missing?0:late?1:!act?2:act.status!=='AUTO_SCORED'?3:act.submissionStatus==='LATE'?4:5;
    return{s,noCrew,onTime,late,missing,act,rank};
  }).sort((a,b)=>a.rank-b.rank||a.s.name.localeCompare(b.s.name,'id'));
  const withCrew=rows.filter(r=>!r.noCrew),chips=[];
  for(const slot of due){const n=withCrew.length,ot=withCrew.filter(r=>all.some(a=>a.storeId===r.s.id&&today(a)&&a.slot===slot&&a.status==='AUTO_SCORED'&&a.submissionStatus==='ON_TIME')).length,lt=withCrew.filter(r=>all.some(a=>a.storeId===r.s.id&&today(a)&&a.slot===slot&&a.status==='AUTO_SCORED'&&a.submissionStatus==='LATE')).length,ms=n-ot-lt;chips.push(`<div class="recap-chip"><span>${SESSION_LABEL[slot]} · lewat ${deadlineText(slot)}</span><b class="g">${ot} on time</b>${lt?`<b class="r">${lt} late</b>`:''}<b class="${ms?'r':'m'}">${ms} belum submit</b></div>`)}
  {const fin=withCrew.filter(r=>r.act?.status==='AUTO_SCORED').length,prog=withCrew.filter(r=>r.act&&r.act.status!=='AUTO_SCORED').length,idle=withCrew.length-fin-prog;chips.push(`<div class="recap-chip active"><span>${SESSION_LABEL[active]} · aktif s/d ${deadlineText(active)}</span><b class="g">${fin} final</b><b class="b">${prog} progress</b><b class="m">${idle} belum mulai</b></div>`)}
  if(rows.length-withCrew.length)chips.push(`<div class="recap-chip muted-chip"><span>Tanpa crew</span><b class="m">${rows.length-withCrew.length} store belum bisa evidence</b></div>`);
  $('#dailyRecapSummary').innerHTML=rows.length?chips.join(''):'';
  $('#dailySessionRecap').innerHTML=rows.length?rows.map(({s,noCrew,onTime,missing,late,rank})=>{
    const name=`<td class="store-cell"><b>${esc((s.code?s.code+' - ':'')+s.name)}</b>${noCrew?'<small class="no-crew">Belum ada crew terdaftar</small>':''}</td>`;
    if(noCrew)return`<tr class="row-nocrew">${name}${SESSION_ORDER.map(()=>'<td><div class="session-status nocrew"><b>–</b><span>Belum ada crew</span></div></td>').join('')}<td><span class="badge">Belum aktif</span></td></tr>`;
    const cells=SESSION_ORDER.map(slot=>{const a=all.find(x=>x.storeId===s.id&&today(x)&&x.slot===slot);const idx=SESSION_ORDER.indexOf(slot),mode=due.includes(slot)?'due':slot===active?'active':idx>activeIdx?'future':'due';return`<td>${sessionCell(a,mode,slot)}</td>`}).join('');
    const pct=due.length?Math.round(onTime/due.length*100):100;
    return`<tr class="${rank===0?'row-missing':rank===1?'row-late':''}">${name}${cells}<td><span class="badge ${pct===100?'green':pct?'amber':'red'}">${due.length?`${onTime}/${due.length} · ${pct}%`:'Belum due'}</span>${missing&&due.length?`<small class="recap-note">${missing} shift belum submit</small>`:late?`<small class="recap-note">${late} shift terlambat</small>`:''}</td></tr>`}).join(''):'<tr><td colspan="5">Belum ada Master Store.</td></tr>'
}
function renderTrend(complete){const m={};complete.forEach(a=>(m[a.operationalDate]??=[]).push(Number(a.score)||0));const keys=Object.keys(m).sort().slice(-14);$('#trendChart').innerHTML=keys.length?keys.map(d=>{const v=m[d].reduce((a,b)=>a+b,0)/m[d].length;return`<div class="bar-col"><span class="bar-value">${v.toFixed(0)}</span><div class="bar" style="height:${Math.max(2,v)}%"></div><span class="bar-label">${d.slice(5)}</span></div>`}).join(''):'<div class="empty-state">Belum ada sesi lengkap.</div>'}
function calcAreaScore(a,area){if(Number.isFinite(a.areaScores?.[area]))return a.areaScores[area];const pts=CONTROL_POINTS.filter(p=>p.area===area&&a.results?.[p.id]),w=pts.reduce((s,p)=>s+p.weight,0),e=pts.reduce((s,p)=>s+p.weight*(Number(a.results[p.id].score)||0)/100,0);return w?e/w*100:null}
function renderAreas(complete){$('#areaChart').innerHTML=areas.map(area=>{const vals=complete.map(a=>calcAreaScore(a,area)).filter(Number.isFinite),v=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;return`<div class="cat-row"><span>${esc(area)}</span><div class="cat-track"><div class="cat-fill" style="width:${v}%"></div></div><b>${vals.length?v.toFixed(0):'-'}</b></div>`}).join('')}
function renderWeakPoints(complete){const rows=CONTROL_POINTS.map(p=>{const vals=complete.map(a=>a.results?.[p.id]?.score).filter(Number.isFinite),avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;return{p,n:vals.length,avg}}).filter(x=>x.n).sort((a,b)=>a.avg-b.avg).slice(0,8);$('#weakPoints').innerHTML=rows.length?rows.map(x=>`<tr><td><b>${esc(x.p.title)}</b><br><small>${x.p.id}</small></td><td>${esc(x.p.area)}</td><td>${x.n}</td><td><b>${x.avg.toFixed(1)}</b></td><td><span class="badge ${badge(scoreLabel(x.avg))}">${scoreLabel(x.avg)}</span></td></tr>`).join(''):'<tr><td colspan="5">Belum ada data.</td></tr>'}
function renderStores(complete){const ids=[...new Set(complete.map(a=>a.storeId))];$('#storeSummary').innerHTML=ids.length?ids.map(id=>{const ar=complete.filter(a=>a.storeId===id),avg=ar.reduce((s,a)=>s+(Number(a.score)||0),0)/ar.length,clean=ar.reduce((s,a)=>s+(a.cleanCount||0),0),need=ar.reduce((s,a)=>s+(a.needCleaningCount||0),0),dirty=ar.reduce((s,a)=>s+(a.dirtyCount||0)+(a.invalidCount||0),0);return`<tr><td><b>${esc(ar[0]?.storeName||'-')}</b></td><td>${ar.length}</td><td><b>${avg.toFixed(1)}</b></td><td>${clean}</td><td>${need}</td><td>${dirty}</td><td><span class="badge ${badge(scoreLabel(avg))}">${scoreLabel(avg)}</span></td></tr>`}).join(''):'<tr><td colspan="7">Belum ada sesi lengkap.</td></tr>'}
function renderRecent(all){const rows=[...all].sort((a,b)=>{const ad=a.submittedAt?.toDate?.()||a.updatedAt?.toDate?.()||a.createdAt?.toDate?.()||new Date(0),bd=b.submittedAt?.toDate?.()||b.updatedAt?.toDate?.()||b.createdAt?.toDate?.()||new Date(0);return bd-ad}).slice(0,20);$('#recentScores').innerHTML=rows.length?rows.map(a=>{const final=a.status==='AUTO_SCORED',sub=final?(a.submissionStatus||'LEGACY'):a.status==='READY_TO_SUBMIT'?'READY_TO_SUBMIT':'IN_PROGRESS';return`<tr><td>${displayDateKey(a.operationalDate)}</td><td><span class="badge blue">${esc(a.slotLabel||a.slot||'-')}</span><br><small>Max ${deadlineText(a.slot)} WIB</small></td><td><b>${esc(a.storeName||'-')}</b></td><td><b>${a.completedCount?fmtScore(a.score):'-'}</b></td><td>${a.completedCount||0}/${CONTROL_POINTS.length}</td><td>${esc(a.officerName||'-')}${a.officerId?`<br><small>${esc(a.officerId)}</small>`:''}</td><td><span class="badge ${badge(sub)}">${sub==='ON_TIME'?'ON TIME':sub==='LATE'?'LATE':sub==='LEGACY'?'FINAL':sub==='READY_TO_SUBMIT'?'SIAP SUBMIT':'IN PROGRESS'}</span>${final?`<br><small>${timeFromSession(a)} WIB</small>`:''}</td></tr>`}).join(''):'<tr><td colspan="7">Belum ada auto scoring.</td></tr>'}

$('#storeForm').onsubmit=async e=>{e.preventDefault();const code=$('#storeCode').value.trim().toUpperCase(),name=$('#storeName').value.trim();if(!code||!name)return;await addDoc(collection(db,'stores'),{code,name,active:true,createdAt:serverTimestamp()});$('#storeCode').value='';$('#storeName').value='';toast('Store ditambahkan.');await loadStoresAdmin();await loadStores()};
async function loadStoresAdmin(){await loadStores();renderStoresAdmin()}
function renderStoresAdmin(){
  const q=($('#storeSearch')?.value||'').trim().toLowerCase();
  const rows=state.stores.filter(s=>!q||`${s.code} ${s.name}`.toLowerCase().includes(q)||crewForStore(s.id).some(c=>c.name.toLowerCase().includes(q)||c.id.toLowerCase().includes(q)));
  const withCrew=state.stores.filter(s=>crewForStore(s.id).length).length;
  if($('#storeCount'))$('#storeCount').textContent=`${rows.length} dari ${state.stores.length} store · ${withCrew} store punya crew · ${CREW_MASTER.length} crew`;
  $('#storeAdminList').innerHTML=rows.map(s=>{const crew=crewForStore(s.id),n=crew.length;return`<details class="store-row${n?'':' no-crew'}"${q&&n?' open':''}><summary><div><b>${esc((s.code?s.code+' · ':'')+s.name)}</b><small>${n?`${n} crew terdaftar · klik untuk lihat nama`:'Belum ada crew, menu Evidence belum bisa dipakai'}</small></div><span class="badge ${n?'green':'amber'}">${n?n+' CREW':'BELUM ADA CREW'}</span></summary>${n?`<ul class="crew-list">${crew.map(c=>`<li><span>${esc(c.name)}</span><small>${esc(c.id)}</small></li>`).join('')}</ul>`:'<p class="crew-empty">Kirim daftar nama crew store ini ke admin aplikasi untuk diaktifkan.</p>'}</details>`}).join('')||'<p class="muted">Tidak ada store yang cocok dengan pencarian.</p>'
}
$('#storeSearch')?.addEventListener('input',renderStoresAdmin);

boot();
