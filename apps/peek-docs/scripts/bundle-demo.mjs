// Build the TodoMVC demo (with a /demo base) and copy its output into
// public/demo, so the static docs site serves the live demo at /demo.
// Runs as the first step of `pnpm build` in this app (see package.json).
import { execSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const demoDist = resolve(here, '../../peek-todomvc-demo/dist')
const publicDemo = resolve(here, '../public/demo')

console.log('[bundle-demo] building @peekdev/todomvc-demo (base /demo/)…')
execSync('pnpm --filter @peekdev/todomvc-demo build', {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: '/demo/' },
})

rmSync(publicDemo, { recursive: true, force: true })
cpSync(demoDist, publicDemo, { recursive: true })
console.log('[bundle-demo] copied demo → public/demo')
