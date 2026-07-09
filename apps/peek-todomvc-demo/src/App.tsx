import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { AddTodo } from './components/AddTodo'
import { Filters } from './components/Filters'
import { ThemeToggle } from './components/ThemeToggle'
import { TodoList } from './components/TodoList'
import { useTheme } from './hooks/useTheme'
import { useTodos } from './hooks/useTodos'
import { isBugMode } from './lib/bugMode'
import { sortByPriority } from './lib/sortByPriority'

function App() {
  const todos = useTodos()
  const { theme, toggle } = useTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const bugMode = isBugMode(window.location.search)

  // Keyboard shortcuts: "/" focuses the input, 1/2/3 switch filters.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return
      if (e.key === '/') {
        e.preventDefault()
        inputRef.current?.focus()
      } else if (e.key === '1') {
        todos.setFilter('all')
      } else if (e.key === '2') {
        todos.setFilter('active')
      } else if (e.key === '3') {
        todos.setFilter('completed')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [todos])

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 pb-16 pt-10 sm:pt-16">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="bg-gradient-to-br from-primary to-foreground bg-clip-text text-5xl font-extrabold tracking-tight text-transparent">
            todos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Rebuilt from a peek capture</p>
        </div>
        <ThemeToggle theme={theme} onToggle={toggle} />
      </header>

      <motion.main
        layout
        className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/5 ring-1 ring-black/5 dark:shadow-black/40 dark:ring-white/5"
      >
        <AddTodo
          onAdd={todos.addTodo}
          inputRef={inputRef}
          hasTodos={todos.todos.length > 0}
          allCompleted={todos.allCompleted}
          onToggleAll={todos.toggleAll}
        />
        <div className="border-t border-border" />
        <TodoList
          items={todos.filtered}
          filter={todos.filter}
          onReorder={todos.reorder}
          onToggle={todos.toggleTodo}
          onUpdate={todos.updateTodo}
          onRemove={todos.removeTodo}
        />
        {todos.todos.length > 0 && (
          <Filters
            activeCount={todos.activeCount}
            completedCount={todos.completedCount}
            filter={todos.filter}
            onFilter={todos.setFilter}
            onClearCompleted={todos.clearCompleted}
          />
        )}
        {bugMode && todos.todos.length > 0 && (
          <div className="flex justify-center border-t border-border px-4 py-2">
            <button
              type="button"
              // Intentional demo bug (see sortByPriority): throws in this handler.
              onClick={() => todos.reorder(sortByPriority(todos.todos))}
              className="text-sm text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              Sort by priority
            </button>
          </div>
        )}
      </motion.main>

      <footer className="mt-6 space-y-1 text-center text-xs text-muted-foreground/70">
        <p>
          Double-click to edit · drag to reorder · press{' '}
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans">/</kbd> to add
        </p>
        <p>
          Cloned from todomvc.com — captured with{' '}
          <span className="font-medium text-muted-foreground">peek</span>, rebuilt by an AI agent
        </p>
      </footer>
    </div>
  )
}

export default App
