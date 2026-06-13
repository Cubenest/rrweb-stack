import { Reorder, motion, useDragControls } from 'framer-motion'
import { Check, GripVertical, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import type { Todo } from '../types'

interface Props {
  todo: Todo
  draggable: boolean
  onToggle: (id: string) => void
  onUpdate: (id: string, title: string) => void
  onRemove: (id: string) => void
}

export function TodoItem({ todo, draggable, onToggle, onUpdate, onRemove }: Props) {
  const controls = useDragControls()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.title)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      editRef.current?.focus()
      editRef.current?.select()
    }
  }, [editing])

  const beginEdit = () => {
    setDraft(todo.title)
    setEditing(true)
  }
  const commit = () => {
    if (!editing) return
    setEditing(false)
    onUpdate(todo.id, draft)
  }
  const cancel = () => {
    setEditing(false)
    setDraft(todo.title)
  }

  const inner = (
    <div className="group flex items-center gap-3 border-b border-border/70 px-3 py-3 last:border-b-0">
      {draggable ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none text-muted-foreground/25 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-4" />
      )}

      <button
        type="button"
        role="checkbox"
        aria-checked={todo.completed}
        aria-label={todo.completed ? 'Mark as active' : 'Mark as complete'}
        data-testid="todo-toggle"
        onClick={() => onToggle(todo.id)}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
          todo.completed
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-transparent hover:border-primary/60',
        )}
      >
        <motion.span
          initial={false}
          animate={{ scale: todo.completed ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </motion.span>
      </button>

      {editing ? (
        <input
          ref={editRef}
          data-testid="todo-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') cancel()
          }}
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <span
          data-testid="todo-label"
          onDoubleClick={beginEdit}
          className={cn(
            'flex-1 select-none truncate text-base transition-colors',
            todo.completed ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {todo.title}
        </span>
      )}

      <button
        type="button"
        aria-label="Delete todo"
        data-testid="todo-destroy"
        onClick={() => onRemove(todo.id)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-transparent transition-colors hover:bg-danger/10 hover:text-danger group-hover:text-muted-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )

  if (draggable) {
    return (
      <Reorder.Item
        value={todo}
        dragListener={false}
        dragControls={controls}
        data-testid="todo-item"
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        className="list-none bg-card"
      >
        {inner}
      </Reorder.Item>
    )
  }

  return (
    <motion.li
      data-testid="todo-item"
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className="list-none bg-card"
    >
      {inner}
    </motion.li>
  )
}
