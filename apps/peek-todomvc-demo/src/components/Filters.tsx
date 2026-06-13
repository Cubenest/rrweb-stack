import { cn } from '../lib/utils'
import type { Filter } from '../types'

interface Props {
  activeCount: number
  completedCount: number
  filter: Filter
  onFilter: (f: Filter) => void
  onClearCompleted: () => void
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
]

export function Filters({ activeCount, completedCount, filter, onFilter, onClearCompleted }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
      <span data-testid="todo-count" className="text-muted-foreground">
        <strong className="font-semibold text-foreground">{activeCount}</strong>{' '}
        {activeCount === 1 ? 'item' : 'items'} left
      </span>

      <div className="flex items-center gap-1 rounded-full bg-muted p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            data-testid={`filter-${f.key}`}
            onClick={() => onFilter(f.key)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === f.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="clear-completed"
        onClick={onClearCompleted}
        disabled={completedCount === 0}
        className={cn(
          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
          completedCount === 0 ? 'cursor-default text-transparent' : 'text-muted-foreground hover:text-danger',
        )}
      >
        Clear completed
      </button>
    </div>
  )
}
