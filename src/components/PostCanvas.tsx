/**
 * 投稿ページのキャンバス島。
 *
 * op の状態そのものは React が持たない。1 ストロークで何十回も点が増えるので、
 * それを state に載せると点ごとに再描画が走ってしまう。高頻度な部分は
 * `PostEditor`（命令的なエンジン）に閉じ込め、React が持つのは UI が実際に
 * 出し分けに使う粗い状態 —— 接続状況・エラー・道具の設定 —— だけにしている。
 */

import { useEffect, useRef, useState } from "react";

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

type Status = "connecting" | "open" | "closed";

const STATUS_LABEL: Record<Status, string> = {
	connecting: "接続中…",
	open: "ライブ",
	closed: "切断",
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
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const editorRef = useRef<PostEditor | null>(null);

	const [status, setStatus] = useState<Status>("connecting");
	const [error, setError] = useState("");
	const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		// setState 系は識別子が安定しているので、そのままハンドラに渡してよい。
		const editor = new PostEditor(canvas, {
			onStatus: setStatus,
			onError: setError,
		});
		editorRef.current = editor;

		editor
			.loadImage(imageUrl, aspectRatio)
			.catch(() => setError("画像を読み込めませんでした。"));
		editor.connect(postId, thumbnailUpdatedAt);

		return () => {
			editor.disconnect();
			editorRef.current = null;
		};
	}, [postId, imageUrl, aspectRatio, thumbnailUpdatedAt]);

	// 設定は React 側が正。変わるたびにエンジンへ流し込む。
	useEffect(() => {
		if (editorRef.current) editorRef.current.settings = settings;
	}, [settings]);

	const update = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) =>
		setSettings((current) => ({ ...current, [key]: value }));

	return (
		<>
			<p className="muted status-line">
				<span>{STATUS_LABEL[status]}</span>
			</p>

			<div className="stage card">
				<canvas ref={canvasRef} />
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
