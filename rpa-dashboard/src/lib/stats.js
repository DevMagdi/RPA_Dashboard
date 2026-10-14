/**
 * Lightweight trend maths for KPI surfaces.
 *
 * Everything here works off the two 14-day series the dashboard payload
 * already ships (`charts.volume`, `charts.savings`) — no synthetic data, no
 * extra requests.  Deltas are relative % changes between the last two 7-day
 * windows, which reads naturally as an arrow next to a headline number.
 */

/** Relative % change of `key` between the last two 7-day windows of a series. */
export function seriesDelta(rows, key) {
  const values = (rows || []).map((row) => Number(row?.[key]) || 0)
  if (values.length < 8) return null
  const recent = values.slice(-7).reduce((sum, value) => sum + value, 0)
  const previous = values.slice(-14, -7).reduce((sum, value) => sum + value, 0)
  if (previous <= 0) return null
  return ((recent - previous) / previous) * 100
}

/** Relative % change of success rate (completed / volume) across two windows. */
export function rateDelta(rows) {
  const volume = (rows || []).map((row) => Number(row?.volume) || 0)
  const completed = (rows || []).map((row) => Number(row?.completed) || 0)
  if (volume.length < 8) return null
  const sum = (values, from, to) => values.slice(from, to).reduce((total, value) => total + value, 0)
  const volRecent = sum(volume, -7)
  const volPrevious = sum(volume, -14, -7)
  if (volRecent <= 0 || volPrevious <= 0) return null
  const recentRate = sum(completed, -7) / volRecent
  const previousRate = sum(completed, -14, -7) / volPrevious
  if (previousRate <= 0) return null
  return ((recentRate - previousRate) / previousRate) * 100
}
