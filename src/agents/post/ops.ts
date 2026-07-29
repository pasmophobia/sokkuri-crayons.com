/**
 * 投稿 (Post) に対して加えられる編集操作 (op) の定義。
 *
 * 座標はすべて「正規化座標」で持つ。元画像の左上が (0, 0)、右下が (1, 1)。
 * こうしておくと、表示解像度やデバイスに依存せずに op を共有・再生できる。
 */

/** 正規化座標上の 1 点。 */
export type Point = {
	x: number;
	y: number;
	/** 筆圧 0..1。非対応デバイスでは省略される。 */
	p?: number;
};

export type BlendMode = "normal" | "multiply" | "screen" | "overlay";

/** 落書き（ブラシストローク）。 */
export type StrokeOp = {
	kind: "stroke";
	points: Point[];
	/** `#rgb` / `#rrggbb` / `#rrggbbaa` */
	color: string;
	/** 線幅。元画像の短辺に対する比率。 */
	width: number;
	blend: BlendMode;
};

export type DisplaceMode = "smudge" | "bulge" | "pinch" | "swirl";

/** ディスプレイスメントマップ（画素の歪み）。 */
export type DisplaceOp = {
	kind: "displace";
	/** 歪ませた軌跡。`bulge` などの点効果でも配列で持ち、連打を 1 op にまとめられる。 */
	points: Point[];
	/** 効果半径。元画像の短辺に対する比率。 */
	radius: number;
	/** 強度 -1..1。負値で逆向きに効く。 */
	strength: number;
	mode: DisplaceMode;
};

/** 書き込みテキスト。 */
export type TextOp = {
	kind: "text";
	at: Point;
	body: string;
	/** 文字サイズ。元画像の短辺に対する比率。 */
	size: number;
	color: string;
	/** 回転（ラジアン）。 */
	rotation: number;
};

export type OpPayload = StrokeOp | DisplaceOp | TextOp;
export type OpKind = OpPayload["kind"];

type OpBase = {
	/** クライアント生成の ID。1 つの投稿の中で一意。 */
	id: string;
	/** サーバが接続情報から決める。クライアントの自己申告は信用しない。 */
	authorId: string;
	payload: OpPayload;
};

/**
 * 提出済み・未確定の op。いわゆる「いま描いている最中」のもの。
 * 全クライアントに配信され、ライブプレビューとして描画される。
 */
export type SubmittedOp = OpBase & {
	/** 送信元コネクション。切断時に取りこぼしを掃除するために持つ。 */
	connectionId: string;
	/** `op:begin` を受け取った時刻 (epoch ms)。 */
	startedAt: number;
	/** 最後に `op:extend` で伸びた時刻 (epoch ms)。 */
	updatedAt: number;
};

/** 確定済みの op。`seq` の昇順がそのまま描画順になる。 */
export type CommittedOp = OpBase & {
	/** 1 始まりの確定順。 */
	seq: number;
	committedAt: number;
	/**
	 * 取り消し済みフラグ。誰が何をしたかを追えるように、
	 * 配列からは消さずに論理削除する。描画時はスキップする。
	 */
	undone?: boolean;
};

/** 投稿の公開範囲。`friends` は投稿者と、その成立済みフレンドだけ。 */
export type Visibility = "public" | "friends";

/** 投稿そのもののメタ情報。元画像は R2 にアップロード済みである前提。 */
export type PostMeta = {
	/** R2 のオブジェクトキー。`/api/media/<key>` から配る。 */
	imageKey: string;
	/** 元画像の width / height。正規化座標を実座標に戻すのに要る。 */
	aspectRatio: number;
	caption: string;
	authorId: string;
	createdAt: number;
	visibility: Visibility;
};

/** `Post` Agent が保持する状態。 */
export type PostState = {
	post: PostMeta | null;
	committedOps: CommittedOp[];
	pendingOps: SubmittedOp[];
};

/** 描画に使うべき op だけを、描画順で返す。 */
export function renderableOps(state: PostState): (CommittedOp | SubmittedOp)[] {
	const committed = state.committedOps.filter((op) => !op.undone).sort((a, b) => a.seq - b.seq);
	const pending = [...state.pendingOps].sort((a, b) => a.startedAt - b.startedAt);
	// 編集中のものは常に確定済みの上に乗せる。
	return [...committed, ...pending];
}
