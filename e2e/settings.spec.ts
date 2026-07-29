/**
 * アカウントの編集。
 *
 * どの欄も保存すると読み直す作りなので（`AccountSettings` の reloadOnSuccess）、
 * 「画面に出た」ことは D1 まで届いたことと同じ意味になる。
 */

import { expect, hydrated, newAccount, openUser, signUp, test, unique } from "./fixtures";
import { PHOTO_TYPE, photo } from "./image";

test("表示名を変えると、ヘッダーとアカウント欄の両方に効く", async ({ page }) => {
	await signUp(page, "renamed");
	const after = unique("新しい名前");

	await page.goto("/settings");
	await hydrated(page);
	await page.getByLabel("表示名").fill(after);
	await page
		.locator("section", { hasText: "投稿やフレンド一覧に出る名前です" })
		.getByRole("button", { name: "変更する" })
		.click();

	await expect(page.locator("header .me")).toContainText(after);
	await expect(page.locator("dd").first()).toHaveText(after);
});

test("ユーザー名を変えると、フレンド画面の名乗りも変わる", async ({ page }) => {
	await signUp(page, "handle");
	const { username } = newAccount("handle");

	await page.goto("/settings");
	await hydrated(page);
	await page.getByLabel("ユーザー名").fill(username);
	await page
		.locator("section", { hasText: "フレンドを探してもらうとき" })
		.getByRole("button", { name: "変更する" })
		.click();

	await expect(page.getByText(`@${username}`)).toBeVisible();

	await page.goto("/friends");
	await expect(page.locator(".my-username code")).toHaveText(`@${username}`);
});

test("すでに使われているユーザー名は断られる", async ({ page, browser }) => {
	// 先に誰かが名乗っている状態を作る。
	const other = await openUser(browser, "taken");

	try {
		await signUp(page, "second");
		await page.goto("/settings");
		await hydrated(page);
		await page.getByLabel("ユーザー名").fill(other.account.username);
		await page
			.locator("section", { hasText: "フレンドを探してもらうとき" })
			.getByRole("button", { name: "変更する" })
			.click();

		await expect(page.getByText("そのユーザー名はすでに使われています")).toBeVisible();
	} finally {
		await other.close();
	}
});

test("アイコンを設定すると出るようになり、外すと消える", async ({ page }) => {
	await signUp(page, "avatar");

	await page.goto("/settings");
	await hydrated(page);
	await expect(page.locator(".avatar-lg.avatar-blank")).toBeVisible();

	await page.locator(".avatar-form input[type=file]").setInputFiles({
		name: "face.png",
		mimeType: PHOTO_TYPE,
		buffer: photo(320, 320),
	});

	// 上げた実体は R2、参照は better-auth の user.image。ブラウザは
	// 正方形に切って webp にしてから送る（`AvatarForm`）。
	const avatar = page.locator("img.avatar-lg");
	await expect(avatar).toHaveAttribute("src", /^\/api\/media\/avatars\/[0-9a-f-]{36}\.webp$/);
	await expect(page.locator("header img.avatar")).toBeVisible();

	await page.getByRole("button", { name: "外す" }).click();
	await expect(page.locator(".avatar-lg.avatar-blank")).toBeVisible();
});

test("パスワードを変えると、新しい方でだけ入り直せる", async ({ page }) => {
	const account = await signUp(page, "pass");
	const next = "e2e-password-5678";

	await page.goto("/settings");
	await hydrated(page);
	await page.getByLabel("現在のパスワード").fill(account.password);
	await page.getByLabel("新しいパスワード").fill(next);
	await page
		.locator("section", { hasText: "現在のパスワード" })
		.getByRole("button", { name: "変更する" })
		.click();
	await expect(page.getByText("パスワードを変更しました")).toBeVisible();

	// 切れるのは他の端末なので、この画面は入ったまま。自分で出てから試す。
	await hydrated(page, "header");
	await page.getByRole("button", { name: "ログアウト" }).click();
	await expect(page.locator("header").getByRole("link", { name: "ログイン" })).toBeVisible();

	await page.goto("/signin");
	await hydrated(page);
	await page.getByLabel("メールアドレス").fill(account.email);
	await page.getByLabel("パスワード").fill(account.password);
	await page.getByRole("button", { name: "ログイン" }).click();
	await expect(page.locator(".error")).not.toBeEmpty();

	await page.getByLabel("パスワード").fill(next);
	await page.getByRole("button", { name: "ログイン" }).click();
	await expect(page).toHaveURL("/");
	await expect(page.locator("header .me")).toContainText(account.name);
});
