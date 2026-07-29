/**
 * 投稿ページのキャンバス島。
 *
 * 接続は `useAgent` (agents/react) が持つ。再接続・state 同期・URL 組み立てを
 * 任せられるので、自前の WebSocket と接続用の useEffect が要らなくなる。
 *
 * op の状態そのものは React が持たない。1 ストロークで何十回も点が増えるので、
 * それを state に載せると点ごとに再描画が走ってしまう。高頻度な部分は
 * `PostEditor`（命令的なエンジン）に閉じ込め、React が持つのは UI が実際に
 * 出し分けに使う粗い状態 —— 接続状況・エラー・道具の設定 —— だけにしている。
 */

import { useAgent } from "agents/react";
import { useCallback, useRef, useState } from "react";

import type { PostState } from "../agents/post/ops";
import { LIMITS } from "../agents/post/protocol";
import { DEFAULT_SETTINGS, PostEditor, type EditorSettings } from "../lib/editor";

type Props = {
	postId: string;
	imageUrl: string;
	aspectRatio: number;
	thumbnailUpdatedAt: number | null;
	/** 未ログインなら閲覧のみ。道具は出さない。 */
	canEdit: boolean;
};

const TOOLS: { value: EditorSettings["tool"]; label: string }[] = [
	{ value: "stroke", label: "落書き" },
	{ value: "displace", label: "歪み" },
	{ value: "text", label: "文字" },
];

const DISPLACE_MODES: { value: EditorSettings["displaceMode"]; label: string }[] = [
	{ value: "smudge", label: "なすりつけ" },
	{ value: "bulge", label: "膨らみ" },
	{ value: "pinch", label: "へこみ" },
	{ value: "swirl", label: "渦" },
];

const BLEND_MODES: { value: EditorSettings["blend"]; label: string }[] = [
	{ value: "normal", label: "通常" },
	{ value: "multiply", label: "乗算" },
	{ value: "screen", label: "スクリーン" },
	{ value: "overlay", label: "オーバーレイ" },
];

export default function PostCanvas({
	postId,
	imageUrl,
	aspectRatio,
	thumbnailUpdatedAt,
	canEdit,
}: Props) {
	const editorRef = useRef<PostEditor | null>(null);

	const [connected, setConnected] = useState(false);
	const [error, setError] = useState("");
	const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);

	// 設定は React が正。エンジンは点を置くたびに読みに来るので、
	// effect で流し込むのではなく ref 越しに最新を見せる。
	const settingsRef = useRef(settings);
	settingsRef.current = settings;

	const agent = useAgent<PostState>({
		agent: "post",
		name: postId,
		onOpen: () => {
			setConnected(true);
			setError("");
		},
		onClose: () => {
			setConnected(false);
			editorRef.current?.suspend();
		},
		onMessage: (event) => editorRef.current?.receive(event.data),
		onStateUpdate: (state) => editorRef.current?.sync(state),
	});

	// ref コールバックの中で組み立てて、その場で後始末も返す（React 19）。
	// canvas 要素が要るだけの処理に useEffect を挟む必要はない。
	const agentRef = useRef(agent);
	agentRef.current = agent;

	const mountCanvas = useCallback(
		(canvas: HTMLCanvasElement | null) => {
			if (!canvas) return;

			const editor = new PostEditor(canvas, {
				postId,
				thumbnailUpdatedAt,
				getSettings: () => settingsRef.current,
				send: (message) => agentRef.current.send(JSON.stringify(message)),
				onError: setError,
			});
			editorRef.current = editor;

			editor.loadImage(imageUrl, aspectRatio).catch(() => {
				setError("画像を読み込めませんでした。");
			});

			return () => {
				editor.dispose();
				editorRef.current = null;
			};
		},
		[postId, imageUrl, aspectRatio, thumbnailUpdatedAt],
	);

	const update = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) =>
		setSettings((current) => ({ ...current, [key]: value }));

	return (
		<>
			<p className="muted status-line">{connected ? "ライブ" : "接続中…"}</p>

			<div className="stage card">
				<canvas ref={mountCanvas} />
			</div>

			{canEdit ? (
				<div className="toolbar card">
					<label>
						道具
						<select
							value={settings.tool}
							onChange={(event) =>
								update("tool", event.target.value as EditorSettings["tool"])
							}
						>
							{TOOLS.map((tool) => (
								<option key={tool.value} value={tool.value}>
									{tool.label}
								</option>
							))}
						</select>
					</label>

					{settings.tool === "displace" && (
						<>
							<label>
								歪み方
								<select
									value={settings.displaceMode}
									onChange={(event) =>
										update("displaceMode", event.target.value as EditorSettings["displaceMode"])
									}
								>
									{DISPLACE_MODES.map((mode) => (
										<option key={mode.value} value={mode.value}>
											{mode.label}
										</option>
									))}
								</select>
							</label>
							<label>
								強さ
								<input
									type="range"
									min={-1}
									max={1}
									step={0.05}
									value={settings.strength}
									onChange={(event) => update("strength", Number(event.target.value))}
								/>
							</label>
						</>
					)}

					{settings.tool !== "displace" && (
						<label>
							色
							<input
								type="color"
								value={settings.color}
								onChange={(event) => update("color", event.target.value)}
							/>
						</label>
					)}

					{settings.tool === "stroke" && (
						<label>
							合成
							<select
								value={settings.blend}
								onChange={(event) =>
									update("blend", event.target.value as EditorSettings["blend"])
								}
							>
								{BLEND_MODES.map((blend) => (
									<option key={blend.value} value={blend.value}>
										{blend.label}
									</option>
								))}
							</select>
						</label>
					)}

					{settings.tool === "text" && (
						<label>
							文字
							<input
								type="text"
								maxLength={LIMITS.MAX_TEXT_LENGTH}
								placeholder="置きたい文字"
								value={settings.text}
								onChange={(event) => update("text", event.target.value)}
							/>
						</label>
					)}

					<label>
						{settings.tool === "displace" ? "半径" : "太さ"}
						<input
							type="range"
							min={0.002}
							max={0.06}
							step={0.002}
							value={settings.size}
							onChange={(event) => update("size", Number(event.target.value))}
						/>
					</label>

					<button type="button" onClick={() => editorRef.current?.undo()}>
						取り消す
					</button>
				</div>
			) : (
				<p className="muted">
					<a href="/signin">ログイン</a>すると、この画像に落書きや歪みを加えられます。
				</p>
			)}

			<p className="error">{error}</p>
		</>
	);
}
