/**
 * フレンドの申請・承認と、それが公開範囲に効くところまで。
 *
 * 「フレンドのみ」の投稿が他人に見えないことは、承認の前後で同じ投稿を
 * 見に行って確かめる。見えない投稿は 404 —— 存在の有無すら漏らさない
 * （`src/pages/api/posts/[id].ts` と同じ方針）。
 */

import { createPost, expect, hydrated, openUser, signUp, test, unique } from "./fixtures";

test("申請 → 承認で、フレンドのみの投稿が見えるようになる", async ({ page, browser }) => {
	const bob = await openUser(browser, "bob");

	try {
		const caption = unique("フレンドのみ");
		const id = await createPost(bob.page, { caption, visibility: "friends" });

		const alice = await signUp(page, "alice");

		// まだ他人。見えない投稿は「無い」扱い。
		expect((await page.goto(`/posts/${id}`))?.status()).toBe(404);

		await page.goto("/friends");
		await hydrated(page);
		await page.getByLabel("相手のユーザー名").fill(bob.account.username);
		await page.getByRole("button", { name: "申請する" }).click();
		await expect(page.getByText("申請を送りました。相手の承認待ちです。")).toBeVisible();

		// 送った側には「承認待ち」として残る。
		await page.reload();
		await expect(page.getByRole("heading", { name: "承認待ち" })).toBeVisible();

		// 受けた側で承認する。
		await bob.page.goto("/friends");
		await hydrated(bob.page);
		const request = bob.page.locator(".people li", { hasText: alice.name });
		await expect(request).toBeVisible();
		await request.getByRole("button", { name: "承認" }).click();
		await expect(bob.page.getByRole("heading", { name: "フレンド（1）" })).toBeVisible();

		// 成立すると、フレンドのみの投稿が見えるようになる。
		await page.goto("/friends");
		await expect(page.getByRole("heading", { name: "フレンド（1）" })).toBeVisible();

		expect((await page.goto(`/posts/${id}`))?.status()).toBe(200);
		await expect(page.getByRole("heading", { name: caption })).toBeVisible();

		await page.goto("/");
		await expect(page.locator(".feed .caption", { hasText: caption })).toBeVisible();
	} finally {
		await bob.close();
	}
});

test("解除すると、フレンドのみの投稿がまた見えなくなる", async ({ page, browser }) => {
	const bob = await openUser(browser, "bob");

	try {
		const id = await createPost(bob.page, { caption: unique("解除"), visibility: "friends" });
		const alice = await signUp(page, "alice");

		await page.goto("/friends");
		await hydrated(page);
		await page.getByLabel("相手のユーザー名").fill(bob.account.username);
		await page.getByRole("button", { name: "申請する" }).click();
		await expect(page.getByText("申請を送りました。相手の承認待ちです。")).toBeVisible();

		await bob.page.goto("/friends");
		await hydrated(bob.page);
		await bob.page
			.locator(".people li", { hasText: alice.name })
			.getByRole("button", { name: "承認" })
			.click();
		await expect(bob.page.getByRole("heading", { name: "フレンド（1）" })).toBeVisible();

		expect((await page.goto(`/posts/${id}`))?.status()).toBe(200);

		await page.goto("/friends");
		await hydrated(page);
		await page
			.locator(".people li", { hasText: bob.account.name })
			.getByRole("button", { name: "解除" })
			.click();
		await expect(page.getByRole("heading", { name: "フレンド（0）" })).toBeVisible();

		expect((await page.goto(`/posts/${id}`))?.status()).toBe(404);
	} finally {
		await bob.close();
	}
});

test("届いていない相手を承認することはできない", async ({ page }) => {
	await signUp(page, "lonely");

	await page.goto("/friends");
	await hydrated(page);

	// 誰からも来ていなければ、承認の欄そのものが出ない。
	await expect(page.getByRole("heading", { name: "届いている申請" })).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "フレンド（0）" })).toBeVisible();
});

test("いないユーザー名に申請すると断られる", async ({ page }) => {
	await signUp(page, "seeker");

	await page.goto("/friends");
	await hydrated(page);
	await page.getByLabel("相手のユーザー名").fill("nobody_here_at_all");
	await page.getByRole("button", { name: "申請する" }).click();

	await expect(page.getByText("そのユーザー名の人は見つかりません")).toBeVisible();
	await expect(page.getByText("申請を送りました。相手の承認待ちです。")).toHaveCount(0);
});
