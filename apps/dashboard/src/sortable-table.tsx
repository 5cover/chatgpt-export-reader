import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
export type SortableColumn<Row> = {
  id: string
  label: string
  align?: 'left' | 'right'
  render: (row: Row) => ComponentChildren
  compare?: (left: Row, right: Row) => number
  optional?: boolean
}
export type SortableTableProps<Row> = {
  label?: string
  rows: readonly Row[]
  columns: readonly SortableColumn<Row>[]
  initialSort: { column: string; direction?: 'ascending' | 'descending' }
  rowKey: (row: Row) => string
}
export function SortableTable<Row>({
  label = 'Evidence',
  rows,
  columns,
  initialSort,
  rowKey,
}: SortableTableProps<Row>) {
  const [sort, setSort] = useState({ column: initialSort.column, direction: initialSort.direction ?? 'ascending' })
  const [page, setPage] = useState(0)
  const [extended, setExtended] = useState(false)
  const sorted = useMemo(() => {
    const column = columns.find(c => c.id === sort.column)
    return column?.compare
      ? [...rows].sort((a, b) => (sort.direction === 'ascending' ? 1 : -1) * column.compare!(a, b))
      : rows
  }, [rows, columns, sort])
  const offset = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1)) * 50
  const visible = columns.filter(column => extended || !column.optional)
  return (
    <div class="evidence-table">
      {columns.some(column => column.optional) && (
        <label>
          <input type="checkbox" checked={extended} onChange={event => setExtended(event.currentTarget.checked)} />{' '}
          Additional columns
        </label>
      )}
      <div class="table-wrap" tabIndex={0} role="region" aria-label={`${label}, scrollable table`}>
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              {visible.map(column => (
                <th
                  key={column.id}
                  scope="col"
                  class={column.align === 'left' ? 'left' : ''}
                  aria-sort={column.id === sort.column ? sort.direction : undefined}>
                  {column.compare ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSort({
                          column: column.id,
                          direction:
                            sort.column === column.id && sort.direction === 'ascending' ? 'descending' : 'ascending',
                        })
                        setPage(0)
                      }}>
                      {column.label}
                      <span aria-hidden="true">
                        {column.id === sort.column ? (sort.direction === 'ascending' ? ' +' : ' -') : ''}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(offset, offset + 50).map(row => (
              <tr key={rowKey(row)}>
                {visible.map(column => (
                  <td key={column.id} class={column.align === 'left' ? 'left' : ''}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={visible.length}>No matching records in this scope.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <nav class="pagination" aria-label={`${label} pages`}>
          <button
            class="ui-button"
            type="button"
            disabled={!offset}
            onClick={() => setPage(Math.max(0, offset / 50 - 1))}>
            Previous
          </button>
          <span role="status">
            {offset + 1}-{Math.min(offset + 50, rows.length)} of {rows.length.toLocaleString()}
          </span>
          <button
            class="ui-button"
            type="button"
            disabled={offset + 50 >= rows.length}
            onClick={() => setPage(offset / 50 + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  )
}
