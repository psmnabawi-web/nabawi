import type { IndicatorCategoryCode } from './indicators';

export type Role = 'crew' | 'manager' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: Role;
  /** Super admin: admin dari ADMIN_EMAILS (env). Hanya super admin yang bisa memakai Audit Kualitas Produk. Tidak bisa diberikan lewat UI. */
  superAdmin?: boolean;
  storeId: string | null;
  storeName: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export function isSuperAdmin(p: UserProfile | null | undefined): boolean {
  return !!p && p.role === 'admin' && p.superAdmin === true;
}

export interface Store {
  id: string;
  code: string;
  name: string;
  city: string;
  active: boolean;
  /** Indikator yang tidak berlaku di store ini (mis. tidak punya Gas Room). Tidak dimuat saat membuat audit. */
  excludedIndicatorIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export type Shift = 'PAGI' | 'SIANG' | 'MALAM';
export type AuditStatus = 'draft' | 'submitted';
export type ItemStatus = 'pending' | 'scored' | 'invalid' | 'override' | 'skipped';

export interface ActionStep {
  step: string;
  detail: string;
  tool: string;
  check: string;
}

export interface AiResult {
  photoValid: boolean;
  photoIssue: string | null;
  score: number | null;
  findings: string;
  issues: string[];
  metCriteria: string[];
  recommendation: string;
  /** Apakah foto memperlihatkan seluruh area. partial/unclear -> skor dibatasi maksimal 3. */
  coverage?: 'full' | 'partial' | 'unclear';
  /** Bagian area yang tidak terlihat di foto dan wajib difoto. */
  hiddenZones?: string[];
  /** Penyesuaian ketat yang diterapkan server (mis. skor diturunkan karena coverage parsial). */
  adjustments?: string[];
  /** Jumlah foto yang dinilai bersama. */
  photoCount?: number;
  /** Rencana perbaikan rinci (hanya diisi jika skor di bawah batas lolos atau foto tidak valid). */
  actionPlan?: ActionStep[];
  /** Ciri yang harus terlihat di foto ulang agar lolos batas. */
  passChecklist?: string[];
  /** Perkiraan waktu pengerjaan (menit). */
  estimatedMinutes?: number | null;
  confidence: 'high' | 'medium' | 'low';
  model: string;
  analyzedAt: number;
}

export interface AttemptRecord {
  at: number;
  score: number | null;
  photoValid: boolean;
  photoUrl: string | null;
  photoUrls?: string[];
  byName: string | null;
}

export interface AuditItem {
  id: string;
  auditId: string;
  indicatorId: string;
  no: number;
  categoryCode: IndicatorCategoryCode;
  category: string;
  area: string;
  standard: string;
  status: ItemStatus;
  photoUrl: string | null;
  photoPath: string | null;
  /** Sampai 3 foto per area (foto 1 = keseluruhan, berikutnya detail). photoUrl = foto pertama. */
  photoUrls?: string[];
  photoPaths?: string[];
  capturedAt: number | null;
  capturedByUid: string | null;
  capturedByName: string | null;
  crewNote: string | null;
  ai: AiResult | null;
  finalScore: number | null;
  overrideScore: number | null;
  overrideNote: string | null;
  overrideByUid: string | null;
  overrideByName: string | null;
  overrideAt: number | null;
  /** Kunci per area: crew menekan "Submit Area" setelah skor >= batas. Area berikutnya baru terbuka setelah ini. */
  locked?: boolean;
  lockedAt?: number | null;
  lockedByUid?: string | null;
  lockedByName?: string | null;
  /** Jumlah analisa AI yang sudah dilakukan (foto ulang menambah hitungan). */
  attempts?: number;
  /** Skor AI pada percobaan pertama: kondisi awal sebelum dibersihkan. */
  firstAiScore?: number | null;
  history?: AttemptRecord[];
  /** Crew minta verifikasi manager setelah berulang kali gagal. */
  reviewRequested?: boolean;
  reviewNote?: string | null;
  reviewRequestedAt?: number | null;
  reviewRequestedByName?: string | null;
  /** Area dilewati oleh manager/admin (mis. renovasi). Tidak dihitung dalam skor. */
  skipNote?: string | null;
  skippedByName?: string | null;
  updatedAt: number;
}

export interface CategoryScore {
  code: IndicatorCategoryCode;
  label: string;
  total: number;
  scored: number;
  sum: number;
  max: number;
  avg: number | null;
  pct: number | null;
}

export interface AuditSummary {
  itemCount: number;
  scoredCount: number;
  invalidCount: number;
  pendingCount: number;
  criticalCount: number;
  lockedCount: number;
  skippedCount: number;
  /** Total foto ulang (attempts - 1) di seluruh area. */
  retryCount: number;
  /** Area yang lolos batas pada percobaan pertama. */
  firstPassCount: number;
  /** Rata-rata skor AI percobaan pertama (%), kondisi awal sebelum dibersihkan. */
  firstPassPct: number | null;
  /** Area yang menunggu verifikasi manager. */
  reviewCount: number;
  reviewItems: { id: string; no: number; area: string; note: string | null }[];
  sum: number;
  max: number;
  avg: number | null;
  pct: number | null;
  grade: Grade | null;
  categories: CategoryScore[];
}

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface Audit {
  id: string;
  storeId: string;
  storeName: string;
  date: string; // YYYY-MM-DD
  shift: Shift;
  auditorUid: string;
  auditorName: string;
  status: AuditStatus;
  note: string | null;
  summary: AuditSummary;
  submittedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  uid: string;
  name: string;
  role: Role;
  details: Record<string, unknown>;
  at: number;
}

export const SHIFTS: { value: Shift; label: string }[] = [
  { value: 'PAGI', label: 'Pagi' },
  { value: 'SIANG', label: 'Siang' },
  { value: 'MALAM', label: 'Malam' },
];

export const ROLES: { value: Role; label: string }[] = [
  { value: 'crew', label: 'Crew' },
  { value: 'manager', label: 'Manager Store' },
  { value: 'admin', label: 'Admin' },
];

// ===================== Audit Kualitas Produk (super admin) =====================
import type { CheckSummary, EvidenceType, Gate, ProductId, Verdict } from './productChecklists';

export type ProductAuditStatus = 'draft' | 'submitted';
/** Sumber bukti yang dipakai AI untuk memutuskan satu item. */
export type EvidenceSource = 'photo' | 'measure' | 'note' | 'none';

export interface ProductItemAi {
  verdict: Verdict;
  /** Alasan singkat (Bahasa Indonesia), menyebut bukti yang dilihat/diukur. */
  reason: string;
  evidenceSource: EvidenceSource;
  /** Bukti yang masih kurang agar item bisa dinilai Ya (kosong jika sudah cukup). */
  missing: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ProductAuditItem {
  no: number;
  gate: Gate;
  stage: string;
  parameter: string;
  standard: string;
  evidence: EvidenceType;
  ai: ProductItemAi | null;
  /** Keputusan akhir yang dihitung ke skor: dari AI, atau koreksi inspector. */
  final: Verdict | null;
  finalSource: 'ai' | 'inspector' | null;
  inspectorNote: string | null;
  inspectorAt: number | null;
}

export interface ProductAuditAi {
  model: string;
  analyzedAt: number;
  /** Ringkasan temuan keseluruhan 2-4 kalimat. */
  summary: string;
  /** Risiko keamanan/kualitas yang perlu ditindak segera. */
  risks: string[];
  /** Rekomendasi perbaikan berurutan. */
  recommendations: string[];
  /** Bukti yang perlu ditambahkan agar audit bisa lengkap. */
  missingEvidence: string[];
  photoCount: number;
  adjustments: string[];
}

export interface ProductAudit {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  productId: ProductId;
  productName: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  /** Pemeriksaan ke-n di bulan itu (target 4x per produk per bulan). */
  checkNo: number;
  inspectorUid: string;
  inspectorName: string;
  status: ProductAuditStatus;
  photoUrls: string[];
  photoPaths: string[];
  photoLabels: string[];
  /** Hasil pengukuran inspector (key = MEASURE_FIELDS.key). */
  measures: Record<string, number | null>;
  /** Catatan pengamatan inspector: proses, sensori (aroma/rasa/tekstur), label/traceability. */
  notes: { process: string | null; sensory: string | null; label: string | null };
  items: ProductAuditItem[];
  ai: ProductAuditAi | null;
  summary: CheckSummary;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  submittedByName: string | null;
}

// ===================== Notifikasi laporan scoring (WhatsApp/Telegram) =====================
export type NotifyProvider = 'fonnte' | 'wablas' | 'telegram';

export interface NotifySettings {
  enabled: boolean;
  provider: NotifyProvider;
  /** Token perangkat (Fonnte), token.secret (Wablas), atau token bot (Telegram). Disimpan hanya di server. */
  token: string;
  /** ID grup WhatsApp (xxx@g.us) atau chat_id grup Telegram (negatif). Dipertahankan untuk kompatibilitas; pakai targets. */
  target: string;
  /** Daftar grup tujuan (bisa lebih dari satu). */
  targets?: string[];
  /** Khusus Wablas: server perangkat, mis. https://bdg.wablas.com */
  baseUrl: string;
  /** Jam kirim (WIB), informasi saja: jadwal sebenarnya di Cloud Scheduler. */
  schedule: string;
  updatedAt: number;
  updatedByName: string | null;
  lastSentAt: number | null;
  lastResult: string | null;
}
