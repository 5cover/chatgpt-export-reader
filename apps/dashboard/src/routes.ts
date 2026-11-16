import type { TemporalMessageFilter } from '@stemmatic/core'
export type Route =
  | { page: 'overview' | 'rhythm' | 'recap' | 'conversations' | 'about' | 'not-found' }
  | { page: 'projects'; id?: string }
  | { page: 'conversation' | 'session'; id: string }
  | { page: 'time'; filter: TemporalMessageFilter }
export function readRoute(): Route {
  try {
    const [page, section, role, weekday, hour] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
    if (!page) return { page: 'overview' }
    if ((page === 'rhythm' || page === 'patterns') && section === 'time') {
      const h = Number(hour),
        d = weekday === 'all' ? undefined : Number(weekday)
      if (
        (role === 'user' || role === 'assistant') &&
        Number.isInteger(h) &&
        h >= 0 &&
        h < 24 &&
        (d === undefined || (Number.isInteger(d) && d >= 0 && d < 7))
      )
        return { page: 'time', filter: { role, weekday: d, hour: h } }
      return { page: 'not-found' }
    }
    if (page === 'conversations') return section ? { page: 'conversation', id: section } : { page: 'conversations' }
    if (page === 'sessions' && section) return { page: 'session', id: section }
    if (page === 'projects') return { page: 'projects', id: section === '~unassigned' ? '' : section }
    if (page === 'patterns' || page === 'rhythm') return { page: 'rhythm' }
    if (page === 'about' || page === 'recap') return { page }
    return { page: 'not-found' }
  } catch {
    return { page: 'not-found' }
  }
}
export const temporalRoute = (filter: TemporalMessageFilter) =>
  `#/rhythm/time/${filter.role}/${filter.weekday ?? 'all'}/${filter.hour}`
export const sessionRoute = (id: string) => `#/sessions/${encodeURIComponent(id)}`
export function routeTitle(route: Route): string {
  return {
    overview: 'Overview',
    rhythm: 'Time and rhythm',
    recap: 'Recap',
    conversations: 'Conversations',
    about: 'About',
    projects: 'Projects',
    conversation: 'Conversation evidence',
    session: 'Session evidence',
    time: 'Time-slice evidence',
    'not-found': 'Page not found',
  }[route.page]
}
