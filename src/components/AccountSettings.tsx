/**
 * アカウント情報の編集。
 *
 * 項目ごとに独立した form にしてある。まとめて 1 つの form にすると、
 * パスワードだけ直したいときに他の項目まで送ることになり、
 * どれが失敗したのかも出し分けられない。
 */

import { useState } from "react";

import { useTranslations, type Locale, type MessageKey, type Translate } from "../i18n";
import { authClient } from "../lib/auth-client";

type Props = {
	locale: Locale;
	name: string;
	username: string | null;
	email: string;
};

type Result = { ok: true } | { ok: false; message: string };

/**
 * better-auth のエラーは英語で返る。よくあるものだけ辞書に文言を持っていて、
 * 未知のコードは元の文言をそのまま出す（黙って握り潰すより手掛かりが残る）。
 */
const KNOWN_CODES = [
	"INVALID_PASSWORD",
	"PASSWORD_TOO_SHORT",
	"PASSWORD_TOO_LONG",
	"USERNAME_IS_ALREADY_TAKEN",
	"INVALID_USERNAME",
	"USERNAME_TOO_SHORT",
	"USERNAME_TOO_LONG",
	"INVALID_EMAIL",
	"USER_ALREADY_EXISTS",
] as const;

function describe(
	t: Translate,
	error: { code?: string; message?: string } | null,
	fallback: string,
): string {
	if (!error) return fallback;
	const known = KNOWN_CODES.find((code) => code === error.code);
	if (known) return t(`authError.${known}` satisfies MessageKey);
	return error.message || fallback;
}

export default function AccountSettings({ locale, name, username, email }: Props) {
	const t = useTranslations(locale);

	return (
		<>
			<Section
				title={t("account.nameSection")}
				description={t("account.nameDescription")}
				submitLabel={t("account.change")}
				onSubmit={async (form) => {
					const value = String(form.get("name") ?? "").trim();
					if (value === "") return { ok: false, message: t("account.nameRequired") };
					const { error } = await authClient.updateUser({ name: value });
					return error
						? { ok: false, message: describe(t, error, t("account.changeFailed")) }
						: { ok: true };
				}}
			>
				<label>
					{t("account.displayName")}
					<input type="text" name="name" defaultValue={name} maxLength={40} required />
				</label>
			</Section>

			<Section
				title={t("account.usernameSection")}
				description={t("account.usernameDescription")}
				submitLabel={username ? t("account.change") : t("account.set")}
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
						? { ok: false, message: describe(t, error, t("account.usernameRejected")) }
						: { ok: true };
				}}
			>
				<label>
					{t("account.usernameField")}
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
				title={t("account.emailSection")}
				description={t("account.emailDescription")}
				submitLabel={t("account.change")}
				onSubmit={async (form) => {
					const value = String(form.get("email") ?? "").trim();
					if (value === email) return { ok: false, message: t("account.emailUnchanged") };
					const { error } = await authClient.changeEmail({ newEmail: value });
					return error
						? { ok: false, message: describe(t, error, t("account.changeFailed")) }
						: { ok: true };
				}}
			>
				<label>
					{t("account.email")}
					<input type="email" name="email" defaultValue={email} required />
				</label>
				{/*
				  既に誰かが使っているアドレスを指定した場合、better-auth は
				  「そのアドレスは存在する」と教えないために成功を返し、実際には
				  切り替えない。利用者が黙って戸惑わないよう先に断っておく。
				*/}
				<p className="muted">{t("account.emailTakenNote")}</p>
			</Section>

			<Section
				title={t("account.passwordSection")}
				submitLabel={t("account.change")}
				reloadOnSuccess={false}
				successMessage={t("account.passwordChanged")}
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
						? { ok: false, message: describe(t, error, t("authError.INVALID_PASSWORD")) }
						: { ok: true };
				}}
			>
				<label>
					{t("account.currentPassword")}
					<input type="password" name="currentPassword" autoComplete="current-password" required />
				</label>
				<label>
					{t("account.newPassword")}
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
