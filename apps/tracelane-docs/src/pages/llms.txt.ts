import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// /llms.txt — the AI-agent index for this site (llmstxt.org format). Generated at
// build time from the recipes content collection so it never drifts and never
// leaks drafts (same published filter as the recipe routes). Honest scope: this
// is a discovery/pointer file for the IDE-agent markdown-fetch channel (links
// point at the .md variants), not a ranking or citation signal.
export const GET: APIRoute = async ({ site }) => {
  const base = (site?.href ?? 'https://tracelane.cubenest.in/').replace(/\/$/, '');
  const recipes = (
    await getCollection(
      'recipes',
      ({ data }) => data.status !== 'draft' || import.meta.env.DEV,
    )
  ).sort((a, b) => Number(b.data.publishedAt) - Number(a.data.publishedAt));

  const recipeLines = recipes
    .map(
      (r) =>
        `- [${r.data.title}](${base}/recipes/${r.id.replace(/\.md$/, '')}.md): ${r.data.description}`,
    )
    .join('\n');

  const body = `# tracelane

> Open-source, local-first failed-test recorder for end-to-end suites. Captures an rrweb session plus console and failed network responses while WebdriverIO and Playwright tests run, and ships a single self-contained offline HTML report on failure — replay, console, and network in one file. No cloud, no telemetry. Apache-2.0, pre-1.0 alpha.

Add tracelane to your suite with \`npx @tracelane/cli init\`, or register the \`@tracelane/wdio\` service / \`@tracelane/playwright\` reporter manually. On a test failure it writes one HTML file you can open offline, email, or attach to a bug tracker.

## Docs
- [Getting started](${base}/getting-started): register the service/reporter for WebdriverIO or Playwright
- [Live demo report](${base}/demo): real self-contained HTML reports with replay, console, and network panels

## Recipes
${recipeLines}

## Optional
- [tracelane vs Cypress Test Replay](${base}/vs-cypress-test-replay): OSS, runner-agnostic, local artifact vs a hosted dashboard
- [tracelane vs Playwright Trace Viewer](${base}/vs-playwright-trace-viewer): a shareable single-file rrweb report alongside the trace zip
- [tracelane vs Replay.io](${base}/vs-replay-io): a CI replay artifact vs time-travel debugging
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
