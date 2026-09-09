/* Combine the per-route shade / distance / safety numbers into one score
   using the user's slider weights, then rank the candidates. */

export function rankRoutes(routes, weights) {
  if (!routes.length) return []

  const wShade = clamp01(weights.shade)
  const wDistance = clamp01(weights.distance)
  const wSafety = clamp01(weights.safety)
  const wSum = wShade + wDistance + wSafety || 1

  const minDistance = Math.min(...routes.map((r) => r.distanceMeters || Infinity))

  const scored = routes.map((r) => {
    // Shorter routes score higher; the shortest gets 1.0.
    const distanceScore = minDistance && r.distanceMeters ? minDistance / r.distanceMeters : 0
    const shadeScore = clamp01(r.shade?.shadeFraction ?? 0)
    const safetyScore = clamp01(r.safety?.score ?? 0.5)

    const composite =
      (wShade * shadeScore + wDistance * distanceScore + wSafety * safetyScore) / wSum

    return { ...r, scores: { distanceScore, shadeScore, safetyScore }, composite }
  })

  scored.sort((a, b) => b.composite - a.composite)
  return scored.map((r, i) => ({ ...r, rank: i }))
}

function clamp01(n) {
  if (n == null || Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export const RANK_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f97316', '#64748b']

export function rankColor(rank) {
  return RANK_COLORS[Math.min(rank, RANK_COLORS.length - 1)]
}
