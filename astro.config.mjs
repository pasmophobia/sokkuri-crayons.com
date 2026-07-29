// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // ログイン状態でページの中身が変わるので、既定を SSR にする。
  output: 'server',

  adapter: cloudflare(),
  integrations: [react()]
});