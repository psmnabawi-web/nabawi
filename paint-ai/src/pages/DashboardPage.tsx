import {
  Activity,
  ArrowRight,
  BookOpen,
  Clapperboard,
  Eye,
  Flame,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  Store as StoreIcon,
  Trophy,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AiActivityChart } from "../components/charts/AiActivityChart";
import { ContentGrowthChart } from "../components/charts/ContentGrowthChart";
import { PlatformBarChart } from "../components/charts/PlatformBarChart";
import { AppGuideModal } from "../components/dashboard/AppGuideModal";
import { RoleGate } from "../components/layout/Guards";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ScoreRing,
  Skeleton,
  StatCard,
} from "../components/ui";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { useAuth } from "../hooks/useAuth";
import { useCollection, useDocument } from "../hooks/useFirestore";
import { useStoreScope } from "../hooks/useStoreScope";
import { useToast } from "../hooks/useToast";
import {
  isAdmin,
  isContentManager,
  recentScoped,
  statsDocId,
} from "../services/firestore";
import { calculatePerformance } from "../services/functions";
import type { AiActivity, GeneratedVideo, StatsDoc } from "../types";
import { BRAND, VIDEO_STATUS_STYLES } from "../utils/constants";
import {
  formatCompact,
  formatNumber,
  formatPercent,
  timeAgo,
} from "../utils/format";

function TableToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-xs font-medium text-brand-800 hover:underline"
      aria-pressed={on}
    >
      {on ? "Show chart" : "Show table"}
    </button>
  );
}

function BrandHero({
  scopeLabel,
  updatedAt,
}: {
  scopeLabel: string;
  updatedAt?: string;
}) {
  const { profile } = useAuth();
  const { stores } = useStoreScope();
  const active = stores.filter((s) => s.status === "active").length;
  return (
    <section className="mb-6 flex flex-col gap-5 rounded-3xl bg-gradient-to-br from-brand-50 via-[#f0effa] to-[#e8e6f7] p-6 shadow-soft ring-1 ring-slate-900/[0.03] sm:flex-row sm:items-center sm:p-8">
      <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5 sm:size-[72px]">
        <img src={BRAND.markUrl} alt="" className="h-10 w-auto sm:h-11" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-2xl font-bold tracking-wide text-slate-900 uppercase">
          {BRAND.name}
        </h2>
        <p className="text-[15px] text-slate-600">{BRAND.tagline}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
          <StoreIcon className="size-4" aria-hidden />
          <span className="font-medium text-slate-700">{scopeLabel}</span>
          {isContentManager(profile) && (
            <span>
              · {formatNumber(active)} active{" "}
              {active === 1 ? "store" : "stores"}
            </span>
          )}
          {updatedAt && <span>· updated {updatedAt}</span>}
        </p>
      </div>
      {isAdmin(profile) && (
        <Link to="/settings?tab=stores" className="self-start sm:self-center">
          <Button
            variant="outline"
            icon={<Plus className="size-4" />}
            className="shadow-sm"
          >
            Add store
          </Button>
        </Link>
      )}
    </section>
  );
}

function TodaysTrend({
  trend,
  loading,
}: {
  trend: StatsDoc["topTrend"] | undefined;
  loading: boolean;
}) {
  const navigate = useNavigate();
  return (
    <section
      className="card mb-6 rounded-3xl p-6 sm:p-8"
      aria-label="Today's trend"
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : trend ? (
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <ScoreRing score={trend.trendScore} size={96} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-brand-700 uppercase">
              <Flame className="size-4" aria-hidden /> Today&apos;s trend
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {trend.trendName}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Trend score{" "}
              <strong className="text-slate-800 tabular-nums">
                {trend.trendScore}
              </strong>{" "}
              / 100
              {trend.growthLevel && <> · {trend.growthLevel}</>}
              {trend.platform && <> · {trend.platform}</>}
            </p>
            <div className="mt-4 rounded-2xl bg-brand-50 px-4 py-3">
              <p className="text-xs font-semibold text-brand-800">
                AI recommendation
              </p>
              <p className="mt-0.5 text-sm text-slate-800">
                {trend.recommendation || "—"}
              </p>
            </div>
          </div>
          <RoleGate roles={["super_admin", "marketing_manager"]}>
            <div className="flex shrink-0 flex-row flex-wrap gap-2 sm:flex-col">
              <Button
                icon={<Sparkles className="size-4" />}
                onClick={() => navigate(`/content?trendId=${trend.id}`)}
              >
                Generate ideas
              </Button>
              <Button
                variant="outline"
                icon={<Clapperboard className="size-4" />}
                onClick={() => navigate("/video")}
              >
                Create video
              </Button>
            </div>
          </RoleGate>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-brand-700 uppercase">
              <Flame className="size-4" aria-hidden /> Today&apos;s trend
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">
              No trend analyzed yet
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Add a TikTok, Instagram or YouTube source and let AI score it.
            </p>
          </div>
          <Link to="/trends">
            <Button
              variant="secondary"
              icon={<TrendingUp className="size-4" />}
            >
              Go to Trend Intelligence
            </Button>
          </Link>
        </div>
      )}
    </section>
  );
}

function ActivitySection({
  activity,
  loading,
  onRecalculate,
  recalculating,
}: {
  activity?: AiActivity;
  loading: boolean;
  onRecalculate: () => void;
  recalculating: boolean;
}) {
  const [table, setTable] = useState(false);
  const sum = (key: "trends" | "ideas" | "scripts" | "videos") =>
    (activity?.days ?? []).reduce((n, d) => n + d[key], 0);
  const results = activity?.videoResults;
  const tiles = [
    {
      label: "Succeeded",
      value: results?.succeeded,
      className: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Failed",
      value: results?.failed,
      className: "bg-rose-50 text-rose-700",
    },
    {
      label: "Processing",
      value: results?.processing,
      className: "bg-brand-50 text-brand-800",
    },
  ];
  const breakdown = [
    { label: "Trend analyses", value: sum("trends") },
    { label: "Idea generations", value: sum("ideas") },
    { label: "Scripts", value: sum("scripts") },
    { label: "Video jobs", value: sum("videos") },
  ];

  return (
    <section
      className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3"
      aria-label="AI activity"
    >
      <div className="card rounded-3xl p-6 xl:col-span-2">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">AI activity</h2>
            <p className="text-sm text-slate-500">
              Last 30 days in this scope.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[28px] leading-none font-semibold text-slate-900 tabular-nums">
              {activity ? formatNumber(activity.total) : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">activities recorded</p>
            {activity && (
              <div className="mt-1">
                <TableToggle on={table} onToggle={() => setTable((t) => !t)} />
              </div>
            )}
          </div>
        </div>
        {activity ? (
          <AiActivityChart days={activity.days} showTable={table} />
        ) : loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <EmptyState
            icon={<Activity className="size-5" />}
            title="Activity chart not calculated yet"
            description="It appears after the next hourly recalculation."
            action={
              <RoleGate roles={["super_admin", "marketing_manager"]}>
                <Button
                  size="sm"
                  loading={recalculating}
                  onClick={onRecalculate}
                >
                  Calculate now
                </Button>
              </RoleGate>
            }
          />
        )}
      </div>

      <div className="card flex flex-col rounded-3xl p-6">
        <h2 className="text-lg font-bold text-slate-900">Activity summary</h2>
        <p className="text-sm text-slate-500">
          Video results in the last 30 days.
        </p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {tiles.map((t) => (
            <div
              key={t.label}
              className={`rounded-2xl px-3 py-4 ${t.className}`}
            >
              <p className="text-2xl font-semibold tabular-nums">
                {results ? formatNumber(t.value) : "—"}
              </p>
              <p className="mt-1 text-xs font-medium">{t.label}</p>
            </div>
          ))}
        </div>
        <dl className="mt-5 divide-y divide-slate-100 text-sm">
          {breakdown.map((b) => (
            <div
              key={b.label}
              className="flex items-center justify-between py-2"
            >
              <dt className="text-slate-600">{b.label}</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {activity ? formatNumber(b.value) : "—"}
              </dd>
            </div>
          ))}
        </dl>
        <Link
          to="/video"
          className="mt-auto flex items-center justify-between rounded-2xl px-1 pt-4 text-[15px] font-medium text-slate-900 hover:text-brand-800"
        >
          View activity <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const { selectedStoreId, storeName } = useStoreScope();
  const toast = useToast();
  const statsId = statsDocId(profile, selectedStoreId);
  const stats = useDocument<StatsDoc>(statsId ? `stats/${statsId}` : null);
  const recent = useCollection<GeneratedVideo>(
    () => recentScoped("generated_videos", profile, selectedStoreId, 5),
    [profile?.uid, profile?.role, profile?.storeId, selectedStoreId],
  );
  const refresh = useAsyncAction(() => calculatePerformance({}));
  const [tables, setTables] = useState({ growth: false, platform: false });
  const [guideOpen, setGuideOpen] = useState(false);

  const s = stats.data;
  const top = s?.topContent?.[0];
  const firstName = (profile?.name ?? "").trim().split(/\s+/)[0];
  const scopeLabel = isContentManager(profile)
    ? selectedStoreId === ""
      ? "All stores"
      : selectedStoreId === "ALL"
        ? "Brand-wide content"
        : storeName(selectedStoreId)
    : storeName(profile?.storeId);

  const onRefresh = async () => {
    const res = await refresh.run();
    if (res) toast.success("Dashboard numbers recalculated.");
    else if (refresh.error) toast.error(refresh.error);
  };

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[30px]">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">
            Monitor your brand and continue your work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RoleGate roles={["super_admin", "marketing_manager"]}>
            <Button
              variant="outline"
              icon={<RefreshCw className="size-4" />}
              loading={refresh.loading}
              onClick={onRefresh}
            >
              Recalculate
            </Button>
          </RoleGate>
          <Button
            variant="outline"
            icon={<BookOpen className="size-4" />}
            onClick={() => setGuideOpen(true)}
          >
            Learn the app
          </Button>
        </div>
      </div>

      {stats.error && (
        <div className="mb-6">
          <Alert>{stats.error}</Alert>
        </div>
      )}

      <BrandHero
        scopeLabel={scopeLabel || "—"}
        updatedAt={s?.updatedAt ? timeAgo(s.updatedAt) : undefined}
      />

      {/* KPIs */}
      {/* Container query: 4 across only when each card gets enough width (sidebar expanded vs collapsed). */}
      <section className="@container mb-6" aria-label="Key statistics">
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @6xl:grid-cols-4">
          <StatCard
            label="Generated videos"
            icon={<Clapperboard className="size-6" />}
            value={stats.loading ? "…" : formatNumber(s?.totals.videos)}
            hint={
              s
                ? `${formatNumber(s.totals.completedVideos)} ready · ${formatNumber(s.statusBreakdown?.Processing ?? 0)} processing`
                : undefined
            }
            link={{ to: "/video", label: "Video Studio" }}
          />
          <StatCard
            label="Published content"
            icon={<Send className="size-6" />}
            value={
              stats.loading ? "…" : formatNumber(s?.totals.publishedVideos)
            }
            hint={
              s
                ? `${formatNumber(s.totals.ideas)} ideas · ${formatNumber(s.totals.scripts)} scripts`
                : undefined
            }
            link={{ to: "/calendar", label: "Campaign Calendar" }}
          />
          <StatCard
            label="Average engagement"
            icon={<Rocket className="size-6" />}
            value={stats.loading ? "…" : formatPercent(s?.avgEngagementRate)}
            hint={
              s ? `${formatCompact(s.totals.views)} views tracked` : undefined
            }
            link={{ to: "/analytics", label: "View analytics" }}
          />
          <StatCard
            label="Top content"
            icon={<Trophy className="size-6" />}
            value={<span className="text-lg">{top ? top.title : "—"}</span>}
            hint={
              top
                ? `${formatCompact(top.views)} views · ${formatPercent(top.engagementRate)} ER · ${top.platform}`
                : "Record performance in Analytics"
            }
          />
        </div>
      </section>

      {!stats.loading && !s && (
        <div className="mb-6">
          <EmptyState
            icon={<RefreshCw className="size-5" />}
            title="No aggregated statistics yet"
            description="Statistics are recalculated every hour. Marketing managers can recalculate now."
            action={
              <RoleGate roles={["super_admin", "marketing_manager"]}>
                <Button loading={refresh.loading} onClick={onRefresh}>
                  Calculate now
                </Button>
              </RoleGate>
            }
          />
        </div>
      )}

      <TodaysTrend trend={s?.topTrend} loading={stats.loading} />

      <ActivitySection
        activity={s?.aiActivity}
        loading={stats.loading}
        onRecalculate={onRefresh}
        recalculating={refresh.loading}
      />

      {/* Charts */}
      <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="rounded-3xl">
          <CardHeader
            title="Content growth"
            subtitle="Items created per month (last 6 months)"
            action={
              <TableToggle
                on={tables.growth}
                onToggle={() => setTables((t) => ({ ...t, growth: !t.growth }))}
              />
            }
          />
          <CardBody>
            {s ? (
              <ContentGrowthChart
                data={s.contentGrowth}
                showTable={tables.growth}
              />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </CardBody>
        </Card>
        <Card className="rounded-3xl">
          <CardHeader
            title="Platform performance"
            subtitle="Views per platform (hover for engagement & leads)"
            action={
              <TableToggle
                on={tables.platform}
                onToggle={() =>
                  setTables((t) => ({ ...t, platform: !t.platform }))
                }
              />
            }
          />
          <CardBody>
            {s && s.platformPerformance.length ? (
              <PlatformBarChart
                data={s.platformPerformance}
                showTable={tables.platform}
              />
            ) : s ? (
              <EmptyState
                icon={<Eye className="size-5" />}
                title="No performance data yet"
                description="Publish a video and record its views, likes and leads in Analytics."
              />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="rounded-3xl">
          <CardHeader
            title="Top content"
            subtitle="Ranked by views"
            action={
              <Link
                to="/analytics"
                className="flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline"
              >
                Analytics <ArrowRight className="size-3" />
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {(s?.topContent ?? []).map((c, i) => (
              <li key={c.videoId} className="flex items-center gap-3 px-6 py-3">
                <span className="w-5 text-sm font-semibold text-slate-400 tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {c.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.platform} · {formatPercent(c.engagementRate)} engagement
                    · {formatNumber(c.leads)} leads
                  </p>
                </div>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">
                  {formatCompact(c.views)}
                </span>
              </li>
            ))}
            {s && !s.topContent.length && (
              <li className="px-6 py-6 text-sm text-slate-500">
                No tracked content yet.
              </li>
            )}
          </ul>
        </Card>
        <Card className="rounded-3xl">
          <CardHeader
            title="Recent videos"
            action={
              <Link
                to="/video"
                className="flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline"
              >
                Video Studio <ArrowRight className="size-3" />
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {recent.data.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-6 py-3">
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                  {v.thumbnail ? (
                    <img
                      src={v.thumbnail}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <Clapperboard className="size-4 text-slate-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {v.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {v.templateLabel} · {v.duration}s · {timeAgo(v.createdAt)}
                  </p>
                </div>
                <Badge className={VIDEO_STATUS_STYLES[v.status]}>
                  {v.status}
                </Badge>
              </li>
            ))}
            {!recent.loading && !recent.data.length && (
              <li className="px-6 py-6 text-sm text-slate-500">
                No videos yet.
              </li>
            )}
            {recent.error && (
              <li className="px-6 py-3 text-sm text-rose-600">
                {recent.error}
              </li>
            )}
          </ul>
        </Card>
      </section>

      <AppGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
