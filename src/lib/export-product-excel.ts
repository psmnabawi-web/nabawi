'use client';

import { monthlyStatus, PRODUCTS, type Verdict } from './productChecklists';
import type { ProductAudit, Store } from './types';

const VERDICT_TEXT: Record<Verdict, string> = { ya: 'Ya', tidak: 'Tidak', na: 'N/A' };
const ORANGE = 'FFF26522';

function shortStore(name: string) {
  return name.replace(/^Almaz Fried Chicken\s*-\s*/i, '');
}

/** Export satu pemeriksaan ke Excel mengikuti layout sheet "QC <Produk>" pada Cheklist Audit Kwalitas V3.1. */
export async function exportProductAuditExcel(audit: ProductAudit) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Almaz Store Cleanliness & Quality';
  wb.created = new Date();
  const ws = wb.addWorksheet(`QC ${audit.productName}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 9 }] });
  ws.columns = [{ width: 5 }, { width: 11 }, { width: 22 }, { width: 30 }, { width: 62 }, { width: 10 }, { width: 10 }, { width: 55 }, { width: 45 }, { width: 14 }];

  ws.mergeCells('A1:J1');
  ws.getCell('A1').value = `CHECKLIST AUDIT KUALITAS PRODUK - ${audit.productName.toUpperCase()}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
  ws.getCell('A1').alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  const meta: Array<[string, string | number]> = [
    ['Store', audit.storeName],
    ['Tanggal', audit.date],
    ['Pemeriksaan ke', audit.checkNo],
    ['Inspector', audit.inspectorName],
    ['Status', audit.status === 'submitted' ? 'Submitted' : 'Draft'],
    ['Keputusan', audit.summary.decision],
  ];
  meta.forEach(([k, v], i) => {
    ws.getCell(`A${2 + i}`).value = k;
    ws.getCell(`A${2 + i}`).font = { bold: true };
    ws.mergeCells(`A${2 + i}:B${2 + i}`);
    ws.getCell(`C${2 + i}`).value = v;
  });
  // Ringkasan dengan formula
  const first = 10;
  const last = first + audit.items.length - 1;
  ws.getCell('E2').value = 'Ya';
  ws.getCell('F2').value = { formula: `COUNTIF(F${first}:F${last},"Ya")` };
  ws.getCell('E3').value = 'Tidak';
  ws.getCell('F3').value = { formula: `COUNTIF(F${first}:F${last},"Tidak")` };
  ws.getCell('E4').value = 'N/A';
  ws.getCell('F4').value = { formula: `COUNTIF(F${first}:F${last},"N/A")` };
  ws.getCell('E5').value = 'Nilai (Ya / (Ya+Tidak))';
  ws.getCell('F5').value = { formula: `IF(F2+F3=0,"-",F2/(F2+F3))` };
  ws.getCell('F5').numFmt = '0.0%';
  ws.getCell('E6').value = 'Critical Tidak';
  ws.getCell('F6').value = { formula: `COUNTIFS(B${first}:B${last},"CRITICAL",F${first}:F${last},"Tidak")` };
  ws.getCell('E7').value = 'Major Tidak';
  ws.getCell('F7').value = { formula: `COUNTIFS(B${first}:B${last},"MAJOR",F${first}:F${last},"Tidak")` };
  ['E2', 'E3', 'E4', 'E5', 'E6', 'E7'].forEach((c) => (ws.getCell(c).font = { bold: true }));

  const header = ['NO', 'GATE', 'TAHAP', 'PARAMETER MUTU', 'STANDAR PENERIMAAN', 'HASIL', 'AI', 'ALASAN / BUKTI', 'KOREKSI INSPECTOR', 'SUMBER'];
  const hr = ws.getRow(9);
  header.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });

  for (const it of audit.items) {
    const row = ws.addRow([
      it.no,
      it.gate,
      it.stage,
      it.parameter,
      it.standard,
      it.final ? VERDICT_TEXT[it.final] : '',
      it.ai ? VERDICT_TEXT[it.ai.verdict] : '',
      it.ai ? [it.ai.reason, it.ai.missing ? `Bukti kurang: ${it.ai.missing}` : ''].filter(Boolean).join('\n') : '',
      it.finalSource === 'inspector' ? `${it.final ? VERDICT_TEXT[it.final] : ''}${it.inspectorNote ? ` - ${it.inspectorNote}` : ''}` : '',
      it.ai ? it.ai.evidenceSource : '',
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    const fill = it.final === 'tidak' ? (it.gate === 'CRITICAL' ? 'FFFDE2E1' : it.gate === 'MAJOR' ? 'FFFFF3CD' : 'FFE8F0FB') : it.final === 'ya' ? 'FFE6F4EA' : undefined;
    if (fill) row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    row.getCell(6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Ya,Tidak,N/A"'] };
  }
  ws.autoFilter = { from: { row: 9, column: 1 }, to: { row: last, column: 10 } };

  // Sheet bukti
  const ev = wb.addWorksheet('Bukti');
  ev.columns = [{ header: 'Jenis', key: 'k', width: 22 }, { header: 'Isi', key: 'v', width: 90 }];
  ev.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ev.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
  audit.photoUrls.forEach((u, i) => ev.addRow({ k: `Foto ${i + 1}: ${audit.photoLabels[i] ?? ''}`, v: u }));
  Object.entries(audit.measures ?? {}).forEach(([k, v]) => ev.addRow({ k: `Ukur: ${k}`, v: v ?? '' }));
  ev.addRow({ k: 'Catatan proses', v: audit.notes?.process ?? '' });
  ev.addRow({ k: 'Catatan sensori', v: audit.notes?.sensory ?? '' });
  ev.addRow({ k: 'Catatan label', v: audit.notes?.label ?? '' });
  if (audit.ai) {
    ev.addRow({ k: 'Kesimpulan AI', v: audit.ai.summary });
    ev.addRow({ k: 'Risiko', v: audit.ai.risks.join('\n') });
    ev.addRow({ k: 'Rekomendasi', v: audit.ai.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n') });
    ev.addRow({ k: 'Bukti kurang', v: audit.ai.missingEvidence.join('\n') });
    ev.addRow({ k: 'Model', v: `${audit.ai.model} (${new Date(audit.ai.analyzedAt).toLocaleString('id-ID')})` });
  }
  ev.eachRow((r) => (r.alignment = { vertical: 'top', wrapText: true }));

  const buf = await wb.xlsx.writeBuffer();
  download(buf, `QC_${audit.productName.replace(/[^\w]+/g, '_')}_${shortStore(audit.storeName).replace(/[^\w]+/g, '_')}_${audit.date}_cek${audit.checkNo}.xlsx`);
}

/** Rekap bulanan store x produk (mengikuti sheet "Rekap Bulanan") + daftar pemeriksaan. */
export async function exportProductRecapExcel(audits: ProductAudit[], month: string, stores: Store[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Almaz Store Cleanliness & Quality';
  const ws = wb.addWorksheet('Rekap Bulanan', { views: [{ state: 'frozen', ySplit: 2, xSplit: 1 }] });
  ws.mergeCells('A1:M1');
  ws.getCell('A1').value = `REKAP AUDIT KUALITAS PRODUK - ${month}`;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
  const head = ['Store'];
  for (const p of PRODUCTS) head.push(`${p.short} Status`, `${p.short} Cek`, `${p.short} Nilai`, `${p.short} Tidak`);
  const hr = ws.addRow(head);
  hr.font = { bold: true };
  hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F1' } };
  ws.columns = [{ width: 28 }, ...PRODUCTS.flatMap(() => [{ width: 26 }, { width: 8 }, { width: 9 }, { width: 8 }])];
  for (const s of stores) {
    const row: (string | number)[] = [shortStore(s.name)];
    for (const p of PRODUCTS) {
      const checks = audits
        .filter((a) => a.storeId === s.id && a.productId === p.id && a.status === 'submitted')
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
        .map((a) => a.summary);
      const m = monthlyStatus(checks);
      row.push(m.status, m.done, m.avg === null ? '' : m.avg / 100, m.totalTidak);
    }
    const r = ws.addRow(row);
    PRODUCTS.forEach((_, i) => (r.getCell(4 + i * 4).numFmt = '0.0%'));
  }

  const list = wb.addWorksheet('Daftar Pemeriksaan', { views: [{ state: 'frozen', ySplit: 1 }] });
  list.columns = [
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Store', key: 'store', width: 28 },
    { header: 'Produk', key: 'product', width: 18 },
    { header: 'Cek ke', key: 'checkNo', width: 7 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Ya', key: 'ya', width: 6 },
    { header: 'Tidak', key: 'tidak', width: 6 },
    { header: 'N/A', key: 'na', width: 6 },
    { header: 'Nilai', key: 'score', width: 8 },
    { header: 'Critical NG', key: 'c', width: 10 },
    { header: 'Major NG', key: 'm', width: 10 },
    { header: 'Control NG', key: 'k', width: 10 },
    { header: 'Keputusan', key: 'decision', width: 30 },
    { header: 'Inspector', key: 'inspector', width: 18 },
    { header: 'Item Tidak', key: 'fails', width: 70 },
  ];
  list.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  list.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
  for (const a of [...audits].sort((x, y) => x.date.localeCompare(y.date))) {
    const r = list.addRow({
      date: a.date,
      store: shortStore(a.storeName),
      product: a.productName,
      checkNo: a.checkNo,
      status: a.status,
      ya: a.summary.ya,
      tidak: a.summary.tidak,
      na: a.summary.na,
      score: a.summary.score === null ? '' : a.summary.score / 100,
      c: a.summary.criticalNg,
      m: a.summary.majorNg,
      k: a.summary.controlNg,
      decision: a.summary.decision,
      inspector: a.inspectorName,
      fails: a.items.filter((i) => i.final === 'tidak').map((i) => `#${i.no} [${i.gate}] ${i.parameter}`).join('; '),
    });
    r.getCell('score').numFmt = '0.0%';
    r.alignment = { vertical: 'top', wrapText: true };
  }
  list.autoFilter = { from: 'A1', to: `O${Math.max(2, audits.length + 1)}` };

  const buf = await wb.xlsx.writeBuffer();
  download(buf, `Rekap_Audit_Produk_${month}.xlsx`);
}

function download(buf: ArrayBuffer, name: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
