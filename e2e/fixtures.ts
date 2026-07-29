/**
 * E2E 共通の下ごしらえ。
 *
 * アカウントは毎回その場で作る。DB を巻き戻す手立てがローカルには無く、
 * 巻き戻したところで並列に走る他のテストを巻き添えにするため。名前・
 * ユーザー名・メールを毎回ユニークにしておけば、残骸が積もっても衝突しない。
 *
 * 送信元 IP をテストごとに変えているのは、better-auth のレート制限
 * （`src/auth/index.ts`: sign-up は 60 秒に 5 回）を避けるため。キーは
 * `cf-connecting-ip` なので、名乗る IP を分ければバケツも分かれる。
 * 本番ではこのヘッダを Cloudflare が上書きするので、詐称はローカル限りの話。
 */

import { randomUUID } from "node:crypto";

import { test as base, expect, type Browser, type Page } from "@playwright/test";

import { BASE_URL } from "./config";
import { PHOTO_ASPECT_RATIO, PHOTO_TYPE, photo } from "./image";
import { waitForVerificationUrl } from "./mail";

export { expect };

export type Account = {
	name: string;
	username: string;
	email: string;
	password: string;
};

export const test = base.extend({
	// context ごと差し替えるとトレースや動画の面倒を見ている既定の実装まで
	// 置き換わってしまうので、ヘッダだけ page に足す。
	page: async ({ page }, use) => {
		await assignClientIp(page);
		await use(page);
	},
});

/**
 * この page が名乗る送信元 IP。
 *
 * page.request はブラウザの外から飛ぶのでヘッダを引き継がない。呼び出しごとに
 * 手で渡して回すより、page に紐づけて引ける方が取り違えが起きない。
 */
const clientIps = new WeakMap<Page, string>();

async function assignClientIp(page: Page): Promise<string> {
	const ip = nextClientIp();
	await page.setExtraHTTPHeaders({ "cf-connecting-ip": ip });
	clientIps.set(page, ip);
	return ip;
}

/** ワーカーごとに別の帯を使う。プロセスが違うと採番を共有できないため。 */
const WORKER = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
let issued = 0;

function nextClientIp(): string {
	issued += 1;
	return `10.${WORKER % 256}.${(issued >> 8) % 256}.${issued % 256}`;
}

/**
 * page.request にはブラウザのヘッダが載らない。Origin も付かないが、
 * better-auth は Origin の無いリクエストを弾く。
 */
export function apiHeaders(page: Page): Record<string, string> {
	return {
		"content-type": "application/json",
		origin: BASE_URL,
		"cf-connecting-ip": clientIps.get(page) ?? "",
	};
}

/**
 * 島が水和し終わるのを待つ。
 *
 * ボタンや form はサーバが吐いた HTML の時点で見えているので、待たずに押すと
 * React が繋がる前のクリックになり、何も起きない（form なら素の GET 送信に
 * なってページごと飛ぶ）。Astro の島は水和し終えた時点で `ssr` 属性を外すので、
 * それが 1 つも無くなったことを合図にする。
 *
 * タイムライン（"/"）だけは全体では待てない。サムネイルが `client:visible` で、
 * 画面に入るまで水和しないため、`ssr` の付いた島がいつまでも残る。用のある
 * ところ（ヘッダーなど）に `within` で絞る。
 */
export async function hydrated(page: Page, within = "body"): Promise<void> {
	await expect(page.locator(`${within} astro-island[ssr]`)).toHaveCount(0);
}

/**
 * 他のテストと混ざらない文字列。
 *
 * タイムラインは全員ぶんが 1 本に並ぶので、キャプションが被ると
 * 「自分が出した投稿」を指し示せなくなる。
 */
export function unique(label: string): string {
	return `${label} ${randomUUID().slice(0, 8)}`;
}

export function newAccount(prefix: string): Account {
	// ユーザー名は英数字と _ の 3〜20 文字（`src/auth/index.ts` の username プラグイン）。
	const tag = randomUUID().replaceAll("-", "").slice(0, 8);
	const username = `${prefix}_${tag}`;

	return {
		name: `${prefix} ${tag}`,
		username,
		email: `${username}@example.test`,
		password: "e2e-password-1234",
	};
}

/**
 * 確認済みのアカウントを作り、そのままログインした状態にする。
 *
 * 画面から登録する筋は `auth.spec.ts` が通しているので、他のテストは
 * API と確認リンクで手短に済ませる。確認リンクを踏むとその場でログインする
 * （`autoSignInAfterVerification`）ので、サインイン画面は経由しない。
 */
export async function signUp(page: Page, prefix = "e2e"): Promise<Account> {
	const account = newAccount(prefix);

	const response = await page.request.post("/api/auth/sign-up/email", {
		headers: apiHeaders(page),
		data: {
			name: account.name,
			email: account.email,
			password: account.password,
			username: account.username,
		},
	});
	expect(response.status(), await response.text()).toBe(200);

	await page.goto(await waitForVerificationUrl(account.email));
	await expect(page.locator("header .me")).toContainText(account.name);

	return account;
}

export type User = {
	page: Page;
	account: Account;
	close: () => Promise<void>;
};

/**
 * もう 1 人ぶんのブラウザを開く。フレンドのように 2 人が要るときに使う。
 * cookie を分けたいので context ごと別にする。
 */
export async function openUser(browser: Browser, prefix: string): Promise<User> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await assignClientIp(page);
	const account = await signUp(page, prefix);

	return { page, account, close: () => context.close() };
}

/**
 * 投稿を API で作る。手順（アップロード → 投稿）は `NewPostForm` と同じ。
 * 画面から投稿する筋は `posts.spec.ts` が通しているので、投稿があること自体が
 * 前提でしかないテストはこちらを使う。
 */
export async function createPost(
	page: Page,
	options: { caption?: string; visibility?: "public" | "friends" } = {},
): Promise<string> {
	const upload = await page.request.post("/api/uploads", {
		headers: { ...apiHeaders(page), "content-type": PHOTO_TYPE },
		data: photo(),
	});
	expect(upload.status(), await upload.text()).toBe(201);
	const { key } = (await upload.json()) as { key: string };

	const created = await page.request.post("/api/posts", {
		headers: apiHeaders(page),
		data: {
			imageKey: key,
			aspectRatio: PHOTO_ASPECT_RATIO,
			caption: options.caption ?? "",
			visibility: options.visibility ?? "friends",
		},
	});
	expect(created.status(), await created.text()).toBe(201);

	return ((await created.json()) as { id: string }).id;
}
