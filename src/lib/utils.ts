export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function daysAgoISO(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString('id-ID', { maximumFractionDigits: digits });
}

export function scoreColor(score: number | null): string {
  if (score === null) return '#9a9994';
  if (score >= 4.5) return '#008300';
  if (score >= 4) return '#2a78d6';
  if (score >= 3) return '#eda100';
  return '#e34948';
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
