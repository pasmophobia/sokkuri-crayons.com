/**
 * D1 の `post` テーブル。一覧・詳細ページが読む索引で、
 * キャンバスの中身そのものは Post Durable Object が持つ。
 */

import type { PostMeta } from "../agents/post/ops";

/** 一覧・詳細で使う投稿 1 件（投稿者の表示名を join 済み）。 */
export type PostRow = PostMeta & {
	id: string;
	authorName: string;
	/** サムネイルを最後に焼いた時刻。null なら未生成。 */
	thumbnailUpdatedAt: number | null;
};

type PostRecord = {
	id: string;
	authorId: string;
	authorName: string | null;
	imageKey: string;
	aspectRatio: number;
	caption: string;
	createdAt: number;
	thumbnailUpdatedAt: number | null;
};

const SELECT = `
	select p."id", p."authorId", u."name" as "authorName", p."imageKey",
	       p."aspectRatio", p."caption", p."createdAt", p."thumbnailUpdatedAt"
	from "post" p
	join "user" u on u."id" = p."authorId"
`;

function toRow(record: PostRecord): PostRow {
	return {
		id: record.id,
		authorId: record.authorId,
		authorName: record.authorName ?? "名無し",
		imageKey: record.imageKey,
		aspectRatio: record.aspectRatio,
		caption: record.caption,
		createdAt: record.createdAt,
		thumbnailUpdatedAt: record.thumbnailUpdatedAt,
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
	const record = await db.prepare(`${SELECT} where p."id" = ?1`).bind(id).first<PostRecord>();
	return record ? toRow(record) : null;
}

export async function insertPost(
	db: D1Database,
	input: { id: string; authorId: string; imageKey: string; aspectRatio: number; caption: string },
): Promise<void> {
	await db
		.prepare(
			`insert into "post" ("id", "authorId", "imageKey", "aspectRatio", "caption", "createdAt")
			 values (?1, ?2, ?3, ?4, ?5, ?6)`,
		)
		.bind(input.id, input.authorId, input.imageKey, input.aspectRatio, input.caption, Date.now())
		.run();
}

export type ThumbnailClaim =
	| { claimed: true }
	| { claimed: false; thumbnailUpdatedAt: number | null; retryAfterMs: number };

/**
 * サムネイルを焼く権利を取る。同じ投稿を見ている全クライアントが一斉に
 * 焼きに来るのを間引くため、直近に焼かれたばかりなら取れない。
 *
 * 取れなかった側には「いつなら焼けるか」を返す。ここを黙って捨てると、
 * 編集セッションの最後の一枚 —— 一番新しくて一番重要なやつ —— が
 * 落ちたまま誰も焼き直さない。
 */
export async function claimThumbnail(
	db: D1Database,
	postId: string,
	minIntervalMs: number,
): Promise<ThumbnailClaim> {
	const now = Date.now();
	const { meta } = await db
		.prepare(
			`update "post" set "thumbnailUpdatedAt" = ?2
			 where "id" = ?1
			   and ("thumbnailUpdatedAt" is null or "thumbnailUpdatedAt" < ?3)`,
		)
		.bind(postId, now, now - minIntervalMs)
		.run();
	if ((meta.changes ?? 0) > 0) return { claimed: true };

	const row = await db
		.prepare(`select "thumbnailUpdatedAt" from "post" where "id" = ?1`)
		.bind(postId)
		.first<{ thumbnailUpdatedAt: number | null }>();
	const last = row?.thumbnailUpdatedAt ?? null;

	return {
		claimed: false,
		thumbnailUpdatedAt: last,
		retryAfterMs: last === null ? minIntervalMs : Math.max(0, last + minIntervalMs - now),
	};
}
