import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Filter, Todo } from '../types'

const STORAGE_KEY = 'peek-todomvc:todos'

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Defensive: only keep well-shaped rows.
    return parsed.filter(
      (t): t is Todo =>
        t &&
        typeof t.id === 'string' &&
        typeof t.title === 'string' &&
        typeof t.completed === 'boolean' &&
        typeof t.createdAt === 'number',
    )
  } catch {
    return []
  }
}

let counter = 0
function makeId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * The complete TodoMVC behavioural contract — add / toggle / edit / delete /
 * toggle-all / clear-completed / filter / live count — plus drag-reorder and
 * localStorage persistence. This is the spec the original captured session
 * exercised; the UI layer is free to look however it likes on top of it.
 */
export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [todos])

  const addTodo = useCallback((title: string) => {
    const t = title.trim()
    if (!t) return
    setTodos((prev) => [...prev, { id: makeId(), title: t, completed: false, createdAt: Date.now() }])
  }, [])

  const toggleTodo = useCallback((id: string) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)))
  }, [])

  // Edit-commit: a blank title deletes the todo (matches the TodoMVC spec).
  const updateTodo = useCallback((id: string, title: string) => {
    const t = title.trim()
    setTodos((prev) =>
      t.length === 0 ? prev.filter((td) => td.id !== id) : prev.map((td) => (td.id === id ? { ...td, title: t } : td)),
    )
  }, [])

  const removeTodo = useCallback((id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const clearCompleted = useCallback(() => {
    setTodos((prev) => prev.filter((t) => !t.completed))
  }, [])

  const toggleAll = useCallback(() => {
    setTodos((prev) => {
      const allCompleted = prev.length > 0 && prev.every((t) => t.completed)
      return prev.map((t) => ({ ...t, completed: !allCompleted }))
    })
  }, [])

  const reorder = useCallback((next: Todo[]) => setTodos(next), [])

  const activeCount = useMemo(() => todos.filter((t) => !t.completed).length, [todos])
  const completedCount = todos.length - activeCount
  const allCompleted = todos.length > 0 && activeCount === 0

  const filtered = useMemo(() => {
    if (filter === 'active') return todos.filter((t) => !t.completed)
    if (filter === 'completed') return todos.filter((t) => t.completed)
    return todos
  }, [todos, filter])

  return {
    todos,
    filtered,
    filter,
    setFilter,
    addTodo,
    toggleTodo,
    updateTodo,
    removeTodo,
    clearCompleted,
    toggleAll,
    reorder,
    activeCount,
    completedCount,
    allCompleted,
  }
}
