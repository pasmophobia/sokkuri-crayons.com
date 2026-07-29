/**
 * 投稿の公開範囲を本物の D1 に対して確かめる。
 *
 * `VISIBLE_TO` は「見せてはいけないものを見せない」ための唯一の関門なので、
 * 未ログイン・他人・フレンド・投稿者の 4 通りをすべて通す。
 */

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { getPost, getVisiblePost, insertPost, listPosts } from "./posts";
import { requestFriendship, respondToRequest } from "./friends";
import { resetDb, seedPost, seedUser } from "../test/seed";

const db = env.DB;

/** alice と friend は成立済み、stranger は無関係。 */
beforeEach(async () => {
	await resetDb();
	await seedUser({ id: "alice", name: "アリス" });
	await seedUser({ id: "friend", name: "ともだち" });
	await seedUser({ id: "stranger", name: "他人" });
	await requestFriendship(db, "alice", "friend");
	await respondToRequest(db, "friend", "alice", true);
});

describe("listPosts", () => {
	beforeEach(async () => {
		await seedPost({ id: "pub", authorId: "alice", visibility: "public", createdAt: 1 });
		await seedPost({ id: "fri", authorId: "alice", visibility: "friends", createdAt: 2 });
	});

	it("未ログインには全体公開だけを返す", async () => {
		expect((await listPosts(db, null)).map((p) => p.id)).toEqual(["pub"]);
	});

	it("無関係な閲覧者にも全体公開だけを返す", async () => {
		expect((await listPosts(db, "stranger")).map((p) => p.id)).toEqual(["pub"]);
	});

	it("フレンドには friends 限定も返す", async () => {
		expect((await listPosts(db, "friend")).map((p) => p.id)).toEqual(["fri", "pub"]);
	});

	it("投稿者には自分のものが全部見える", async () => {
		expect((await listPosts(db, "alice")).map((p) => p.id)).toEqual(["fri", "pub"]);
	});

	it("新しい順に並び、limit で打ち切る", async () => {
		await seedPost({ id: "newest", authorId: "alice", visibility: "public", createdAt: 99 });
		expect((await listPosts(db, "alice", 2)).map((p) => p.id)).toEqual(["newest", "fri"]);
	});

	it("フレンドを解除すると friends 限定が見えなくなる", async () => {
		await respondToRequest(db, "friend", "alice", true);
		expect((await listPosts(db, "friend")).map((p) => p.id)).toContain("fri");

		await db
			.prepare(`delete from "friendship" where "requesterId" = ?1 and "addresseeId" = ?2`)
			.bind("alice", "friend")
			.run();
		expect((await listPosts(db, "friend")).map((p) => p.id)).toEqual(["pub"]);
	});

	it("投稿者の表示名とアイコンを join して返す", async () => {
		await seedUser({ id: "withIcon", name: "アイコン持ち", image: "avatars/x.webp" });
		await seedPost({ id: "iconPost", authorId: "withIcon", visibility: "public", createdAt: 3 });

		const post = (await listPosts(db, null)).find((p) => p.id === "iconPost");
		expect(post).toMatchObject({ authorName: "アイコン持ち", authorImage: "avatars/x.webp" });
	});
});

describe("getVisiblePost", () => {
	beforeEach(async () => {
		await seedPost({ id: "fri", authorId: "alice", visibility: "friends" });
	});

	it("見せてよい相手にだけ返す", async () => {
		expect(await getVisiblePost(db, "fri", "alice")).not.toBeNull();
		expect(await getVisiblePost(db, "fri", "friend")).not.toBeNull();
	});

	it("見せられない相手には、存在しないものとして null を返す", async () => {
		expect(await getVisiblePost(db, "fri", "stranger")).toBeNull();
		expect(await getVisiblePost(db, "fri", null)).toBeNull();
	});

	it("そもそも無い ID にも null", async () => {
		expect(await getVisiblePost(db, "missing", "alice")).toBeNull();
	});
});

describe("getPost", () => {
	it("公開範囲を問わず引ける（判断は呼び出し側）", async () => {
		await seedPost({ id: "fri", authorId: "alice", visibility: "friends" });
		expect(await getPost(db, "fri")).toMatchObject({ id: "fri", visibility: "friends" });
		expect(await getPost(db, "missing")).toBeNull();
	});
});

describe("insertPost", () => {
	it("入力どおりの行を作り、閲覧規則に従わせる", async () => {
		await insertPost(db, {
			id: "new",
			authorId: "alice",
			imageKey: "originals/3f2504e0-4f89-11d3-9a0c-0305e82c3301.jpg",
			aspectRatio: 1.5,
			caption: "ねこ",
			visibility: "friends",
		});

		expect(await getPost(db, "new")).toMatchObject({
			authorId: "alice",
			authorName: "アリス",
			imageKey: "originals/3f2504e0-4f89-11d3-9a0c-0305e82c3301.jpg",
			aspectRatio: 1.5,
			caption: "ねこ",
			visibility: "friends",
		});
		expect(await getVisiblePost(db, "new", "stranger")).toBeNull();
	});

	it("createdAt を自分で打つので、直後の一覧の先頭に来る", async () => {
		await seedPost({ id: "old", authorId: "alice", visibility: "public", createdAt: 1 });
		await insertPost(db, {
			id: "new",
			authorId: "alice",
			imageKey: "originals/3f2504e0-4f89-11d3-9a0c-0305e82c3301.jpg",
			aspectRatio: 1,
			caption: "",
			visibility: "public",
		});

		expect((await listPosts(db, null)).map((p) => p.id)).toEqual(["new", "old"]);
	});
});
