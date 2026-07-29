/**
 * 登録から入り直しまで。
 *
 * 確認メールを踏むまではログインできない（`requireEmailVerification`）ので、
 * 「送っただけ」で通ってしまわないことも一緒に確かめる。
 */

import { expect, hydrated, newAccount, test } from "./fixtures";
import { waitForVerificationUrl } from "./mail";

test("登録 → 確認メール → ログイン", async ({ page }) => {
	const account = newAccount("signup");

	await page.goto("/signup");
	// 水和前に押すと素の form 送信になり、GET でページごと飛んでしまう。
	await hydrated(page);
	await page.getByLabel("表示名").fill(account.name);
	await page.getByLabel("ユーザー名").fill(account.username);
	await page.getByLabel("メールアドレス").fill(account.email);
	await page.getByLabel("パスワード").fill(account.password);
	await page.getByRole("button", { name: "登録する" }).click();

	await expect(page.getByText("確認メールを送りました")).toBeVisible();

	// 確認前は入れない。
	await page.goto("/signin");
	await hydrated(page);
	await page.getByLabel("メールアドレス").fill(account.email);
	await page.getByLabel("パスワード").fill(account.password);
	await page.getByRole("button", { name: "ログイン" }).click();
	await expect(page.getByText("メールアドレスがまだ確認されていません。")).toBeVisible();

	// 確認するとその場でログインする（`autoSignInAfterVerification`）。
	await page.goto(await waitForVerificationUrl(account.email));
	await expect(page).toHaveURL("/");
	await expect(page.locator("header .me")).toContainText(account.name);

	await hydrated(page, "header");
	await page.getByRole("button", { name: "ログアウト" }).click();
	await expect(page.locator("header").getByRole("link", { name: "ログイン" })).toBeVisible();

	// 確認が済んでいれば、今度は画面から入れる。
	await page.goto("/signin");
	await hydrated(page);
	await page.getByLabel("メールアドレス").fill(account.email);
	await page.getByLabel("パスワード").fill(account.password);
	await page.getByRole("button", { name: "ログイン" }).click();

	await expect(page).toHaveURL("/");
	await expect(page.locator("header .me")).toContainText(account.name);
});

test("ログインしていなければ投稿ページに入れない", async ({ page }) => {
	await page.goto("/posts/new");

	await expect(page).toHaveURL("/signin");
});
