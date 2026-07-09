import type { Todo } from '../types'

/**
 * Sort todos by their `priority.level`.
 *
 * KNOWN BUG — reproducible via `?bug=1`. The "priority" feature shipped its UI
 * but never migrated a `priority` value onto existing/persisted todos, so
 * `priority` is `undefined` at runtime. A loose cast (the kind added to "move
 * fast") hides this from the type-checker, so it compiles clean and throws only
 * at runtime, in the click handler:
 *   TypeError: Cannot read properties of undefined (reading 'level')
 * This is intentional — it is the failure the case study debugs from Slack.
 */
export function sortByPriority(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const pa = (a as Todo & { priority: { level: number } }).priority
    const pb = (b as Todo & { priority: { level: number } }).priority
    return pa.level - pb.level
  })
}
