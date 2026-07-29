// @ts-check
/**
 * ESLint のフラット設定。
 *
 * 整形には一切口を出さない。順序は「ルールを足す」→「Prettier と競合する
 * ルールを最後に落とす」で、`eslint-config-prettier` は必ず末尾に置く。
 */

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import astro from "eslint-plugin-astro";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

// `tseslint.config()` ではなく ESLint 本体の `defineConfig()` を使う。
// typescript-eslint 8 で前者は非推奨になった。
export default defineConfig(
	{
		ignores: ["dist/", ".astro/", ".wrangler/", "worker-configuration.d.ts", "auth.schema.sql"],
	},

	js.configs.recommended,
	tseslint.configs.recommended,
	astro.configs.recommended,
	jsxA11y.flatConfigs.recommended,

	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.worker },
		},
		rules: {
			// 未使用でも `_` 始まりなら意図的な捨て変数として通す。
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			// クライアントから来る JSON は unknown で受けて自前で絞る。
			// そこに至るまでの型は any ではなく unknown を使わせる。
			"@typescript-eslint/no-explicit-any": "error",
			// Agents SDK の `this.sql\`...\`` は戻り値を捨てて呼ぶのが普通の使い方。
			"@typescript-eslint/no-unused-expressions": ["error", { allowTaggedTemplates: true }],
			eqeqeq: ["error", "always", { null: "ignore" }],
			"no-console": ["warn", { allow: ["warn", "error"] }],
		},
	},

	// 設定ファイル類は Node で動く。
	{
		files: ["*.config.{js,mjs,ts}", "auth.config.ts"],
		languageOptions: {
			globals: globals.node,
		},
	},

	// infra/ と scripts/ の補助スクリプトも Node の CLI。
	// 何を書き換えたかを伝えるのが仕事なので、標準出力への出力は通す。
	{
		files: ["infra/**/*.mjs", "scripts/**/*.mjs"],
		languageOptions: {
			globals: globals.node,
		},
		rules: {
			"no-console": "off",
		},
	},

	prettier,
);
