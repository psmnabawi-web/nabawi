import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CalendarEntryModal } from '../components/calendar/CalendarEntryModal'
import { PlatformIcon } from '../components/PlatformIcon'
import { Alert, Badge, Button, EmptyState, PageHeader } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useCollection } from '../hooks/useFirestore'
import { useStoreScope } from '../hooks/useStoreScope'
import { useToast } from '../hooks/useToast'
import { calendarQuery, isContentManager, recentScoped } from '../services/firestore'
import type { CalendarEntry, ContentIdea, GeneratedVideo } from '../types'
import { cn } from '../utils/cn'
import { CALENDAR_STATUS_STYLES, CALENDAR_STATUSES } from '../utils/constants'
import { dateKey } from '../utils/format'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

/** Month grid cells (Monday first) incl. leading/trailing days of adjacent months. */
function buildMonth(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: { key: string; day: number; inMonth: boolean }[] = []
  for (let i = lead; i > 0; i -= 1) {
    const d = new Date(Date.UTC(year, month, 1 - i))
    cells.push({ key: keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), day: d.getUTCDate(), inMonth: false })
  }
  for (let d = 1; d <= days; d += 1) cells.push({ key: keyOf(year, month, d), day: d, inMonth: true })
  while (cells.length % 7 !== 0) {
    const d = new Date(Date.UTC(year, month + 1, cells.length - lead - days + 1))
    cells.push({ key: keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), day: d.getUTCDate(), inMonth: false })
  }
  return cells
}

export default function CampaignCalendarPage() {
  const { profile } = useAuth()
  const { selectedStoreId } = useStoreScope()
  const toast = useToast()
  const canEdit = isContentManager(profile)
  const today = dateKey()
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const cells = useMemo(() => buildMonth(cursor.year, cursor.month), [cursor])
  const from = cells[0].key
  const to = cells[cells.length - 1].key
  const deps = [profile?.uid, profile?.role, profile?.storeId, selectedStoreId]
  const entries = useCollection<CalendarEntry>(() => calendarQuery(profile, selectedStoreId, from, to), [...deps, from, to])
  const ideas = useCollection<ContentIdea>(() => (canEdit ? recentScoped('content_ideas', profile, selectedStoreId, 100) : null), deps)
  const videos = useCollection<GeneratedVideo>(() => recentScoped('generated_videos', profile, selectedStoreId, 100), deps)
  const [modal, setModal] = useState<{ entry: CalendarEntry | null; date: string } | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const e of entries.data) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return map
  }, [entries.data])
  const monthEntries = entries.data.filter((e) => e.date.startsWith(`${cursor.year}-${pad(cursor.month + 1)}`))

  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(cursor.year, cursor.month, 15)))
  const shift = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + delta, 1))
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
    })

  return (
    <>
      <PageHeader
        title="Campaign Calendar"
        description="Plan and track when each piece of content goes live."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setModal({ entry: null, date: today })}>
              Schedule content
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" aria-label="Previous month" icon={<ChevronLeft className="size-4" />} onClick={() => shift(-1)} />
          <Button variant="outline" size="sm" aria-label="Next month" icon={<ChevronRight className="size-4" />} onClick={() => shift(1)} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const [y, m] = today.split('-').map(Number)
              setCursor({ year: y, month: m - 1 })
            }}
          >
            Today
          </Button>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{monthLabel}</h2>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {CALENDAR_STATUSES.map((s) => (
            <Badge key={s} className={CALENDAR_STATUS_STYLES[s]}>
              {s}
            </Badge>
          ))}
        </div>
      </div>
      {entries.error && (
        <div className="mb-4">
          <Alert>{entries.error}</Alert>
        </div>
      )}

      {/* Month grid (tablet/desktop) */}
      <div className="card hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c) => {
            const list = byDay.get(c.key) ?? []
            return (
              <div key={c.key} className={cn('group min-h-28 border-r border-b border-slate-100 p-1.5 [&:nth-child(7n)]:border-r-0', !c.inMonth && 'bg-slate-50/60')}>
                <div className="flex items-center justify-between">
                  <span className={cn('flex size-6 items-center justify-center rounded-full text-xs tabular-nums', c.key === today ? 'bg-brand-900 font-semibold text-white' : c.inMonth ? 'text-slate-700' : 'text-slate-400')}>{c.day}</span>
                  {canEdit && (
                    <button type="button" onClick={() => setModal({ entry: null, date: c.key })} className="rounded p-0.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 focus:opacity-100" aria-label={`Add entry on ${c.key}`}>
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
                <ul className="mt-1 space-y-1">
                  {list.map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => setModal({ entry: e, date: e.date })} className={cn('flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[11px] font-medium ring-1 ring-inset', CALENDAR_STATUS_STYLES[e.status])}>
                        <span className="truncate">{e.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {/* Agenda (mobile) */}
      <div className="md:hidden">
        {monthEntries.length ? (
          <ul className="card divide-y divide-slate-100">
            {monthEntries.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setModal({ entry: e, date: e.date })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <PlatformIcon platform={e.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{e.title}</p>
                    <p className="text-xs text-slate-500">{e.date}</p>
                  </div>
                  <Badge className={CALENDAR_STATUS_STYLES[e.status]}>{e.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<CalendarDays className="size-5" />} title="Nothing scheduled this month" />
        )}
      </div>

      <CalendarEntryModal
        key={modal ? `${modal.entry?.id ?? 'new'}-${modal.date}` : 'closed'}
        open={!!modal}
        entry={modal?.entry ?? null}
        date={modal?.date ?? today}
        canEdit={canEdit}
        ideas={ideas.data}
        videos={videos.data}
        onClose={() => setModal(null)}
        onDone={(msg) => {
          setModal(null)
          toast.success(msg)
        }}
      />
    </>
  )
}
