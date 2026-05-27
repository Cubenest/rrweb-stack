// Shared helper for pulling a test's human title + spec path out of a WDIO
// `Test`/`Suite` object. Used by both the Service (service.ts) and the hook
// factory (hooks.ts) so the extraction lives in exactly one place.

/** A WDIO `Test`/`Suite`-shaped object — we only read `title` / `fullTitle` / `file`. */
export interface TestLike {
  title?: string;
  fullTitle?: string;
  file?: string;
}

/** The identity the session needs: a display title and (when known) a spec path. */
export interface TestIdentity {
  title: string;
  spec?: string;
}

/** Prefer the fully-qualified title; fall back to the leaf title, then a placeholder. */
export function testIdentity(test: TestLike): TestIdentity {
  const title = test.fullTitle ?? test.title ?? 'unknown test';
  return test.file ? { title, spec: test.file } : { title };
}

/** A Cucumber `World`-shaped object — we read its pickle's `name` / `uri`. */
export interface WorldLike {
  pickle?: { name?: string; uri?: string };
}

/** Pull the scenario title + feature path out of a Cucumber `World` pickle. */
export function scenarioIdentity(world: unknown): TestIdentity {
  const pickle = (world as WorldLike).pickle;
  const title = pickle?.name ?? 'unknown scenario';
  return pickle?.uri ? { title, spec: pickle.uri } : { title };
}
