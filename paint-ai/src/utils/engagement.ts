/** Engagement rate (%) = (likes + comments + shares) / views × 100. Same formula as the backend. */
export function engagementRate({ views, likes, comments, shares }: { views: number; likes: number; comments: number; shares: number }) {
  const v = Number(views) > 0 ? Number(views) : 0
  if (!v) return 0
  const interactions = [likes, comments, shares].reduce((sum, n) => sum + (Number(n) > 0 ? Number(n) : 0), 0)
  return Math.round((interactions / v) * 100 * 100) / 100
}

/** Cost per lead and ROI helpers for the analytics page. Returns null when undefined. */
export function roi(salesImpact: number, cost: number): number | null {
  if (!cost || cost <= 0) return null
  return Math.round(((salesImpact - cost) / cost) * 10000) / 100
}
