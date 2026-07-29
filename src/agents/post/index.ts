/**
 * `Post` Agent — 画像投稿 1 件につき 1 インスタンス。
 *
 * 誰でも WebSocket で繋いで、他人の投稿にディスプレイスメントマップや
 * 落書きを重ねられる。編集は 2 段階で持つ:
 *
 *   pendingOps   … いま描いている最中。全員にライブ配信される。
 *   committedOps … 確定した履歴。`seq` の順が描画順。
 *
 * 状態の書き戻し (`setState`) は状態まるごとのブロードキャストを伴うので、
 * 点が 1 つ増えるたびに呼ぶと帯域が持たない。そこで
 *   - 低レイテンシのライブ表示は `op:*` の差分ブロードキャストで担い、
 *   - `setState` は #markDirty() で FLUSH_INTERVAL_MS ごとに束ねる
 * という二本立てにしている。差分が落ちても、次の flush で届く state が
 * 常に正になる。
 */

import { Agent, type Connection, type ConnectionContext, type WSMessage } from "agents";

import type { CommittedOp, PostMeta, PostState, SubmittedOp } from "./ops";
import {
	LIMITS,
	encode,
	parseClientMessage,
	sanitizeId,
	type ClientMessage,
	type ServerMessage,
} from "./protocol";

export * from "./ops";
export * from "./protocol";

/** state の書き戻しを束ねる間隔。 */
const FLUSH_INTERVAL_MS = 200;

type ConnectionState = { userId: string };

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
		// DO が起きるたびに呼ばれる。永続化された state からメモリ上の像を復元する。
		const state = this.state;
		this.#post = state.post;
		this.#committed = [...state.committedOps];
		this.#committedIds = new Set(this.#committed.map((op) => op.id));
		this.#seq = this.#committed.reduce((max, op) => Math.max(max, op.seq), 0);
		this.#pending = new Map(state.pendingOps.map((op) => [op.id, op]));
		this.#sweepPending();
	}

	override onConnect(connection: Connection<ConnectionState>, ctx: ConnectionContext): void {
		// TODO: 本来はセッションから引く。いまは自己申告 + 接続 ID のフォールバック。
		const claimed = new URL(ctx.request.url).searchParams.get("userId");
		const userId =
			sanitizeId(claimed, LIMITS.MAX_AUTHOR_ID_LENGTH) ?? `anon-${connection.id.slice(0, 8)}`;
		connection.setState({ userId });

		// 前の接続が残していった編集中の op を掃除してから、現状を渡す。
		this.#sweepPending();
		this.#send(connection, { type: "hello", you: userId, state: this.#snapshot() });
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

	// --- メッセージ処理 ---

	#dispatch(connection: Connection<ConnectionState>, message: ClientMessage): void {
		const authorId = this.#authorOf(connection);

		switch (message.type) {
			case "post:create": {
				if (this.#post !== null) {
					this.#send(connection, { type: "error", message: "post already exists" });
					return;
				}
				const post: PostMeta = {
					imageUrl: message.imageUrl,
					aspectRatio: message.aspectRatio,
					caption: message.caption,
					authorId,
					createdAt: Date.now(),
				};
				this.#post = post;
				this.#broadcast({ type: "post:created", post });
				this.#markDirty();
				return;
			}

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
				// TODO: 投稿者によるモデレーション（他人の op の削除）は別途。
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
				this.#broadcast({ type: "op:undone", id: target.id });
				this.#markDirty();
				return;
			}
		}
	}

	// --- ヘルパ ---

	#authorOf(connection: Connection<ConnectionState>): string {
		return connection.state?.userId ?? `anon-${connection.id.slice(0, 8)}`;
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
