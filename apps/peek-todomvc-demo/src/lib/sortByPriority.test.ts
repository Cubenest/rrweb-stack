import { describe, expect, it } from 'vitest'
import type { Todo } from '../types'
import { sortByPriority } from './sortByPriority'

function makeTodo(title: string): Todo {
  return { id: title, title, completed: false, createdAt: 0 }
}

describe('sortByPriority (intentional demo bug)', () => {
  it('throws a TypeError on real todos (no migrated priority field)', () => {
    expect(() => sortByPriority([makeTodo('a'), makeTodo('b')])).toThrow(TypeError)
    expect(() => sortByPriority([makeTodo('a'), makeTodo('b')])).toThrow(
      /Cannot read properties of undefined \(reading 'level'\)/,
    )
  })
})
