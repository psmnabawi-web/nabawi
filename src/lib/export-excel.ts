'use client';

import type { Audit, AuditItem } from './types';
import { effectiveScore, GRADE_RULES } from './scoring';
import { CATEGORY_ORDER } from './indicators';

/**
 * Export 1 audit ke Excel mengikuti struktur Form Audit Cleaning + sheet Summary dengan formula.
 */
export async function exportAuditExcel(audit: Audit, items: AuditItem[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Store Cleanliness Control';
  wb.created = new Date();

  // ---- Sheet 1: Form Audit ----
  const ws = wb.addWorksheet('Form Audit', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Tanggal Audit', key: 'date', width: 14 },
    { header: 'Outlet/Area', key: 'store', width: 22 },
    { header: 'Auditor', key: 'auditor', width: 18 },
    { header: 'Shift', key: 'shift', width: 8 },
    { header: 'No', key: 'no', width: 5 },
    { header: 'Kategori Area', key: 'category', width: 26 },
    { header: 'Area Audit', key: 'area', width: 34 },
    { header: 'Standar Bersih / Kondisi Ideal', key: 'standard', width: 60 },
    { header: 'Score (1-5)', key: 'score', width: 11 },
    { header: 'Temuan Audit', key: 'findings', width: 50 },
    { header: 'Rekomendasi', key: 'recommendation', width: 40 },
    { header: 'Skor AI', key: 'aiScore', width: 8 },
    { header: 'Koreksi Manager', key: 'override', width: 30 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Difoto Oleh', key: 'by', width: 18 },
    { header: 'Waktu Foto', key: 'at', width: 18 },
    { header: 'Link Foto', key: 'photo', width: 40 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF26522' } };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };

  for (const it of items) {
    const score = effectiveScore(it);
    const row = ws.addRow({
      date: audit.date,
      store: audit.storeName,
      auditor: audit.auditorName,
      shift: audit.shift,
      no: it.no,
      category: it.category,
      area: it.area,
      standard: it.standard,
      score: score ?? null,
      findings: it.ai ? [it.ai.findings, ...it.ai.issues.map((i) => `- ${i}`)].join('\n') : '',
      recommendation: it.ai?.recommendation ?? '',
      aiScore: it.ai?.score ?? null,
      override: it.overrideScore !== null ? `${it.overrideScore} oleh ${it.overrideByName}: ${it.overrideNote}` : '',
      status: it.status,
      by: it.capturedByName ?? '',
      at: it.capturedAt ? new Date(it.capturedAt) : null,
      photo: it.photoUrl ?? '',
    });
    row.alignment = { vertical: 'top', wrapText: true };
    if (it.photoUrl) row.getCell('photo').value = { text: 'Buka foto', hyperlink: it.photoUrl };
    row.getCell('at').numFmt = 'dd/mm/yyyy hh:mm';
  }
  const last = ws.rowCount;
  ws.autoFilter = { from: 'A1', to: `Q${last}` };
  ws.addConditionalFormatting({
    ref: `I2:I${last}`,
    rules: [
      { type: 'cellIs', operator: 'lessThan', formulae: ['3'], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } } }, priority: 1 },
      { type: 'cellIs', operator: 'equal', formulae: ['3'], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } } }, priority: 2 },
      { type: 'cellIs', operator: 'greaterThan', formulae: ['3'], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } } }, priority: 3 },
    ],
  });

  // ---- Sheet 2: Summary (formula) ----
  const sm = wb.addWorksheet('Summary');
  sm.columns = [
    { header: 'Kategori', key: 'k', width: 34 },
    { header: 'Jumlah Item', key: 'n', width: 12 },
    { header: 'Item Dinilai', key: 'scored', width: 12 },
    { header: 'Total Skor', key: 'sum', width: 12 },
    { header: 'Skor Maks', key: 'max', width: 12 },
    { header: 'Rata-rata', key: 'avg', width: 12 },
    { header: 'Persentase', key: 'pct', width: 12 },
    { header: 'Item Kritikal (≤2)', key: 'crit', width: 16 },
  ];
  sm.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sm.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF26522' } };
  const catRange = `'Form Audit'!$F$2:$F$${last}`;
  const scoreRange = `'Form Audit'!$I$2:$I$${last}`;
  let r = 2;
  for (const c of CATEGORY_ORDER) {
    if (!items.some((i) => i.categoryCode === c.code)) continue;
    sm.addRow({
      k: c.label,
      n: { formula: `COUNTIF(${catRange},A${r})` },
      scored: { formula: `COUNTIFS(${catRange},A${r},${scoreRange},">0")` },
      sum: { formula: `SUMIF(${catRange},A${r},${scoreRange})` },
      max: { formula: `C${r}*5` },
      avg: { formula: `IF(C${r}=0,"",D${r}/C${r})` },
      pct: { formula: `IF(E${r}=0,"",D${r}/E${r})` },
      crit: { formula: `COUNTIFS(${catRange},A${r},${scoreRange},">0",${scoreRange},"<=2")` },
    });
    r += 1;
  }
  const totalRow = sm.addRow({
    k: 'TOTAL',
    n: { formula: `SUM(B2:B${r - 1})` },
    scored: { formula: `SUM(C2:C${r - 1})` },
    sum: { formula: `SUM(D2:D${r - 1})` },
    max: { formula: `SUM(E2:E${r - 1})` },
    avg: { formula: `IF(C${r}=0,"",D${r}/C${r})` },
    pct: { formula: `IF(E${r}=0,"",D${r}/E${r})` },
    crit: { formula: `SUM(H2:H${r - 1})` },
  });
  totalRow.font = { bold: true };
  sm.getColumn('avg').numFmt = '0.00';
  sm.getColumn('pct').numFmt = '0.0%';

  const gradeRow = r + 2;
  sm.getCell(`A${gradeRow}`).value = 'Grade';
  sm.getCell(`A${gradeRow}`).font = { bold: true };
  const rules = [...GRADE_RULES].sort((a, b) => b.minPct - a.minPct);
  sm.getCell(`B${gradeRow}`).value = {
    formula: `IF(G${r}="","",IF(G${r}>=${rules[0].minPct / 100},"A",IF(G${r}>=${rules[1].minPct / 100},"B",IF(G${r}>=${rules[2].minPct / 100},"C","D"))))`,
  };
  sm.getCell(`A${gradeRow + 1}`).value = 'Aturan grade';
  sm.getCell(`B${gradeRow + 1}`).value = rules.map((g) => `${g.grade} ≥ ${g.minPct}%`).join(' · ');
  sm.getCell(`A${gradeRow + 3}`).value = 'Store';
  sm.getCell(`B${gradeRow + 3}`).value = audit.storeName;
  sm.getCell(`A${gradeRow + 4}`).value = 'Tanggal / Shift';
  sm.getCell(`B${gradeRow + 4}`).value = `${audit.date} / ${audit.shift}`;
  sm.getCell(`A${gradeRow + 5}`).value = 'Auditor';
  sm.getCell(`B${gradeRow + 5}`).value = audit.auditorName;
  sm.getCell(`A${gradeRow + 6}`).value = 'Status';
  sm.getCell(`B${gradeRow + 6}`).value = audit.status;

  // ---- Sheet 3: Action Plan (item kritikal) ----
  const ap = wb.addWorksheet('Action Plan');
  ap.columns = [
    { header: 'No', key: 'no', width: 5 },
    { header: 'Masalah (Area)', key: 'area', width: 30 },
    { header: 'Akar Penyebab (temuan)', key: 'cause', width: 50 },
    { header: 'Tindakan', key: 'action', width: 45 },
    { header: 'PIC', key: 'pic', width: 16 },
    { header: 'Target', key: 'target', width: 14 },
    { header: 'Deadline', key: 'deadline', width: 12 },
    { header: 'Indikator Keberhasilan', key: 'kpi', width: 28 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Evidence', key: 'evidence', width: 30 },
  ];
  ap.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ap.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF26522' } };
  for (const it of items) {
    const score = effectiveScore(it);
    if (score === null || score > 3) continue;
    ap.addRow({
      no: it.no,
      area: it.area,
      cause: it.ai ? it.ai.issues.join('; ') || it.ai.findings : '',
      action: it.ai?.recommendation ?? '',
      pic: '',
      target: 'Skor ≥ 4',
      deadline: '',
      kpi: 'Re-audit skor ≥ 4',
      status: 'Open',
      evidence: '',
    }).alignment = { vertical: 'top', wrapText: true };
  }
  for (let i = 2; i <= Math.max(ap.rowCount, 2) + 20; i += 1) {
    ap.getCell(`I${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Open,In Progress,Done"'] };
  }

  const buf = await wb.xlsx.writeBuffer();
  download(buf, `Audit_${audit.storeName.replace(/\s+/g, '_')}_${audit.date}_${audit.shift}.xlsx`);
}

/** Export rekap banyak audit (dashboard). */
export async function exportRecapExcel(audits: Audit[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rekap Audit', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cats = CATEGORY_ORDER;
  ws.columns = [
    { header: 'Tanggal', key: 'date', width: 12 },
    { header: 'Store', key: 'store', width: 22 },
    { header: 'Shift', key: 'shift', width: 8 },
    { header: 'Auditor', key: 'auditor', width: 18 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Item Dinilai', key: 'scored', width: 11 },
    { header: 'Total Skor', key: 'sum', width: 10 },
    { header: 'Skor Maks', key: 'max', width: 10 },
    { header: 'Persentase', key: 'pct', width: 11 },
    { header: 'Grade', key: 'grade', width: 7 },
    { header: 'Item Kritikal', key: 'crit', width: 11 },
    ...cats.map((c) => ({ header: `% ${c.label}`, key: c.code, width: 16 })),
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF26522' } };
  audits.forEach((a, idx) => {
    const r = idx + 2;
    const row: Record<string, unknown> = {
      date: a.date,
      store: a.storeName,
      shift: a.shift,
      auditor: a.auditorName,
      status: a.status,
      scored: a.summary.scoredCount,
      sum: a.summary.sum,
      max: a.summary.max,
      pct: { formula: `IF(H${r}=0,"",G${r}/H${r})` },
      grade: a.summary.grade ?? '',
      crit: a.summary.criticalCount,
    };
    for (const c of cats) {
      const cs = a.summary.categories.find((x) => x.code === c.code);
      row[c.code] = cs?.pct !== null && cs?.pct !== undefined ? cs.pct / 100 : null;
    }
    ws.addRow(row);
  });
  ws.getColumn('pct').numFmt = '0.0%';
  for (const c of cats) ws.getColumn(c.code).numFmt = '0.0%';
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + ws.columns.length)}${ws.rowCount}` };
  const buf = await wb.xlsx.writeBuffer();
  download(buf, `Rekap_Audit_Kebersihan_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function download(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
