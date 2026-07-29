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
import { LIMITS, type ServerErrorCode } from "../agents/post/protocol";
import {
	localePath,
	splitAroundLink,
	useTranslations,
	type Locale,
	type MessageKey,
	type Translate,
} from "../i18n";
import { DEFAULT_SETTINGS, PostEditor, type EditorSettings } from "../lib/editor";

type Props = {
	locale: Locale;
	postId: string;
	imageUrl: string;
	aspectRatio: number;
	/** 未ログインなら閲覧のみ。道具は出さない。 */
	canEdit: boolean;
};

/** 利用者に見せるサーバエラーの対応表。ここに無いものは英語のまま出る。 */
const SERVER_ERRORS: Record<ServerErrorCode, MessageKey> = {
	post_not_public: "canvas.errorPostNotPublic",
};

const TOOLS: { value: EditorSettings["tool"]; label: MessageKey }[] = [
	{ value: "stroke", label: "canvas.toolStroke" },
	{ value: "displace", label: "canvas.toolDisplace" },
	{ value: "text", label: "canvas.toolText" },
];

const DISPLACE_MODES: { value: EditorSettings["displaceMode"]; label: MessageKey }[] = [
	{ value: "smudge", label: "canvas.displaceSmudge" },
	{ value: "bulge", label: "canvas.displaceBulge" },
	{ value: "pinch", label: "canvas.displacePinch" },
	{ value: "swirl", label: "canvas.displaceSwirl" },
];

const BLEND_MODES: { value: EditorSettings["blend"]; label: MessageKey }[] = [
	{ value: "normal", label: "canvas.blendNormal" },
	{ value: "multiply", label: "canvas.blendMultiply" },
	{ value: "screen", label: "canvas.blendScreen" },
	{ value: "overlay", label: "canvas.blendOverlay" },
];

export default function PostCanvas({ locale, postId, imageUrl, aspectRatio, canEdit }: Props) {
	const editorRef = useRef<PostEditor | null>(null);

	const [connected, setConnected] = useState(false);
	const [error, setError] = useState("");
	const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);

	const t = useTranslations(locale);
	const [signInBefore, signInAfter] = splitAroundLink(t("canvas.signInToEdit"));

	// t は毎回作り直されるので、ref 越しに最新を見せる（下の ref コールバックは
	// imageUrl が変わらないかぎり作り直さない）。
	const translateRef = useRef<Translate>(t);
	translateRef.current = t;

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
				getSettings: () => settingsRef.current,
				send: (message) => agentRef.current.send(JSON.stringify(message)),
				// サーバの文言は開発者向けの英語。code が付いているものだけ引き直す。
				onError: (message, code) =>
					setError(code ? translateRef.current(SERVER_ERRORS[code]) : message),
			});
			editorRef.current = editor;

			editor.loadImage(imageUrl, aspectRatio).catch(() => {
				setError(translateRef.current("canvas.imageLoadFailed"));
			});

			return () => {
				editor.dispose();
				editorRef.current = null;
			};
		},
		[imageUrl, aspectRatio],
	);

	const update = <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) =>
		setSettings((current) => ({ ...current, [key]: value }));

	return (
		<>
			<p className="muted status-line">{connected ? t("canvas.live") : t("canvas.connecting")}</p>

			<div className="stage card">
				<canvas ref={mountCanvas} />
			</div>

			{canEdit ? (
				<div className="toolbar card">
					<label>
						{t("canvas.tool")}
						<select
							value={settings.tool}
							onChange={(event) => update("tool", event.target.value as EditorSettings["tool"])}
						>
							{TOOLS.map((tool) => (
								<option key={tool.value} value={tool.value}>
									{t(tool.label)}
								</option>
							))}
						</select>
					</label>

					{settings.tool === "displace" && (
						<>
							<label>
								{t("canvas.displaceMode")}
								<select
									value={settings.displaceMode}
									onChange={(event) =>
										update("displaceMode", event.target.value as EditorSettings["displaceMode"])
									}
								>
									{DISPLACE_MODES.map((mode) => (
										<option key={mode.value} value={mode.value}>
											{t(mode.label)}
										</option>
									))}
								</select>
							</label>
							<label>
								{t("canvas.strength")}
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
							{t("canvas.color")}
							<input
								type="color"
								value={settings.color}
								onChange={(event) => update("color", event.target.value)}
							/>
						</label>
					)}

					{settings.tool === "stroke" && (
						<label>
							{t("canvas.blend")}
							<select
								value={settings.blend}
								onChange={(event) => update("blend", event.target.value as EditorSettings["blend"])}
							>
								{BLEND_MODES.map((blend) => (
									<option key={blend.value} value={blend.value}>
										{t(blend.label)}
									</option>
								))}
							</select>
						</label>
					)}

					{settings.tool === "text" && (
						<label>
							{t("canvas.text")}
							<input
								type="text"
								maxLength={LIMITS.MAX_TEXT_LENGTH}
								placeholder={t("canvas.textPlaceholder")}
								value={settings.text}
								onChange={(event) => update("text", event.target.value)}
							/>
						</label>
					)}

					<label>
						{settings.tool === "displace" ? t("canvas.radius") : t("canvas.thickness")}
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
						{t("canvas.undo")}
					</button>
				</div>
			) : (
				<p className="muted">
					{signInBefore}
					<a href={localePath(locale, "/signin")}>{t("nav.signIn")}</a>
					{signInAfter}
				</p>
			)}

			<p className="error">{error}</p>
		</>
	);
}
