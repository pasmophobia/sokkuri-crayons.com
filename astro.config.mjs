// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // ログイン状態でページの中身が変わるので、既定を SSR にする。
  output: 'server',
  adapter: cloudflare()
});