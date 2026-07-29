/**
 * アカウント情報の編集。
 *
 * 項目ごとに独立した form にしてある。まとめて 1 つの form にすると、
 * パスワードだけ直したいときに他の項目まで送ることになり、
 * どれが失敗したのかも出し分けられない。
 */

import { useState } from "react";

import { authClient } from "../lib/auth-client";

type Props = {
	name: string;
	username: string | null;
	email: string;
};

type Result = { ok: true } | { ok: false; message: string };

/**
 * better-auth のエラーは英語で返るので、よくあるものだけ日本語にする。
 * 未知のコードは元の文言をそのまま出す（黙って握り潰すより手掛かりが残る）。
 */
const MESSAGES: Record<string, string> = {
	INVALID_PASSWORD: "現在のパスワードが違います",
	PASSWORD_TOO_SHORT: "パスワードが短すぎます",
	PASSWORD_TOO_LONG: "パスワードが長すぎます",
	USERNAME_IS_ALREADY_TAKEN: "そのユーザー名はすでに使われています",
	INVALID_USERNAME: "ユーザー名に使えない文字が含まれています",
	USERNAME_TOO_SHORT: "ユーザー名が短すぎます",
	USERNAME_TOO_LONG: "ユーザー名が長すぎます",
	INVALID_EMAIL: "メールアドレスの形式が正しくありません",
	USER_ALREADY_EXISTS: "そのメールアドレスは使えません",
};

function describe(error: { code?: string; message?: string } | null, fallback: string): string {
	if (!error) return fallback;
	return (error.code && MESSAGES[error.code]) || error.message || fallback;
}

export default function AccountSettings({ name, username, email }: Props) {
	return (
		<>
			<Section
				title="表示名"
				description="投稿やフレンド一覧に出る名前です。重複してもかまいません。"
				submitLabel="変更する"
				onSubmit={async (form) => {
					const value = String(form.get("name") ?? "").trim();
					if (value === "") return { ok: false, message: "表示名を入力してください" };
					const { error } = await authClient.updateUser({ name: value });
					return error ? { ok: false, message: describe(error, "変更できませんでした") } : { ok: true };
				}}
			>
				<label>
					表示名
					<input type="text" name="name" defaultValue={name} maxLength={40} required />
				</label>
			</Section>

			<Section
				title="ユーザー名"
				description="フレンドを探してもらうときに相手へ伝える名前です。"
				submitLabel={username ? "変更する" : "設定する"}
				onSubmit={async (form) => {
					// 他所から `@name` の形で貼られても通るようにする。
					const value = String(form.get("username") ?? "")
						.trim()
						.replace(/^@+/, "");
					const { error } = await authClient.updateUser({
						username: value,
						// username だけだと正規化後の小文字しか残らず、入力どおりの大小が失われる。
						displayUsername: value,
					});
					return error
						? { ok: false, message: describe(error, "そのユーザー名は使えません") }
						: { ok: true };
				}}
			>
				<label>
					ユーザー名（英数字と _、3〜20 文字）
					<input
						type="text"
						name="username"
						defaultValue={username ?? ""}
						minLength={3}
						maxLength={20}
						pattern="@?[A-Za-z0-9_]+"
						required
					/>
				</label>
			</Section>

			<Section
				title="メールアドレス"
				description="ログインに使うアドレスです。確認メールは送られず、その場で切り替わります。"
				submitLabel="変更する"
				onSubmit={async (form) => {
					const value = String(form.get("email") ?? "").trim();
					if (value === email) return { ok: false, message: "現在のアドレスと同じです" };
					const { error } = await authClient.changeEmail({ newEmail: value });
					return error
						? { ok: false, message: describe(error, "変更できませんでした") }
						: { ok: true };
				}}
			>
				<label>
					メールアドレス
					<input type="email" name="email" defaultValue={email} required />
				</label>
				{/*
				  既に誰かが使っているアドレスを指定した場合、better-auth は
				  「そのアドレスは存在する」と教えないために成功を返し、実際には
				  切り替えない。利用者が黙って戸惑わないよう先に断っておく。
				*/}
				<p className="muted">
					すでに他の人が使っているアドレスは、そのままでは切り替わりません。
					変更後に表示が変わっていなければ、そのアドレスは使えません。
				</p>
			</Section>

			<Section
				title="パスワード"
				submitLabel="変更する"
				reloadOnSuccess={false}
				successMessage="パスワードを変更しました。他の端末のログインは解除されています。"
				onSubmit={async (form) => {
					const currentPassword = String(form.get("currentPassword") ?? "");
					const newPassword = String(form.get("newPassword") ?? "");
					const { error } = await authClient.changePassword({
						currentPassword,
						newPassword,
						// 乗っ取られていた場合に備えて、他の端末は切っておく。
						revokeOtherSessions: true,
					});
					return error
						? { ok: false, message: describe(error, "現在のパスワードが違います") }
						: { ok: true };
				}}
			>
				<label>
					現在のパスワード
					<input
						type="password"
						name="currentPassword"
						autoComplete="current-password"
						required
					/>
				</label>
				<label>
					新しいパスワード（8 文字以上）
					<input
						type="password"
						name="newPassword"
						autoComplete="new-password"
						minLength={8}
						required
					/>
				</label>
			</Section>
		</>
	);
}

function Section({
	title,
	description,
	submitLabel,
	successMessage,
	reloadOnSuccess = true,
	onSubmit,
	children,
}: {
	title: string;
	description?: string;
	submitLabel: string;
	successMessage?: string;
	reloadOnSuccess?: boolean;
	onSubmit: (form: FormData) => Promise<Result>;
	children: React.ReactNode;
}) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [done, setDone] = useState(false);

	return (
		<section>
			<h2>{title}</h2>
			{description && <p className="muted">{description}</p>}
			<form
				className="form"
				onSubmit={async (event) => {
					event.preventDefault();
					// currentTarget は await をまたぐと null になるので、先に掴んでおく。
					const element = event.currentTarget;
					const form = new FormData(element);
					setPending(true);
					setError("");
					setDone(false);

					const result = await onSubmit(form);
					if (!result.ok) {
						setError(result.message);
						setPending(false);
						return;
					}
					// 反映後の値を出すのが一番正直なので、基本は読み直す。
					if (reloadOnSuccess) {
						location.reload();
						return;
					}
					element.reset();
					setDone(true);
					setPending(false);
				}}
			>
				{children}
				<p className="error">{error}</p>
				{done && successMessage && <p className="muted">{successMessage}</p>}
				<button className="primary" type="submit" disabled={pending}>
					{submitLabel}
				</button>
			</form>
		</section>
	);
}
