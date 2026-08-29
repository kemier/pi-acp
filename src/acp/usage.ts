/** Map Pi session stats / usage to ACP usage_update fields. */

export type UsageUpdatePayload = {
  used: number
  size: number
  cost?: { amount: number; currency: string }
}

export function tokensFromUsage(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  if (typeof u.totalTokens === 'number' && Number.isFinite(u.totalTokens)) {
    return u.totalTokens
  }
  const parts = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
  let sum = 0
  let any = false
  for (const key of parts) {
    const v = u[key]
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v
      any = true
    }
  }
  return any ? sum : null
}

export function buildUsageUpdateFromStats(stats: unknown): UsageUpdatePayload | null {
  if (!stats || typeof stats !== 'object') return null
  const s = stats as Record<string, unknown>
  const cu = s.contextUsage
  if (cu && typeof cu === 'object') {
    const ctx = cu as Record<string, unknown>
    const size = typeof ctx.contextWindow === 'number' ? ctx.contextWindow : null
    if (!size || size <= 0) return null

    let used: number | null = null
    if (typeof ctx.tokens === 'number' && Number.isFinite(ctx.tokens)) {
      used = ctx.tokens
    } else if (typeof ctx.percent === 'number' && Number.isFinite(ctx.percent)) {
      used = Math.round((size * ctx.percent) / 100)
    }

    if (used === null) return null

    return {
      used: Math.min(Math.max(0, used), size),
      size,
      ...costFromStats(s)
    }
  }

  const tokens = s.tokens
  const total = tokens && typeof tokens === 'object' ? tokensFromUsage(tokens) : null
  if (total === null) return null

  // Without contextUsage, we can't show a meaningful ring denominator.
  return null
}

export function buildUsageUpdateFromTurnUsage(
  usage: unknown,
  contextWindow: number | null,
  stats?: unknown
): UsageUpdatePayload | null {
  const usedRaw = tokensFromUsage(usage)
  if (usedRaw === null) return buildUsageUpdateFromStats(stats)

  const fromStats = buildUsageUpdateFromStats(stats)
  const size = contextWindow && contextWindow > 0 ? contextWindow : fromStats?.size
  if (!size) return fromStats

  return {
    used: Math.min(Math.max(0, usedRaw), size),
    size,
    ...costFromStats(
      stats && typeof stats === 'object' ? (stats as Record<string, unknown>) : ({} as Record<string, unknown>)
    )
  }
}

function costFromStats(stats: Record<string, unknown>): { cost?: UsageUpdatePayload['cost'] } {
  if (typeof stats.cost !== 'number' || !Number.isFinite(stats.cost)) return {}
  return { cost: { amount: stats.cost, currency: 'USD' } }
}
