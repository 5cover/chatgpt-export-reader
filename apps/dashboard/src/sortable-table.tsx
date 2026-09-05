import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'

export type SortableColumn<Row> = {
  id: string
  label: string
  align?: 'left' | 'right'
  render: (row: Row) => ComponentChildren
  compare?: (left: Row, right: Row) => number
}

export type SortableTableProps<Row> = {
  rows: readonly Row[]
  columns: readonly SortableColumn<Row>[]
  initialSort: { column: string; direction?: 'ascending' | 'descending' }
  rowKey: (row: Row) => string
}

export function SortableTable<Row>({ rows, columns, initialSort, rowKey }: SortableTableProps<Row>) {
  const [sort, setSort] = useState({ column: initialSort.column, direction: initialSort.direction ?? 'ascending' })
  const sortedRows = useMemo(() => {
    const column = columns.find(candidate => candidate.id === sort.column)
    if (!column?.compare) return rows
    const direction = sort.direction === 'ascending' ? 1 : -1
    return [...rows].sort((left, right) => direction * column.compare!(left, right))
  }, [columns, rows, sort])

  function toggle(column: SortableColumn<Row>) {
    if (!column.compare) return
    setSort(current => ({
      column: column.id,
      direction: current.column === column.id && current.direction === 'ascending' ? 'descending' : 'ascending',
    }))
  }

  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(column => {
              const active = sort.column === column.id
              const direction = active ? sort.direction : undefined
              return (
                <th class={column.align === 'left' ? 'left' : ''} aria-sort={direction}>
                  {column.compare ? (
                    <button type="button" onClick={() => toggle(column)}>
                      {column.label}
                      <span aria-hidden="true">
                        {direction === 'ascending' ? ' ↑' : direction === 'descending' ? ' ↓' : ' ↕'}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => (
            <tr key={rowKey(row)}>
              {columns.map(column => (
                <td class={column.align === 'left' ? 'left' : ''}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
