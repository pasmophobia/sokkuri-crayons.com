/**
 * `eslint-plugin-jsx-a11y` は型定義を同梱していない (v6.10)。
 * `eslint.config.js` は `// @ts-check` 下にあるので、最小限の形だけ宣言しておく。
 * 使うのは `flatConfigs.recommended` を並べるところだけ。
 */
declare module "eslint-plugin-jsx-a11y" {
	import type { Linter } from "eslint";

	const plugin: {
		flatConfigs: Record<string, Linter.Config>;
	};
	export default plugin;
}
