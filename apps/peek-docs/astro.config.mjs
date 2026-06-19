// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://peek.cubenest.in',
  trailingSlash: 'never',
  integrations: [sitemap()],
});
