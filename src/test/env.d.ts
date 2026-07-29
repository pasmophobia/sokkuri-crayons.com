/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
	namespace Cloudflare {
		interface Env {
			/** `vitest.config.ts` が `migrations/` を読んで注入する。テスト時のみ存在。 */
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}
