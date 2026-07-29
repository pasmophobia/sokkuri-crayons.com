/**
 * フレンド関係。相互承認制で、成立後は対称に扱う。
 *
 * 1 組につき 1 行しか持たないので、照会するときは常に
 * requesterId / addresseeId の両方向を見る。ここを片方向で書くと
 * 「自分から申請したときだけフレンドに見える」というバグになる。
 */

export type FriendshipStatus = "pending" | "accepted";

export type Friend = {
	id: string;
	name: string;
	/**
	 * 表示用のユーザー名。入力どおりの大小を優先し、無ければ正規化済みの方を使う
	 * （update-user 経由で設定すると displayUsername が空のままになるため）。
	 */
	displayUsername: string | null;
	/** アイコン（R2 キー）。未設定なら null。 */
	image: string | null;
};

export type FriendRequest = Friend & { createdAt: number };

/** 2 人が成立済みのフレンドかどうか。 */
export async function areFriends(db: D1Database, a: string, b: string): Promise<boolean> {
	if (a === b) return true;
	const row = await db
		.prepare(
			`select 1 as ok from "friendship"
			 where "status" = 'accepted'
			   and (("requesterId" = ?1 and "addresseeId" = ?2)
			     or ("requesterId" = ?2 and "addresseeId" = ?1))
			 limit 1`,
		)
		.bind(a, b)
		.first<{ ok: number }>();
	return row !== null;
}

/** 成立済みのフレンド一覧。 */
export async function listFriends(db: D1Database, userId: string): Promise<Friend[]> {
	const { results } = await db
		.prepare(
			`select u."id", u."name", coalesce(u."displayUsername", u."username") as "displayUsername", u."image"
			 from "friendship" f
			 join "user" u
			   on u."id" = case when f."requesterId" = ?1 then f."addresseeId" else f."requesterId" end
			 where f."status" = 'accepted'
			   and (f."requesterId" = ?1 or f."addresseeId" = ?1)
			 order by u."name"`,
		)
		.bind(userId)
		.all<Friend>();
	return results;
}

/** 自分宛に届いている未承認の申請。 */
export async function listIncomingRequests(
	db: D1Database,
	userId: string,
): Promise<FriendRequest[]> {
	const { results } = await db
		.prepare(
			`select u."id", u."name", coalesce(u."displayUsername", u."username") as "displayUsername", u."image", f."createdAt"
			 from "friendship" f
			 join "user" u on u."id" = f."requesterId"
			 where f."addresseeId" = ?1 and f."status" = 'pending'
			 order by f."createdAt" desc`,
		)
		.bind(userId)
		.all<FriendRequest>();
	return results;
}

/** 自分が出したまま承認されていない申請。 */
export async function listOutgoingRequests(
	db: D1Database,
	userId: string,
): Promise<FriendRequest[]> {
	const { results } = await db
		.prepare(
			`select u."id", u."name", coalesce(u."displayUsername", u."username") as "displayUsername", u."image", f."createdAt"
			 from "friendship" f
			 join "user" u on u."id" = f."addresseeId"
			 where f."requesterId" = ?1 and f."status" = 'pending'
			 order by f."createdAt" desc`,
		)
		.bind(userId)
		.all<FriendRequest>();
	return results;
}

export type RequestOutcome =
	| { ok: true; status: FriendshipStatus }
	| { ok: false; reason: string };

/**
 * 入力されたユーザー名を、保存されている形に合わせる。
 *
 * 画面では handle らしく `@name` と見せているので、そのまま貼られることを
 * 前提にする。保存されているのは `@` なしの小文字なので、ここで落として揃える。
 */
export function normalizeUsername(input: string): string {
	return input.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * ユーザー名でフレンド申請を出す。
 *
 * 相手から先に申請が来ていた場合は、新しい行を作らずその場で成立させる
 * （すれ違いで 2 行できると、どちらも pending のまま止まってしまう）。
 */
export async function requestFriendship(
	db: D1Database,
	requesterId: string,
	username: string,
): Promise<RequestOutcome> {
	const normalized = normalizeUsername(username);
	if (normalized === "") return { ok: false, reason: "ユーザー名を入力してください" };

	const target = await db
		.prepare(`select "id" from "user" where "username" = ?1`)
		.bind(normalized)
		.first<{ id: string }>();

	if (!target) return { ok: false, reason: "そのユーザー名の人は見つかりません" };
	if (target.id === requesterId) return { ok: false, reason: "自分には申請できません" };

	const existing = await db
		.prepare(
			`select "requesterId", "status" from "friendship"
			 where ("requesterId" = ?1 and "addresseeId" = ?2)
			    or ("requesterId" = ?2 and "addresseeId" = ?1)`,
		)
		.bind(requesterId, target.id)
		.first<{ requesterId: string; status: FriendshipStatus }>();

	if (existing?.status === "accepted") {
		return { ok: false, reason: "すでにフレンドです" };
	}
	if (existing?.requesterId === requesterId) {
		return { ok: false, reason: "すでに申請済みです" };
	}
	if (existing) {
		// 相手からの申請が先に来ていた。折り返しの申請は承認とみなす。
		await respondToRequest(db, requesterId, existing.requesterId, true);
		return { ok: true, status: "accepted" };
	}

	await db
		.prepare(
			`insert into "friendship" ("requesterId", "addresseeId", "status", "createdAt")
			 values (?1, ?2, 'pending', ?3)`,
		)
		.bind(requesterId, target.id, Date.now())
		.run();
	return { ok: true, status: "pending" };
}

/** 自分宛の申請に応える。承認しない場合は行ごと消す。 */
export async function respondToRequest(
	db: D1Database,
	userId: string,
	requesterId: string,
	accept: boolean,
): Promise<boolean> {
	if (!accept) {
		const { meta } = await db
			.prepare(
				`delete from "friendship"
				 where "requesterId" = ?1 and "addresseeId" = ?2 and "status" = 'pending'`,
			)
			.bind(requesterId, userId)
			.run();
		return (meta.changes ?? 0) > 0;
	}

	const { meta } = await db
		.prepare(
			`update "friendship" set "status" = 'accepted', "respondedAt" = ?3
			 where "requesterId" = ?1 and "addresseeId" = ?2 and "status" = 'pending'`,
		)
		.bind(requesterId, userId, Date.now())
		.run();
	return (meta.changes ?? 0) > 0;
}

/** フレンドを解除する。申請中の取り消しも兼ねる。 */
export async function removeFriendship(
	db: D1Database,
	userId: string,
	otherId: string,
): Promise<boolean> {
	const { meta } = await db
		.prepare(
			`delete from "friendship"
			 where ("requesterId" = ?1 and "addresseeId" = ?2)
			    or ("requesterId" = ?2 and "addresseeId" = ?1)`,
		)
		.bind(userId, otherId)
		.run();
	return (meta.changes ?? 0) > 0;
}
