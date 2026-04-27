// Only 1 iteration, no scratch array

import sanitizeFilename from 'sanitize-filename'

export function mapfilter<T, U>(
    src: readonly T[],
    map: (item: T, i: number, array: readonly T[]) => U,
    filter: (item: U, i: number, array: readonly T[]) => unknown,
): U[]
export function mapfilter<T, U, V extends U>(
    src: readonly T[],
    map: (item: T, i: number, array: readonly T[]) => U,
    filter: (item: U, i: number, array: readonly T[]) => item is V,
): V[]
export function mapfilter<T, U>(
    src: readonly T[],
    map: (item: T, i: number, array: readonly T[]) => U,
    filter: (item: U, i: number, array: readonly T[]) => unknown,
): U[] {
    const dst: U[] = []
    src.forEach((x, i, src) => {
        const y = map(x, i, src)
        if (filter(y, i, src)) dst.push(y)
    })
    return dst
}

export type Falsey = null | undefined | false | 0 | '' | 0n

export const PATH_MAXLEN = 60
export const TITLE_MAXLEN = 120

export function sanitize(filename: string, ext: string = '') {
    return tersen(sanitizeFilename(filename, { replacement: ' ' }), PATH_MAXLEN - ext.length) + ext
}

export function tersen(s: string, to: number) {
    return s.replaceAll(/\s+/g, ' ').slice(0, to).trim()
}
