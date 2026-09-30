'use client';

import { Badge } from './ui';
import { DECISION_COLOR, type Gate, type Verdict } from '@/lib/productChecklists';

export const GATE_COLOR: Record<Gate, string> = { CRITICAL: '#e34948', MAJOR: '#eda100', CONTROL: '#2a78d6' };
export const VERDICT_LABEL: Record<Verdict, string> = { ya: 'Ya', tidak: 'Tidak', na: 'N/A' };
export const VERDICT_COLOR: Record<Verdict, string> = { ya: '#008300', tidak: '#e34948', na: '#9a9994' };

export function GateBadge({ gate }: { gate: Gate }) {
  return <Badge color={GATE_COLOR[gate]}>{gate}</Badge>;
}

export function DecisionBadge({ decision, className }: { decision: string; className?: string }) {
  return (
    <Badge color={DECISION_COLOR[decision] ?? '#9a9994'} className={className}>
      {decision}
    </Badge>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <Badge color="#9a9994">Belum</Badge>;
  return <Badge color={VERDICT_COLOR[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}

export function scorePctColor(score: number | null): string {
  if (score === null) return '#9a9994';
  if (score >= 90) return '#008300';
  if (score >= 75) return '#2a78d6';
  if (score >= 50) return '#eda100';
  return '#e34948';
}
