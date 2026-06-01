import { z } from 'zod';

/**
 * Recipe content collection schema. Shared between the tracelane-docs and
 * peek-docs Astro apps so frontmatter validates against one source of truth.
 *
 * Astro's content collection uses this schema via `defineCollection({ schema })`.
 * Each site's `src/content.config.ts` imports it and applies it to its
 * `recipes` collection.
 */
export const recipeSchema = z.object({
  /** JTBD statement; H1 + <title> tag. Verb-led, <= 9 words ideally. */
  title: z.string().min(8).max(80),
  /** One-sentence pain reframe. Rendered as the lede blockquote. */
  lede: z.string().min(20).max(200),
  /** SEO meta description; aim for 110-150 chars. */
  description: z.string().min(50).max(160),
  /** Drives ordering + card size on the index page. */
  type: z.enum(['hero', 'short']),
  /** Drafts excluded from production builds. */
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  publishedAt: z.date(),
  updatedAt: z.date().optional(),
  /** Tag chips for filtering (deferred); free-form for now. */
  integrations: z.array(z.string()).default([]),
  /** Optional URL to the payoff artifact, e.g. /demo/acme-shop-checkout-failure.html */
  artifact: z.string().optional(),
  /** Up to 3 sibling recipe slugs for the auto-rendered "Related recipes" cards. */
  relatedRecipes: z.array(z.string()).max(3).default([]),
  /** Per-recipe OG image override; otherwise a site-wide default is used. */
  ogImage: z.string().optional(),
});

export type Recipe = z.infer<typeof recipeSchema>;
