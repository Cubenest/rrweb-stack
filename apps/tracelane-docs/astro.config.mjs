// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://tracelane.cubenest.in',
  trailingSlash: 'never',
  integrations: [sitemap()],
});
