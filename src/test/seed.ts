/**
 * D1 を使うテストの下ごしらえ。
 *
 * better-auth のテーブルにユーザーを直接入れる。本物の sign-up 経路を通すと
 * パスワードハッシュに時間がかかるうえ、ここで確かめたいのは SQL 層だけなので
 * 最小限の行を置く。
 */

import { env } from "cloudflare:workers";

/**
 * アプリのテーブルを空に戻す。
 *
 * `isolatedStorage` の巻き戻しに任せず、テストごとに自分で消す。どこまでが
 * 巻き戻る範囲かを暗黙の前提にすると、テストの並べ替えで落ちるようになる。
 * `d1_migrations` は残す — スキーマまで消すと流し直しになる。
 */
export async function resetDb(): Promise<void> {
	await env.DB.batch([
		env.DB.prepare(`delete from "friendship"`),
		env.DB.prepare(`delete from "post"`),
		env.DB.prepare(`delete from "session"`),
		env.DB.prepare(`delete from "account"`),
		env.DB.prepare(`delete from "user"`),
	]);
}

export type SeedUser = {
	id: string;
	name?: string;
	username?: string;
	displayUsername?: string | null;
	image?: string | null;
};

export async function seedUser(user: SeedUser): Promise<string> {
	const now = Date.now();
	await env.DB.prepare(
		`insert into "user"
			("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt",
			 "username", "displayUsername")
		 values (?1, ?2, ?3, 0, ?4, ?5, ?5, ?6, ?7)`,
	)
		.bind(
			user.id,
			user.name ?? user.id,
			`${user.id}@example.test`,
			user.image ?? null,
			now,
			user.username ?? user.id,
			user.displayUsername === undefined ? null : user.displayUsername,
		)
		.run();
	return user.id;
}

export type SeedPost = {
	id: string;
	authorId: string;
	caption?: string;
	visibility?: "public" | "friends";
	createdAt?: number;
};

export async function seedPost(post: SeedPost): Promise<string> {
	await env.DB.prepare(
		`insert into "post"
			("id", "authorId", "imageKey", "aspectRatio", "caption", "createdAt", "visibility")
		 values (?1, ?2, ?3, 1.0, ?4, ?5, ?6)`,
	)
		.bind(
			post.id,
			post.authorId,
			`originals/${post.id.padEnd(8, "0").slice(0, 8)}-0000-0000-0000-000000000000.jpg`,
			post.caption ?? "",
			post.createdAt ?? Date.now(),
			post.visibility ?? "public",
		)
		.run();
	return post.id;
}
