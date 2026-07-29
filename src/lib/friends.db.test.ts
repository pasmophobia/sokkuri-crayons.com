/**
 * フレンド関係を本物の D1（workerd のローカル実装）に対して確かめる。
 *
 * ここは「片方向で書くとバグる」箇所なので、SQL をモックしても意味がない。
 */

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
	areFriends,
	listFriends,
	listIncomingRequests,
	listOutgoingRequests,
	removeFriendship,
	requestFriendship,
	respondToRequest,
} from "./friends";
import { resetDb, seedUser } from "../test/seed";

const db = env.DB;

beforeEach(async () => {
	await resetDb();
	await seedUser({ id: "alice", name: "アリス", username: "alice" });
	await seedUser({ id: "bob", name: "ボブ", username: "bob" });
	await seedUser({ id: "carol", name: "キャロル", username: "carol" });
});

describe("requestFriendship", () => {
	it("ユーザー名で申請を出すと pending になる", async () => {
		expect(await requestFriendship(db, "alice", "bob")).toEqual({ ok: true, status: "pending" });

		expect((await listOutgoingRequests(db, "alice")).map((r) => r.id)).toEqual(["bob"]);
		expect((await listIncomingRequests(db, "bob")).map((r) => r.id)).toEqual(["alice"]);
		expect(await areFriends(db, "alice", "bob")).toBe(false);
	});

	it("貼り付けられた @username と大文字をそのまま受け取れる", async () => {
		expect(await requestFriendship(db, "alice", " @Bob ")).toEqual({
			ok: true,
			status: "pending",
		});
	});

	it("自分自身・空・存在しない相手を断る", async () => {
		expect((await requestFriendship(db, "alice", "alice")).ok).toBe(false);
		expect((await requestFriendship(db, "alice", "   ")).ok).toBe(false);
		expect((await requestFriendship(db, "alice", "nobody")).ok).toBe(false);
	});

	it("二重申請と、成立済みへの再申請を断る", async () => {
		await requestFriendship(db, "alice", "bob");
		expect((await requestFriendship(db, "alice", "bob")).ok).toBe(false);

		await respondToRequest(db, "bob", "alice", true);
		expect((await requestFriendship(db, "alice", "bob")).ok).toBe(false);
	});

	it("すれ違いの折り返し申請は、行を増やさずその場で成立させる", async () => {
		await requestFriendship(db, "alice", "bob");
		expect(await requestFriendship(db, "bob", "alice")).toEqual({ ok: true, status: "accepted" });

		expect(await areFriends(db, "alice", "bob")).toBe(true);
		const { results } = await db.prepare(`select * from "friendship"`).all();
		expect(results).toHaveLength(1);
	});
});

describe("respondToRequest", () => {
	beforeEach(async () => {
		await requestFriendship(db, "alice", "bob");
	});

	it("承認すると双方向にフレンドとして見える", async () => {
		expect(await respondToRequest(db, "bob", "alice", true)).toBe(true);

		expect(await areFriends(db, "alice", "bob")).toBe(true);
		expect(await areFriends(db, "bob", "alice")).toBe(true);
		expect((await listFriends(db, "alice")).map((f) => f.id)).toEqual(["bob"]);
		expect((await listFriends(db, "bob")).map((f) => f.id)).toEqual(["alice"]);
		expect(await listIncomingRequests(db, "bob")).toEqual([]);
	});

	it("拒否すると行ごと消える", async () => {
		expect(await respondToRequest(db, "bob", "alice", false)).toBe(true);

		expect(await areFriends(db, "alice", "bob")).toBe(false);
		expect(await listIncomingRequests(db, "bob")).toEqual([]);
		expect(await listOutgoingRequests(db, "alice")).toEqual([]);
	});

	it("申請を出した側は自分では承認できない", async () => {
		expect(await respondToRequest(db, "alice", "alice", true)).toBe(false);
		expect(await areFriends(db, "alice", "bob")).toBe(false);
	});

	it("届いていない申請に応えても何も起きない", async () => {
		expect(await respondToRequest(db, "carol", "alice", true)).toBe(false);
	});
});

describe("areFriends", () => {
	it("自分自身は常にフレンド扱い", async () => {
		expect(await areFriends(db, "alice", "alice")).toBe(true);
	});

	it("pending のあいだは false", async () => {
		await requestFriendship(db, "alice", "bob");
		expect(await areFriends(db, "alice", "bob")).toBe(false);
		expect(await areFriends(db, "bob", "alice")).toBe(false);
	});

	it("無関係な相手とは false", async () => {
		expect(await areFriends(db, "alice", "carol")).toBe(false);
	});
});

describe("listFriends", () => {
	it("表示用ユーザー名は displayUsername を優先し、無ければ username に落とす", async () => {
		await seedUser({ id: "dave", username: "dave", displayUsername: "DaVe" });
		await requestFriendship(db, "alice", "dave");
		await respondToRequest(db, "dave", "alice", true);
		await requestFriendship(db, "alice", "bob");
		await respondToRequest(db, "bob", "alice", true);

		const byId = new Map((await listFriends(db, "alice")).map((f) => [f.id, f]));
		expect(byId.get("dave")?.displayUsername).toBe("DaVe");
		expect(byId.get("bob")?.displayUsername).toBe("bob");
	});

	it("申請の向きに関係なく一覧に出る", async () => {
		await requestFriendship(db, "alice", "bob");
		await respondToRequest(db, "bob", "alice", true);
		await requestFriendship(db, "carol", "alice");
		await respondToRequest(db, "alice", "carol", true);

		expect((await listFriends(db, "alice")).map((f) => f.id).sort()).toEqual(["bob", "carol"]);
	});
});

describe("removeFriendship", () => {
	it("成立済みの関係を、どちら側からでも解除できる", async () => {
		await requestFriendship(db, "alice", "bob");
		await respondToRequest(db, "bob", "alice", true);

		expect(await removeFriendship(db, "bob", "alice")).toBe(true);
		expect(await areFriends(db, "alice", "bob")).toBe(false);
	});

	it("申請中の取り消しも兼ねる", async () => {
		await requestFriendship(db, "alice", "bob");

		expect(await removeFriendship(db, "alice", "bob")).toBe(true);
		expect(await listIncomingRequests(db, "bob")).toEqual([]);
	});

	it("関係が無ければ false", async () => {
		expect(await removeFriendship(db, "alice", "carol")).toBe(false);
	});
});
