import type { GeneratedVideo, PerformanceRecord, Platform, Store } from '../types'
import { PLATFORMS } from './constants'
import { performanceSchema, type PerformanceInput } from './validation'

/** exceljs is ~1 MB → loaded only when the user exports/imports. */
const loadExcel = async () => (await import('exceljs')).default

const HEADERS = ['Video ID', 'Title', 'Platform', 'Store', 'Views', 'Likes', 'Comments', 'Shares', 'Engagement Rate', 'Leads', 'Sales Impact (IDR)', 'Sales per Lead (IDR)', 'Published URL']

function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface ExportRow {
  videoId: string
  title: string
  platform: Platform | ''
  store: string
  views?: number
  likes?: number
  comments?: number
  shares?: number
  leads?: number
  salesImpact?: number
  publishedUrl?: string
}

export function buildExportRows(videos: GeneratedVideo[], performance: PerformanceRecord[], stores: Store[]): ExportRow[] {
  const perfById = new Map(performance.map((p) => [p.videoId, p]))
  const storeName = (id: string) => (id === 'ALL' ? 'All stores' : (stores.find((s) => s.id === id)?.storeName ?? id))
  return videos
    .filter((v) => v.status === 'Completed' || v.status === 'Published' || perfById.has(v.id))
    .map((v) => {
      const p = perfById.get(v.id)
      return {
        videoId: v.id,
        title: v.title,
        platform: p?.platform ?? v.platform ?? '',
        store: storeName(v.storeId),
        views: p?.views,
        likes: p?.likes,
        comments: p?.comments,
        shares: p?.shares,
        leads: p?.leads,
        salesImpact: p?.salesImpact,
        publishedUrl: p?.publishedUrl ?? v.publishedUrl ?? '',
      }
    })
}

/**
 * Exports an auditable workbook: raw metrics as values, every derived number as an Excel formula,
 * a totals row, and a per-platform summary built with SUMIF.
 */
export async function exportPerformanceWorkbook(rows: ExportRow[], { template = false } = {}) {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Content Intelligence'
  wb.created = new Date()

  const ws = wb.addWorksheet('Performance', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] })
  ws.columns = [
    { key: 'videoId', width: 24 },
    { key: 'title', width: 42 },
    { key: 'platform', width: 12 },
    { key: 'store', width: 22 },
    { key: 'views', width: 12 },
    { key: 'likes', width: 11 },
    { key: 'comments', width: 11 },
    { key: 'shares', width: 11 },
    { key: 'er', width: 16 },
    { key: 'leads', width: 10 },
    { key: 'sales', width: 20 },
    { key: 'spl', width: 20 },
    { key: 'url', width: 40 },
  ]
  const header = ws.addRow(HEADERS)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } }
  header.alignment = { vertical: 'middle' }
  header.height = 22

  rows.forEach((r, i) => {
    const n = i + 2
    // Template: keep existing numbers so users only fill the gaps; blank where nothing is recorded yet.
    const metric = (v?: number) => (template ? (v ?? null) : (v ?? 0))
    ws.addRow([
      r.videoId,
      r.title,
      r.platform,
      r.store,
      metric(r.views),
      metric(r.likes),
      metric(r.comments),
      metric(r.shares),
      { formula: `IF(N(E${n})>0,(N(F${n})+N(G${n})+N(H${n}))/E${n},0)` },
      metric(r.leads),
      metric(r.salesImpact),
      { formula: `IF(N(J${n})>0,K${n}/J${n},0)` },
      r.publishedUrl ?? '',
    ])
  })
  const last = rows.length + 1
  const total = ws.addRow([
    'TOTAL',
    `${rows.length} videos`,
    '',
    '',
    { formula: `SUM(E2:E${last})` },
    { formula: `SUM(F2:F${last})` },
    { formula: `SUM(G2:G${last})` },
    { formula: `SUM(H2:H${last})` },
    { formula: `IF(E${last + 1}>0,(F${last + 1}+G${last + 1}+H${last + 1})/E${last + 1},0)` },
    { formula: `SUM(J2:J${last})` },
    { formula: `SUM(K2:K${last})` },
    { formula: `IF(J${last + 1}>0,K${last + 1}/J${last + 1},0)` },
    '',
  ])
  total.font = { bold: true }
  total.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FF' } }

  for (const col of ['E', 'F', 'G', 'H', 'J']) ws.getColumn(col).numFmt = '#,##0'
  ws.getColumn('I').numFmt = '0.00%'
  ws.getColumn('K').numFmt = '"Rp" #,##0'
  ws.getColumn('L').numFmt = '"Rp" #,##0'
  ws.autoFilter = { from: 'A1', to: `M${last}` }

  // Input guard rails for the metric columns and platform.
  for (let r = 2; r <= last; r += 1) {
    ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: false, formulae: [`"${PLATFORMS.join(',')}"`], showErrorMessage: true, error: 'Choose TikTok, Instagram or YouTube' }
    for (const c of ['E', 'F', 'G', 'H', 'J']) {
      ws.getCell(`${c}${r}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, error: 'Whole number ≥ 0' }
    }
    ws.getCell(`K${r}`).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, error: 'Number ≥ 0' }
  }
  if (rows.length) {
    ws.addConditionalFormatting({
      ref: `I2:I${last}`,
      rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FF86B6EF' }] }],
    })
  }

  const summary = wb.addWorksheet('Summary by Platform', { views: [{ state: 'frozen', ySplit: 1 }] })
  summary.columns = [{ width: 14 }, { width: 10 }, { width: 14 }, { width: 18 }, { width: 10 }, { width: 20 }]
  const sh = summary.addRow(['Platform', 'Posts', 'Views', 'Engagement Rate', 'Leads', 'Sales Impact (IDR)'])
  sh.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F4B' } }
  const range = (c: string) => `Performance!$${c}$2:$${c}$${last}`
  PLATFORMS.forEach((p, i) => {
    const n = i + 2
    summary.addRow([
      p,
      { formula: `COUNTIF(${range('C')},A${n})` },
      { formula: `SUMIF(${range('C')},A${n},${range('E')})` },
      { formula: `IF(C${n}>0,(SUMIF(${range('C')},A${n},${range('F')})+SUMIF(${range('C')},A${n},${range('G')})+SUMIF(${range('C')},A${n},${range('H')}))/C${n},0)` },
      { formula: `SUMIF(${range('C')},A${n},${range('J')})` },
      { formula: `SUMIF(${range('C')},A${n},${range('K')})` },
    ])
  })
  summary.getColumn(3).numFmt = '#,##0'
  summary.getColumn(4).numFmt = '0.00%'
  summary.getColumn(5).numFmt = '#,##0'
  summary.getColumn(6).numFmt = '"Rp" #,##0'

  const notes = wb.addWorksheet('Notes')
  notes.getColumn(1).width = 110
  ;[
    'Engagement Rate = (Likes + Comments + Shares) / Views',
    'Sales per Lead = Sales Impact / Leads',
    'Sales Impact = revenue attributed to the content (input from sales team, IDR).',
    'To import: fill columns E-H, J-K and M on the Performance sheet, keep the Video ID column unchanged, then use Analytics > Import Excel.',
    `Exported: ${new Date().toISOString()}`,
  ].forEach((t) => notes.addRow([t]))

  const buffer = await wb.xlsx.writeBuffer()
  const stamp = new Date().toISOString().slice(0, 10)
  download(buffer as ArrayBuffer, template ? `performance-template-${stamp}.xlsx` : `performance-report-${stamp}.xlsx`)
}

export interface ImportResult {
  rows: (PerformanceInput & { videoId: string })[]
  errors: { row: number; message: string }[]
}

const cellValue = (v: unknown): unknown => {
  if (v && typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; hyperlink?: unknown }
    if ('result' in o) return o.result
    if ('text' in o) return o.text
    if ('hyperlink' in o) return o.hyperlink
  }
  return v
}

/** Reads the Performance sheet (exported template) and validates each row. */
export async function importPerformanceWorkbook(file: File, knownVideoIds: Set<string>): Promise<ImportResult> {
  if (file.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.')
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.getWorksheet('Performance') ?? wb.worksheets[0]
  if (!ws) throw new Error('The workbook has no sheets.')

  const headerRow = ws.getRow(1)
  const col: Record<string, number> = {}
  headerRow.eachCell((cell, idx) => {
    col[String(cellValue(cell.value) ?? '').trim().toLowerCase()] = idx
  })
  const need = ['video id', 'platform', 'views', 'likes', 'comments', 'shares', 'leads', 'sales impact (idr)']
  const missing = need.filter((h) => !col[h])
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}. Use the exported template.`)

  const result: ImportResult = { rows: [], errors: [] }
  const seen = new Set<string>()
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const get = (h: string) => cellValue(row.getCell(col[h]).value)
    const videoId = String(get('video id') ?? '').trim()
    if (!videoId || videoId === 'TOTAL') return
    if (!knownVideoIds.has(videoId)) {
      result.errors.push({ row: rowNumber, message: `Unknown video ID "${videoId}"` })
      return
    }
    if (seen.has(videoId)) {
      result.errors.push({ row: rowNumber, message: `Duplicate video ID "${videoId}"` })
      return
    }
    const views = get('views')
    if (views === null || views === undefined || views === '') return // untouched template row
    const parsed = performanceSchema.safeParse({
      platform: get('platform'),
      views,
      likes: get('likes') ?? 0,
      comments: get('comments') ?? 0,
      shares: get('shares') ?? 0,
      leads: get('leads') ?? 0,
      salesImpact: get('sales impact (idr)') ?? 0,
      publishedUrl: String((col['published url'] ? get('published url') : '') ?? ''),
    })
    if (!parsed.success) {
      result.errors.push({ row: rowNumber, message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      return
    }
    seen.add(videoId)
    result.rows.push({ videoId, ...parsed.data })
  })
  return result
}
