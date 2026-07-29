/**
 * フレンドの申請・承認・解除。
 *
 * 相手はユーザー名で探す。表示名は一意でないので手掛かりにできない。
 */

import { useState } from "react";

import type { Friend, FriendRequest } from "../lib/friends";
import { mediaUrl } from "../lib/media";

type Props = {
	/** 自分のユーザー名。相手に伝えるために出す。未設定なら null。 */
	myUsername: string | null;
	friends: Friend[];
	incoming: FriendRequest[];
	outgoing: FriendRequest[];
};

type Action =
	| { action: "request"; username: string }
	| { action: "accept" | "decline" | "remove"; userId: string };

export default function FriendManager({ myUsername, friends, incoming, outgoing }: Props) {
	const [copied, setCopied] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	async function send(body: Action) {
		setPending(true);
		setError("");
		setNotice("");

		const response = await fetch("/api/friends", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const failure = (await response.json().catch(() => null)) as { message?: string } | null;
			setError(failure?.message ?? "処理できませんでした");
			setPending(false);
			return;
		}

		const result = (await response.json()) as { status?: string };
		if (result.status === "pending") {
			// 反映するものが無いので、その場で伝えて終わる。
			setNotice("申請を送りました。相手の承認待ちです。");
			setPending(false);
			return;
		}
		location.reload();
	}

	return (
		<div className="friends">
			<section>
				<h2>あなたのユーザー名</h2>
				{myUsername ? (
					<div className="my-username">
						<code>@{myUsername}</code>
						<button
							type="button"
							onClick={async () => {
								// 表示は @ 付きでも、コピーするのは入力欄にそのまま貼れる素の形。
								await navigator.clipboard.writeText(myUsername);
								setCopied(true);
								setTimeout(() => setCopied(false), 2000);
							}}
						>
							{copied ? "コピーしました" : "コピー"}
						</button>
					</div>
				) : (
					<p className="muted">
						まだ設定されていません。<a href="/settings">アカウント</a>で決めると、
						相手から探してもらえるようになります。
					</p>
				)}
				<p className="muted">これを相手に伝えると、フレンド申請してもらえます。</p>
			</section>

			<section>
				<h2>フレンドを追加</h2>
				<form
					className="form"
					onSubmit={(event) => {
						event.preventDefault();
						const username = String(new FormData(event.currentTarget).get("username") ?? "");
						void send({ action: "request", username });
					}}
				>
					<label>
						相手のユーザー名
						<input type="text" name="username" placeholder="artist_123" required />
					</label>
					<button className="primary" type="submit" disabled={pending}>
						申請する
					</button>
				</form>
				<p className="error">{error}</p>
				{notice && <p className="muted">{notice}</p>}
			</section>

			{incoming.length > 0 && (
				<section>
					<h2>届いている申請</h2>
					<ul className="people">
						{incoming.map((person) => (
							<li key={person.id}>
								<span className="who">
									<Avatar person={person} />
									<strong>{person.name}</strong>{" "}
									<span className="muted">
										{person.displayUsername ? `@${person.displayUsername}` : ""}
									</span>
								</span>
								<span className="actions">
									<button
										className="primary"
										type="button"
										disabled={pending}
										onClick={() => void send({ action: "accept", userId: person.id })}
									>
										承認
									</button>
									<button
										type="button"
										disabled={pending}
										onClick={() => void send({ action: "decline", userId: person.id })}
									>
										拒否
									</button>
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{outgoing.length > 0 && (
				<section>
					<h2>承認待ち</h2>
					<ul className="people">
						{outgoing.map((person) => (
							<li key={person.id}>
								<span className="who">
									<Avatar person={person} />
									<strong>{person.name}</strong>{" "}
									<span className="muted">
										{person.displayUsername ? `@${person.displayUsername}` : ""}
									</span>
								</span>
								<button
									type="button"
									disabled={pending}
									onClick={() => void send({ action: "remove", userId: person.id })}
								>
									取り消す
								</button>
							</li>
						))}
					</ul>
				</section>
			)}

			<section>
				<h2>フレンド（{friends.length}）</h2>
				{friends.length === 0 ? (
					<p className="muted">まだフレンドがいません。</p>
				) : (
					<ul className="people">
						{friends.map((person) => (
							<li key={person.id}>
								<span className="who">
									<Avatar person={person} />
									<strong>{person.name}</strong>{" "}
									<span className="muted">
										{person.displayUsername ? `@${person.displayUsername}` : ""}
									</span>
								</span>
								<button
									type="button"
									disabled={pending}
									onClick={() => void send({ action: "remove", userId: person.id })}
								>
									解除
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

function Avatar({ person }: { person: Friend }) {
	return person.image ? (
		<img className="avatar" src={mediaUrl(person.image)} alt="" />
	) : (
		<span className="avatar avatar-blank">{person.name.slice(0, 1)}</span>
	);
}
