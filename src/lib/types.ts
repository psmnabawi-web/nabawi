import type { IndicatorCategoryCode } from './indicators';

export type Role = 'crew' | 'manager' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: Role;
  storeId: string | null;
  storeName: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
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

export interface AiResult {
  photoValid: boolean;
  photoIssue: string | null;
  score: number | null;
  findings: string;
  issues: string[];
  metCriteria: string[];
  recommendation: string;
  confidence: 'high' | 'medium' | 'low';
  model: string;
  analyzedAt: number;
}

export interface AttemptRecord {
  at: number;
  score: number | null;
  photoValid: boolean;
  photoUrl: string | null;
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
