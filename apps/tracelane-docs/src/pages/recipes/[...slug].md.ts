import type { APIRoute } from 'astro';
import { type CollectionEntry, getCollection } from 'astro:content';

// Per-recipe Markdown endpoint: serves each recipe's raw source at
// /recipes/<slug>.md so AI coding agents (Cursor, Claude Code, …) can fetch clean
// markdown with code-fence fidelity instead of stripped HTML. Mirrors the
// published-status filter + slug derivation in the sibling [...slug].astro route.
// Static-prerendered (output: 'static'), so this is a build-time file, no runtime.
export async function getStaticPaths() {
  const recipes = await getCollection(
    'recipes',
    ({ data }) => data.status !== 'draft' || import.meta.env.DEV,
  );
  return recipes.map((recipe) => ({
    params: { slug: recipe.id.replace(/\.md$/, '') },
    props: { recipe },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const recipe = props.recipe as CollectionEntry<'recipes'>;
  const md = `# ${recipe.data.title}\n\n${recipe.body ?? ''}`;
  return new Response(md, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
