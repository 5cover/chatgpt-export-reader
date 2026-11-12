export type AnalysisScope = {
  timeZone: string
  startDate?: string
  endDate?: string
  projectId?: string
  sessionGapMinutes: number
}
export type Period = { startDate: string; endDate: string; days: number }
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
export const defaultScope = (): AnalysisScope => ({ timeZone: localTimeZone(), sessionGapMinutes: 60 })

export function shiftDate(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}
export function period(startDate?: string, endDate?: string): Period | undefined {
  if (!startDate || !endDate || startDate > endDate) return undefined
  return { startDate, endDate, days: Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1 }
}
export function previousPeriod(current: Period): Period {
  return {
    startDate: shiftDate(current.startDate, -current.days),
    endDate: shiftDate(current.startDate, -1),
    days: current.days,
  }
}
export function scopeKey(scope: AnalysisScope): string {
  return JSON.stringify(scope)
}
export function readScope(): AnalysisScope {
  const params = new URLSearchParams(location.search)
  const value = defaultScope()
  const zone = params.get('zone')
  if (zone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone })
      value.timeZone = zone
    } catch {
      /* Ignore invalid URL settings. */
    }
  }
  for (const key of ['startDate', 'endDate'] as const) {
    const date = params.get(key)
    if (
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().startsWith(date)
    )
      value[key] = date
  }
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    value.startDate = undefined
    value.endDate = undefined
  }
  if (params.has('project')) value.projectId = params.get('project') ?? ''
  const gap = Number(params.get('gap'))
  if (Number.isInteger(gap) && gap >= 1 && gap <= 1440) value.sessionGapMinutes = gap
  return value
}
export function writeScope(scope: AnalysisScope): void {
  const url = new URL(location.href)
  for (const key of ['startDate', 'endDate'] as const) {
    if (scope[key]) url.searchParams.set(key, scope[key])
    else url.searchParams.delete(key)
  }
  url.searchParams.set('zone', scope.timeZone)
  if (scope.projectId !== undefined) url.searchParams.set('project', scope.projectId)
  else url.searchParams.delete('project')
  url.searchParams.set('gap', String(scope.sessionGapMinutes))
  history.replaceState(null, '', url)
}
