/**
 * ローカルに溜まる確認メールを読む。
 *
 * `send_email` バインディングは miniflare が模擬していて、送ったメールは
 * 配送されずに `.wrangler/tmp/email/` へ .txt / .html として書き出される
 * （CLAUDE.md「Mail」）。E2E はそのファイルから確認リンクを拾う。
 *
 * ファイル名は UUID で、宛先はどこにも書かれていない。そのかわり確認リンクの
 * token は JWT で、payload に宛先が入っている。これで突き合わせれば、テストを
 * 並列に走らせて複数の登録が同時に飛んでも取り違えない。
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAIL_DIR = fileURLToPath(new URL("../.wrangler/tmp/email", import.meta.url));

/** 本文に 1 行で入っている確認リンク。 */
const VERIFY_URL = /https?:\/\/\S*\/api\/auth\/verify-email\S*/;

/**
 * `email` 宛の確認リンクが届くまで待つ。
 *
 * 送信はサインアップ応答を返したあとに走ることがあるので、その場に無くても
 * 諦めずに少し待つ。
 */
export async function waitForVerificationUrl(email: string, timeoutMs = 20_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		const found = findVerificationUrl(email);
		if (found) return found;
		if (Date.now() >= deadline) {
			throw new Error(`確認メールが ${email} 宛に届きませんでした（${MAIL_DIR}）`);
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

function findVerificationUrl(email: string): string | null {
	for (const file of textFiles(MAIL_DIR)) {
		const url = readFileSync(file, "utf8").match(VERIFY_URL)?.[0];
		if (url && recipientOf(url) === email) return url;
	}
	return null;
}

/** 確認リンクの token（JWT）の payload から宛先を取り出す。 */
function recipientOf(url: string): string | null {
	const payload = new URL(url).searchParams.get("token")?.split(".")[1];
	if (!payload) return null;

	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
			email?: string;
		};
		return claims.email ?? null;
	} catch {
		// 形が違うものは確認リンクではない。
		return null;
	}
}

/**
 * miniflare は起動ごとに別のディレクトリへ書き出し、過去の分も残る。
 * 宛先で選ぶので、古いメールが混ざっていても困らない。
 */
function textFiles(dir: string): string[] {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		// まだ 1 通も送られていなければディレクトリごと無い。
		return [];
	}

	return entries.flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return textFiles(full);
		return entry.name.endsWith(".txt") ? [full] : [];
	});
}
