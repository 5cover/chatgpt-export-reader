import type { JSX } from 'preact'

export type HeatmapCell = {
  value: number
  title: string
  href?: string
  actionLabel?: string
}

export type HeatmapRow = {
  key: string
  label: string
  cells: readonly (HeatmapCell | undefined)[]
}

export type HeatmapTableProps = {
  label: string
  cornerLabel: string
  columns: readonly string[]
  rows: readonly HeatmapRow[]
  color: string
  minimumOpacity?: number
  formatValue?: (value: number) => string
}

type HeatmapCellStyle = JSX.CSSProperties & {
  '--heatmap-color': string
  '--heatmap-opacity': number
  '--heatmap-foreground': string
}

export function HeatmapTable({
  label,
  cornerLabel,
  columns,
  rows,
  color,
  minimumOpacity = 0.1,
  formatValue = value => value.toLocaleString(),
}: HeatmapTableProps) {
  const maximum = Math.max(1, ...rows.flatMap(row => row.cells.map(cell => cell?.value ?? 0)))

  return (
    <div class="heatmap-table-wrap">
      <table class="heatmap-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" class="heatmap-corner">
              {cornerLabel}
            </th>
            {columns.map(column => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {columns.map((_, index) => {
                const cell = row.cells[index]
                if (cell === undefined) return <td key={`${row.key}:${index}`} class="heatmap-empty" />

                const opacity = heatmapOpacity(cell.value, maximum, minimumOpacity)
                const style: HeatmapCellStyle = {
                  '--heatmap-color': color,
                  '--heatmap-opacity': opacity,
                  '--heatmap-foreground': opacity >= 0.58 ? '#fff' : '#1d2a2c',
                }
                const value = formatValue(cell.value)
                return (
                  <td key={`${row.key}:${index}`} class="heatmap-cell" style={style} title={cell.title}>
                    {cell.href === undefined ? (
                      <span>{value}</span>
                    ) : (
                      <a href={cell.href} aria-label={cell.actionLabel ?? cell.title}>
                        {value}
                      </a>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function heatmapOpacity(value: number, maximum: number, minimum: number): number {
  return value === 0 ? 0 : minimum + ((1 - minimum) * value) / maximum
}
