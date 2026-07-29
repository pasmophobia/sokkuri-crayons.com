/**
 * D1 の `post` テーブル。一覧・詳細ページが読む索引で、
 * キャンバスの中身そのものは Post Durable Object が持つ。
 */

import type { PostMeta } from "../agents/post/ops";

/** 一覧・詳細で使う投稿 1 件（投稿者の表示名を join 済み）。 */
export type PostRow = PostMeta & {
	id: string;
	authorName: string;
};

type PostRecord = {
	id: string;
	authorId: string;
	authorName: string | null;
	imageUrl: string;
	aspectRatio: number;
	caption: string;
	createdAt: number;
};

const SELECT = `
	select p."id", p."authorId", u."name" as "authorName", p."imageUrl",
	       p."aspectRatio", p."caption", p."createdAt"
	from "post" p
	join "user" u on u."id" = p."authorId"
`;

function toRow(record: PostRecord): PostRow {
	return {
		id: record.id,
		authorId: record.authorId,
		authorName: record.authorName ?? "名無し",
		imageUrl: record.imageUrl,
		aspectRatio: record.aspectRatio,
		caption: record.caption,
		createdAt: record.createdAt,
	};
}

export async function listPosts(db: D1Database, limit = 60): Promise<PostRow[]> {
	const { results } = await db
		.prepare(`${SELECT} order by p."createdAt" desc limit ?1`)
		.bind(limit)
		.all<PostRecord>();
	return results.map(toRow);
}

export async function getPost(db: D1Database, id: string): Promise<PostRow | null> {
	const record = await db
		.prepare(`${SELECT} where p."id" = ?1`)
		.bind(id)
		.first<PostRecord>();
	return record ? toRow(record) : null;
}

export async function insertPost(
	db: D1Database,
	input: { id: string; authorId: string; imageUrl: string; aspectRatio: number; caption: string },
): Promise<void> {
	await db
		.prepare(
			`insert into "post" ("id", "authorId", "imageUrl", "aspectRatio", "caption", "createdAt")
			 values (?1, ?2, ?3, ?4, ?5, ?6)`,
		)
		.bind(
			input.id,
			input.authorId,
			input.imageUrl,
			input.aspectRatio,
			input.caption,
			Date.now(),
		)
		.run();
}
