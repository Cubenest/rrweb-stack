import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { recipeSchema } from '@cubenest/docs-shared';

const recipes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/recipes' }),
  schema: recipeSchema,
});

export const collections = { recipes };
