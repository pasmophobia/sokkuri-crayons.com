/**
 * D1 の `post` テーブル。一覧・詳細ページが読む索引で、
 * キャンバスの中身そのものは Post Durable Object が持つ。
 */

import type { PostMeta, Visibility } from "../agents/post/ops";

/** 一覧・詳細で使う投稿 1 件（投稿者の表示名を join 済み）。 */
export type PostRow = PostMeta & {
	id: string;
	/**
	 * 投稿者の表示名。未設定なら null。
	 * 代わりに何と出すかは表示側が決める（文言は言語で変わるため）。
	 */
	authorName: string | null;
	/** 投稿者のアイコン（R2 キー）。未設定なら null。 */
	authorImage: string | null;
};

type PostRecord = {
	id: string;
	authorId: string;
	authorName: string | null;
	authorImage: string | null;
	imageKey: string;
	aspectRatio: number;
	caption: string;
	createdAt: number;
	visibility: Visibility;
};

const SELECT = `
	select p."id", p."authorId", u."name" as "authorName", u."image" as "authorImage", p."imageKey",
	       p."aspectRatio", p."caption", p."createdAt", p."visibility"
	from "post" p
	join "user" u on u."id" = p."authorId"
`;

/**
 * 閲覧者に見せてよい投稿を絞る条件。
 * 全体公開 / 自分の投稿 / 投稿者と成立済みのフレンド、のいずれか。
 * `?1` は閲覧者の ID（未ログインなら null が入り、全体公開だけが残る）。
 */
const VISIBLE_TO = `(
	p."visibility" = 'public'
	or p."authorId" = ?1
	or exists (
		select 1 from "friendship" f
		where f."status" = 'accepted'
		  and ((f."requesterId" = p."authorId" and f."addresseeId" = ?1)
		    or (f."addresseeId" = p."authorId" and f."requesterId" = ?1))
	)
)`;

function toRow(record: PostRecord): PostRow {
	return {
		id: record.id,
		authorId: record.authorId,
		authorName: record.authorName,
		authorImage: record.authorImage,
		imageKey: record.imageKey,
		aspectRatio: record.aspectRatio,
		caption: record.caption,
		createdAt: record.createdAt,
		visibility: record.visibility,
	};
}

/** 一覧。閲覧者に見えるものだけを返す（未ログインは viewerId を null に）。 */
export async function listPosts(
	db: D1Database,
	viewerId: string | null,
	limit = 60,
): Promise<PostRow[]> {
	const { results } = await db
		.prepare(`${SELECT} where ${VISIBLE_TO} order by p."createdAt" desc limit ?2`)
		.bind(viewerId, limit)
		.all<PostRecord>();
	return results.map(toRow);
}

/**
 * 公開範囲を問わず 1 件引く。表示可否は呼び出し側で判断すること。
 * 判断込みで欲しい場合は `getVisiblePost` を使う。
 */
export async function getPost(db: D1Database, id: string): Promise<PostRow | null> {
	const record = await db.prepare(`${SELECT} where p."id" = ?1`).bind(id).first<PostRecord>();
	return record ? toRow(record) : null;
}

/** 閲覧者に見せてよい場合だけ返す。見せられないものは存在しないものとして扱う。 */
export async function getVisiblePost(
	db: D1Database,
	id: string,
	viewerId: string | null,
): Promise<PostRow | null> {
	const record = await db
		.prepare(`${SELECT} where p."id" = ?2 and ${VISIBLE_TO}`)
		.bind(viewerId, id)
		.first<PostRecord>();
	return record ? toRow(record) : null;
}

/**
 * 投稿を消す。消せるのは投稿者だけなので、所有者の条件も同じ文に畳み込む。
 * 実際に 1 行消えたときだけ true。他人の投稿・存在しない ID はどちらも false。
 */
export async function deletePost(db: D1Database, id: string, authorId: string): Promise<boolean> {
	const { meta } = await db
		.prepare(`delete from "post" where "id" = ?1 and "authorId" = ?2`)
		.bind(id, authorId)
		.run();
	return meta.changes > 0;
}

/**
 * この元画像を指している投稿がもう無いか。
 * 同じキーで 2 度投稿されている場合に、R2 の実体を巻き添えで消さないための確認。
 */
export async function isImageKeyUnused(db: D1Database, imageKey: string): Promise<boolean> {
	const row = await db
		.prepare(`select 1 as "found" from "post" where "imageKey" = ?1 limit 1`)
		.bind(imageKey)
		.first<{ found: number }>();
	return row === null;
}

export async function insertPost(
	db: D1Database,
	input: {
		id: string;
		authorId: string;
		imageKey: string;
		aspectRatio: number;
		caption: string;
		visibility: Visibility;
	},
): Promise<void> {
	await db
		.prepare(
			`insert into "post"
				("id", "authorId", "imageKey", "aspectRatio", "caption", "createdAt", "visibility")
			 values (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
		)
		.bind(
			input.id,
			input.authorId,
			input.imageKey,
			input.aspectRatio,
			input.caption,
			Date.now(),
			input.visibility,
		)
		.run();
}
