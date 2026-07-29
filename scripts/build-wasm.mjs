/**
 * crates/render を wasm に焼いて src/wasm/render.wasm に置く。
 *
 *   bun run wasm:build
 *
 * 生成物はリポジトリに入れる。CI にもデプロイにも Rust を要求しないためで、
 * Rust を触ったときだけ手元でこれを回して差分を一緒にコミットする。
 * `--target wasm32-unknown-unknown` の素の cdylib なので wasm-bindgen は要らない。
 * やり取りするのは数値と線形メモリだけで、グルーコードを挟む余地がない。
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "crates", "render");
const built = join(crate, "target", "wasm32-unknown-unknown", "release", "artc_render.wasm");
const output = join(root, "src", "wasm", "render.wasm");

execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], {
	cwd: crate,
	stdio: "inherit",
});

mkdirSync(dirname(output), { recursive: true });
copyFileSync(built, output);

console.log(`src/wasm/render.wasm (${statSync(output).size} bytes)`);
