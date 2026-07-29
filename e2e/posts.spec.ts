/**
 * 投稿の一生。写真を選んで出し、落書きを重ね、消すまで。
 *
 * 落書きが「残った」ことは画面の見た目では確かめない —— キャンバスは
 * ブラウザが描くので、描けたかどうかは絵を見比べるしかなくなる。かわりに
 * `/api/posts/:id/ops`（Durable Object が持つ確定済みの op）を見る。
 * ここに載っていれば、WebSocket 越しにサーバまで届いて確定している。
 */

import type { Page } from "@playwright/test";

import {
	apiHeaders,
	createPost,
	expect,
	hydrated,
	openUser,
	signUp,
	test,
	unique,
} from "./fixtures";
import { PHOTO_TYPE, photo } from "./image";

test("写真を選んで投稿すると、詳細ページとタイムラインに出る", async ({ page }) => {
	await signUp(page, "poster");
	const caption = unique("投稿");

	await page.goto("/posts/new");
	// 水和前にファイルを差し込むと change を拾う手が無く、送信ボタンが
	// 無効なままになる。
	await hydrated(page);
	await page.locator("input[type=file]").setInputFiles({
		name: "photo.png",
		mimeType: PHOTO_TYPE,
		buffer: photo(),
	});

	// 選んだ写真は、送る前にその場で見える。
	await expect(page.locator("img.preview")).toBeVisible();

	await page.getByLabel("キャプション").fill(caption);
	await page.getByLabel("公開範囲").selectOption("public");
	await page.getByRole("button", { name: "投稿する" }).click();

	await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);
	await expect(page.getByRole("heading", { name: caption })).toBeVisible();

	await page.goto("/");
	await expect(page.locator(".feed .caption", { hasText: caption })).toBeVisible();
});

test("キャンバスに描くと、その落書きが投稿に残る", async ({ page }) => {
	await signUp(page, "artist");
	const id = await createPost(page, { caption: unique("落書き"), visibility: "public" });

	await page.goto(`/posts/${id}`);

	// 道具が効くのは Durable Object と繋がってから（`PostEditor` の signedIn は
	// hello を受けて初めて立つ）。
	await expect(page.getByText("ライブ")).toBeVisible();

	const canvas = page.locator(".stage canvas");
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;

	await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7, { steps: 12 });
	await page.mouse.up();

	await expect
		.poll(async () => (await committedOps(page, id)).length, {
			message: "落書きが確定するのを待っている",
		})
		.toBeGreaterThan(0);

	// 読み直しても消えない = サーバ側に残っている。
	await page.reload();
	await expect(page.getByText("ライブ")).toBeVisible();
	expect((await committedOps(page, id)).length).toBeGreaterThan(0);
});

test("自分の投稿を削除すると、どこからも見えなくなる", async ({ page }) => {
	await signUp(page, "owner");
	const caption = unique("削除");
	const id = await createPost(page, { caption, visibility: "public" });

	await page.goto(`/posts/${id}`);
	await hydrated(page);
	await page.getByRole("button", { name: "削除", exact: true }).click();
	// 一段構えの確認。押し間違いで他人の落書きごと消えないようにしてある。
	await page.getByRole("button", { name: "削除する" }).click();

	await expect(page).toHaveURL("/");
	await expect(page.locator(".feed .caption", { hasText: caption })).toHaveCount(0);

	const response = await page.goto(`/posts/${id}`);
	expect(response?.status()).toBe(404);
});

test("他人の投稿には削除ボタンが出ない", async ({ page, browser }) => {
	const { page: authorPage, close } = await openUser(browser, "author");

	try {
		const id = await createPost(authorPage, { caption: unique("他人"), visibility: "public" });

		await signUp(page, "viewer");
		await page.goto(`/posts/${id}`);

		await expect(page.getByText("ライブ")).toBeVisible();
		await expect(page.getByRole("button", { name: "削除", exact: true })).toHaveCount(0);
	} finally {
		await close();
	}
});

async function committedOps(page: Page, id: string): Promise<unknown[]> {
	const response = await page.request.get(`/api/posts/${id}/ops`, { headers: apiHeaders(page) });
	expect(response.status(), await response.text()).toBe(200);
	return ((await response.json()) as { ops: unknown[] }).ops;
}
