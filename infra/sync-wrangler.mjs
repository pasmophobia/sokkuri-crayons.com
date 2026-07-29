/**
 * terraform の出力を wrangler.jsonc に書き戻す。
 *
 * D1 と KV は作成時に採番される ID を wrangler 側にも書く必要がある。手で写すと
 * 環境を作り直したときに古い ID が残り、しかも「動いてはいるが別のリソースを見て
 * いる」という気づきにくい壊れ方をする。
 *
 * JSONC をパースはしない（コメントが落ちるため）。該当箇所の値だけを差し替える。
 * パターンはバインディング名まで含めて絞ってあるので、あとで別の "id" が
 * 増えても取り違えない。
 *
 *   bun run infra:sync
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const infraDir = dirname(fileURLToPath(import.meta.url));
const wranglerPath = join(infraDir, "..", "wrangler.jsonc");

/** 差し替える場所。前後を含めて一意になる形で書く。 */
const TARGETS = [
	{
		label: "D1 名",
		output: "d1_database_name",
		pattern: /("database_name"\s*:\s*")([^"]*)(")/,
	},
	{
		label: "D1 ID",
		output: "d1_database_id",
		pattern: /("database_id"\s*:\s*")([^"]*)(")/,
	},
	{
		label: "KV ID",
		output: "kv_namespace_id",
		pattern: /("binding"\s*:\s*"AUTH_KV"\s*,\s*"id"\s*:\s*")([^"]*)(")/,
	},
	{
		label: "R2 バケット",
		output: "r2_bucket_name",
		pattern: /("bucket_name"\s*:\s*")([^"]*)(")/,
	},
];

let outputs;
try {
	const raw = execFileSync("terraform", ["output", "-json"], {
		cwd: infraDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	outputs = JSON.parse(raw);
} catch (error) {
	console.error("terraform output を読めませんでした。infra/ で terraform apply 済みですか？");
	console.error(String(error instanceof Error ? error.message : error).trim());
	process.exit(1);
}

let config = readFileSync(wranglerPath, "utf8");
let changed = 0;

for (const target of TARGETS) {
	const entry = outputs[target.output];
	if (!entry || typeof entry.value !== "string" || entry.value === "") {
		console.error(`terraform の出力に ${target.output} がありません。`);
		process.exit(1);
	}

	const found = config.match(target.pattern);
	if (!found) {
		console.error(`wrangler.jsonc に ${target.label} の書き込み先が見つかりません。`);
		process.exit(1);
	}

	if (found[2] === entry.value) {
		console.log(`  = ${target.label}: ${entry.value}`);
		continue;
	}
	console.log(`  ~ ${target.label}: ${found[2] || "(空)"} -> ${entry.value}`);
	config = config.replace(target.pattern, `$1${entry.value}$3`);
	changed += 1;
}

if (changed === 0) {
	console.log("wrangler.jsonc は既に最新です。");
	process.exit(0);
}

writeFileSync(wranglerPath, config);
console.log(`wrangler.jsonc を更新しました（${changed} 件）。`);
