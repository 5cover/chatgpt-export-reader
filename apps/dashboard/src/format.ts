export const formatNumber = (value: number) => value.toLocaleString()
export const formatShare = (value: number) => `${Math.round(value * 100)}%`
export const formatRatio = (value: number | null) => (value === null ? 'Not available' : `${value.toFixed(1)}x`)
export function formatDuration(value: number): string {
  if (value <= 0) return '0m'
  if (value < 60_000) return '<1m'
  const minutes = Math.round(value / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
export function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}
export function formatByteSize(value: number): string {
  if (value < 1024) return `${value.toLocaleString()} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
export const weekdayName = (day: number, short = false) =>
  (short
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])[day]!
export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
