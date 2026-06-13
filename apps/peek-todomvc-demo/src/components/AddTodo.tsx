import type { RefObject } from 'react'
import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '../lib/utils'

interface Props {
  onAdd: (title: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  hasTodos: boolean
  allCompleted: boolean
  onToggleAll: () => void
}

export function AddTodo({ onAdd, inputRef, hasTodos, allCompleted, onToggleAll }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    if (!value.trim()) return
    onAdd(value)
    setValue('')
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {hasTodos ? (
        <button
          type="button"
          onClick={onToggleAll}
          aria-label="Toggle all"
          data-testid="toggle-all"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
            allCompleted ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground',
          )}
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground/40">
          <Plus className="h-5 w-5" />
        </span>
      )}
      <input
        ref={inputRef}
        data-testid="new-todo"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="What needs to be done?"
        aria-label="New todo"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        className="h-11 w-full bg-transparent text-lg text-foreground outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  )
}
