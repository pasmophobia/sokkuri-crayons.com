/**
 * `Post` Agent — 画像投稿 1 件につき 1 インスタンス。
 *
 * 誰でも WebSocket で繋いで、他人の投稿にディスプレイスメントマップや
 * 落書きを重ねられる。編集は 2 段階で持つ:
 *
 *   pendingOps   … いま描いている最中。全員にライブ配信される。
 *   committedOps … 確定した履歴。`seq` の順が描画順。
 *
 * 保存の仕方をこの 2 つで分けている。
 *
 * 確定した op は `this.sql` の `committed_op` テーブルへその場で書く。
 * DO の `setTimeout` は耐久性がなく、最後の接続が閉じると保留中のタイマーは
 * 発火しないまま退避されるので、履歴の保存を遅延させてはいけない
 * （描いてタブを閉じる、が消える）。SQL 書き込みならブロードキャストも伴わない。
 *
 * 一方 `setState` は状態まるごとのブロードキャストを伴うので、点が 1 つ
 * 増えるたびには呼べない。こちらは #markDirty() で FLUSH_INTERVAL_MS ごとに
 * 束ね、クライアントへの再同期（取りこぼしの自己修復）専用として使う。
 * 落ちても困らない pendingOps の保存もこれに乗せている。
 *
 * つまり永続化の権威は SQL、`state` はその射影。起動時の復元は SQL から行う。
 */

import { Agent, type Connection, type ConnectionContext, type WSMessage } from "agents";

import { createAuth } from "../../auth";
import { areFriends } from "../../lib/friends";
import type { CommittedOp, PostMeta, PostState, SubmittedOp } from "./ops";
import {
	LIMITS,
	encode,
	parseClientMessage,
	type ClientMessage,
	type ServerMessage,
} from "./protocol";

export * from "./ops";
export * from "./protocol";

/** state の書き戻しを束ねる間隔。 */
const FLUSH_INTERVAL_MS = 200;

/**
 * 接続ごとの身元。`userId` が null なら未ログインの閲覧者で、
 * 見るだけはできるが編集はできない。
 */
type ConnectionState = { userId: string | null; displayName: string | null };

export class Post extends Agent<Env, PostState> {
	initialState: PostState = { post: null, committedOps: [], pendingOps: [] };

	// --- flush 前の最新状態。ここが唯一の真実で、state はその写し。 ---
	#post: PostMeta | null = null;
	#committed: CommittedOp[] = [];
	#committedIds = new Set<string>();
	#pending = new Map<string, SubmittedOp>();
	#seq = 0;
	#flushTimer: ReturnType<typeof setTimeout> | null = null;

	override onStart(): void {
		// DO が起きるたびに呼ばれる。
		this.sql`
			create table if not exists committed_op (
				id text primary key,
				seq integer not null,
				author_id text not null,
				committed_at integer not null,
				undone integer not null default 0,
				payload text not null
			)
		`;
		this.sql`create index if not exists committed_op_seq on committed_op (seq)`;

		// 履歴は SQL が権威。state ではなくこちらから復元する。
		this.#committed = this.#loadCommitted();
		this.#committedIds = new Set(this.#committed.map((op) => op.id));
		this.#seq = this.#committed.reduce((max, op) => Math.max(max, op.seq), 0);

		const state = this.state;
		this.#post = state.post;
		// 描きかけは落ちても構わないもの。残っていれば拾い、いなければ捨てる。
		this.#pending = new Map(state.pendingOps.map((op) => [op.id, op]));
		this.#sweepPending();

		// state 側の写しが SQL より古いことがあるので、起こしたついでに揃える。
		this.setState(this.#snapshot());
	}

	#loadCommitted(): CommittedOp[] {
		const rows = this.sql<{
			id: string;
			seq: number;
			author_id: string;
			committed_at: number;
			undone: number;
			payload: string;
		}>`
			select id, seq, author_id, committed_at, undone, payload
			from committed_op order by seq
		`;

		return rows.map((row) => ({
			id: row.id,
			authorId: row.author_id,
			seq: row.seq,
			committedAt: row.committed_at,
			payload: JSON.parse(row.payload) as CommittedOp["payload"],
			...(row.undone ? { undone: true as const } : {}),
		}));
	}

	/**
	 * クライアントからの state 直書き (`cf_agent_state`) を全面的に禁じる。
	 * 状態はサーバが唯一の権威で、変更は `op:*` メッセージ経由のみ。
	 * これを開けておくと、誰でも committedOps ごと差し替えられてしまう。
	 */
	override shouldConnectionBeReadonly(): boolean {
		return true;
	}

	override async onConnect(
		connection: Connection<ConnectionState>,
		ctx: ConnectionContext,
	): Promise<void> {
		// 同一オリジンの WebSocket ハンドシェイクにはブラウザが Cookie を載せるので、
		// better-auth のセッションをそのまま引ける。
		const identity = await this.#identify(ctx);
		connection.setState(identity);

		// 二重の防壁。本来の関門は `src/worker.ts` 側で、そちらは WebSocket が
		// 張られる前に弾く。ここまで来た時点では SDK が `cf_agent_state` を
		// 送り終えているので、ここだけでは情報漏れを止められない。
		if (!(await this.#mayView(identity.userId))) {
			this.#send(connection, { type: "error", message: "この投稿は公開されていません" });
			connection.close(4403, "forbidden");
			return;
		}

		// 前の接続が残していった編集中の op を掃除してから、現状を渡す。
		this.#sweepPending();
		this.#send(connection, {
			type: "hello",
			you: identity.userId,
			displayName: identity.displayName,
			state: this.#snapshot(),
		});
	}

	override onMessage(connection: Connection<ConnectionState>, message: WSMessage): void {
		if (typeof message !== "string") {
			this.#send(connection, { type: "error", message: "binary frames are not supported" });
			return;
		}
		const parsed = parseClientMessage(message);
		if (!parsed.ok) {
			this.#send(connection, { type: "error", message: parsed.reason });
			return;
		}
		this.#dispatch(connection, parsed.value);
	}

	override onClose(connection: Connection<ConnectionState>): void {
		// 描きかけのまま切断されたものは捨てる。確定していないので残す意味がない。
		for (const op of [...this.#pending.values()]) {
			if (op.connectionId === connection.id) this.#dropPending(op.id);
		}
	}

	/**
	 * 一覧のサムネイル描画用 (Durable Object RPC)。
	 * 取り消し済みを除いた確定 op を描画順で返す。編集中のものは含めない。
	 */
	async listCommittedOps(): Promise<CommittedOp[]> {
		return this.#committed.filter((op) => !op.undone).sort((a, b) => a.seq - b.seq);
	}

	/**
	 * 投稿作成時に `POST /api/posts` から 1 度だけ呼ばれる (Durable Object RPC)。
	 * メタ情報をクライアントに作らせないための、サーバ専用の入口。
	 * 冪等 — 既に初期化済みなら何もしない。
	 */
	async initPost(meta: PostMeta): Promise<void> {
		if (this.#post !== null) return;
		this.#post = meta;
		// 1 投稿につき 1 度きり。遅延させる理由がないので同期で書き切る。
		this.setState(this.#snapshot());
	}

	// --- メッセージ処理 ---

	#dispatch(connection: Connection<ConnectionState>, message: ClientMessage): void {
		// 編集はすべてログイン必須。未ログインは閲覧のみ。
		const authorId = connection.state?.userId ?? null;
		if (authorId === null) {
			this.#send(connection, {
				type: "error",
				message: "sign in to edit this post",
				ref: "id" in message ? message.id : undefined,
			});
			return;
		}

		switch (message.type) {
			case "op:begin": {
				if (this.#pending.has(message.id) || this.#committedIds.has(message.id)) {
					this.#send(connection, {
						type: "error",
						message: "op id already used",
						ref: message.id,
					});
					return;
				}
				const inFlight = [...this.#pending.values()].filter(
					(op) => op.connectionId === connection.id,
				).length;
				if (inFlight >= LIMITS.MAX_PENDING_OPS_PER_CONNECTION) {
					this.#send(connection, {
						type: "error",
						message: `at most ${LIMITS.MAX_PENDING_OPS_PER_CONNECTION} ops may be in flight`,
						ref: message.id,
					});
					return;
				}

				const now = Date.now();
				const op: SubmittedOp = {
					id: message.id,
					authorId,
					payload: message.payload,
					connectionId: connection.id,
					startedAt: now,
					updatedAt: now,
				};
				this.#pending.set(op.id, op);
				// 送信元は自分で描いているので、他の接続にだけ送る。
				this.#broadcast({ type: "op:began", op }, connection.id);
				this.#markDirty();
				return;
			}

			case "op:extend": {
				const op = this.#requireOwnPending(connection, message.id);
				if (!op) return;
				if (op.payload.kind === "text") {
					this.#send(connection, {
						type: "error",
						message: "text ops have no points to extend",
						ref: message.id,
					});
					return;
				}
				const total = op.payload.points.length + message.points.length;
				if (total > LIMITS.MAX_POINTS_PER_OP) {
					this.#send(connection, {
						type: "error",
						message: `an op may hold at most ${LIMITS.MAX_POINTS_PER_OP} points`,
						ref: message.id,
					});
					return;
				}

				op.payload.points.push(...message.points);
				op.updatedAt = Date.now();
				this.#broadcast(
					{ type: "op:extended", id: op.id, points: message.points },
					connection.id,
				);
				this.#markDirty();
				return;
			}

			case "op:commit": {
				const op = this.#requireOwnPending(connection, message.id);
				if (!op) return;
				if (this.#committed.length >= LIMITS.MAX_COMMITTED_OPS) {
					this.#send(connection, {
						type: "error",
						message: "this post has reached its edit limit",
						ref: message.id,
					});
					return;
				}

				const committed: CommittedOp = {
					id: op.id,
					authorId: op.authorId,
					payload: op.payload,
					seq: ++this.#seq,
					committedAt: Date.now(),
				};
				this.#pending.delete(op.id);
				this.#committed.push(committed);
				this.#committedIds.add(committed.id);
				// 履歴はここで確定させる。flush を待たない。
				this.sql`
					insert or replace into committed_op
						(id, seq, author_id, committed_at, undone, payload)
					values (${committed.id}, ${committed.seq}, ${committed.authorId},
						${committed.committedAt}, 0, ${JSON.stringify(committed.payload)})
				`;
				// commit は送信元にも返す。seq が確定するのはここだけなので。
				this.#broadcast({ type: "op:committed", op: committed });
				this.#markDirty();
				return;
			}

			case "op:cancel": {
				const op = this.#requireOwnPending(connection, message.id);
				if (!op) return;
				this.#dropPending(op.id);
				return;
			}

			case "op:undo": {
				const target = message.id
					? this.#committed.find((op) => op.id === message.id)
					: [...this.#committed].reverse().find((op) => op.authorId === authorId && !op.undone);

				if (!target) {
					this.#send(connection, { type: "error", message: "no op to undo", ref: message.id });
					return;
				}
				// 取り消せるのは自分の op だけ。投稿者であっても他人の落書きは
				// 消せない — 消せないことがこのサービスの性質。
				if (target.authorId !== authorId) {
					this.#send(connection, {
						type: "error",
						message: "you can only undo your own ops",
						ref: target.id,
					});
					return;
				}
				if (target.undone) return;

				target.undone = true;
				this.sql`update committed_op set undone = 1 where id = ${target.id}`;
				this.#broadcast({ type: "op:undone", id: target.id });
				this.#markDirty();
				return;
			}
		}
	}

	// --- ヘルパ ---

	/**
	 * WebSocket のアップグレード要求に載っている Cookie から better-auth の
	 * セッションを引く。セッションが無い / 引けない場合は閲覧者として扱う。
	 */
	/**
	 * この閲覧者に投稿を見せてよいか。判断の権威は D1 側の post 行。
	 * フレンド関係は後から変わるので、`#post` の写しではなく都度引く。
	 */
	async #mayView(userId: string | null): Promise<boolean> {
		try {
			const row = await this.env.DB.prepare(
				`select "authorId", "visibility" from "post" where "id" = ?1`,
			)
				.bind(this.name)
				.first<{ authorId: string; visibility: string }>();

			// 投稿レコードがまだ無い＝作成直後。作成経路は認証済みなので通す。
			if (!row) return true;
			if (row.visibility !== "friends") return true;
			if (userId === null) return false;
			if (userId === row.authorId) return true;
			return await areFriends(this.env.DB, userId, row.authorId);
		} catch (error) {
			console.error("failed to check post visibility", error);
			return false;
		}
	}

	async #identify(ctx: ConnectionContext): Promise<ConnectionState> {
		try {
			const auth = createAuth({
				env: this.env,
				baseURL: new URL(ctx.request.url).origin,
			});
			const session = await auth.api.getSession({ headers: ctx.request.headers });
			if (!session) return { userId: null, displayName: null };
			return { userId: session.user.id, displayName: session.user.name ?? null };
		} catch (error) {
			// 認証基盤が落ちているときに編集を通すわけにはいかないので、閲覧者に倒す。
			console.error("failed to resolve session for post connection", error);
			return { userId: null, displayName: null };
		}
	}

	/** 自分が始めた進行中の op を引く。無ければクライアントにエラーを返して null。 */
	#requireOwnPending(
		connection: Connection<ConnectionState>,
		id: string,
	): SubmittedOp | null {
		const op = this.#pending.get(id);
		if (!op) {
			this.#send(connection, { type: "error", message: "no such pending op", ref: id });
			return null;
		}
		if (op.connectionId !== connection.id) {
			this.#send(connection, { type: "error", message: "op belongs to another editor", ref: id });
			return null;
		}
		return op;
	}

	#dropPending(id: string): void {
		if (!this.#pending.delete(id)) return;
		this.#broadcast({ type: "op:cancelled", id });
		this.#markDirty();
	}

	/**
	 * 接続が生きていない、あるいは放置されたままの進行中 op を捨てる。
	 * DO の再起動や、close を取りこぼした接続の後始末。
	 */
	#sweepPending(): void {
		const live = new Set<string>();
		for (const connection of this.getConnections()) live.add(connection.id);

		const expiry = Date.now() - LIMITS.PENDING_OP_TTL_MS;
		for (const op of [...this.#pending.values()]) {
			if (!live.has(op.connectionId) || op.updatedAt < expiry) this.#dropPending(op.id);
		}
	}

	#snapshot(): PostState {
		return {
			post: this.#post,
			committedOps: this.#committed,
			pendingOps: [...this.#pending.values()],
		};
	}

	/** 次の flush で state を書き戻す。連続する変更は 1 回に束ねられる。 */
	#markDirty(): void {
		if (this.#flushTimer !== null) return;
		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = null;
			this.setState(this.#snapshot());
		}, FLUSH_INTERVAL_MS);
	}

	#send(connection: Connection<ConnectionState>, message: ServerMessage): void {
		connection.send(encode(message));
	}

	#broadcast(message: ServerMessage, ...exclude: string[]): void {
		this.broadcast(encode(message), exclude);
	}
}
