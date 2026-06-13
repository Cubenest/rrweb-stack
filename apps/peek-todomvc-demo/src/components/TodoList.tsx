import { AnimatePresence, Reorder, motion } from 'framer-motion'
import { ClipboardList } from 'lucide-react'
import type { Filter, Todo } from '../types'
import { TodoItem } from './TodoItem'

interface Props {
  items: Todo[]
  filter: Filter
  onReorder: (next: Todo[]) => void
  onToggle: (id: string) => void
  onUpdate: (id: string, title: string) => void
  onRemove: (id: string) => void
}

export function TodoList({ items, filter, onReorder, onToggle, onUpdate, onRemove }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-muted-foreground">
        <ClipboardList className="h-8 w-8 opacity-40" />
        <p className="text-sm">
          {filter === 'completed'
            ? 'Nothing completed yet.'
            : filter === 'active'
              ? 'No active todos — nice.'
              : 'No todos yet. Add one above.'}
        </p>
      </div>
    )
  }

  // Drag-reorder is only meaningful on the full, unfiltered list.
  if (filter === 'all') {
    return (
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={onReorder}
        as="ul"
        data-testid="todo-list"
        className="m-0 list-none p-0"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <TodoItem
              key={t.id}
              todo={t}
              draggable
              onToggle={onToggle}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </AnimatePresence>
      </Reorder.Group>
    )
  }

  return (
    <motion.ul layout data-testid="todo-list" className="m-0 list-none p-0">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <TodoItem
            key={t.id}
            todo={t}
            draggable={false}
            onToggle={onToggle}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </AnimatePresence>
    </motion.ul>
  )
}
