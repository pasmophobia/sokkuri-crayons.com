/**
 * メール送信。Cloudflare Email Service の `send_email` バインディングを使う。
 *
 * ローカル開発では miniflare がこのバインディングを模擬し、送ったメールを
 * `.wrangler/tmp/email/` に .txt / .html として書き出す。実際には配送されないので、
 * 確認リンクやパスワード再設定リンクはそのファイルから拾える。
 *
 * 実際に配送するには Workers Paid と、Cloudflare DNS 上のドメインを Email Service
 * に登録することが要る。
 *
 * 送信の失敗で呼び出し元（サインアップなど）を巻き込まない。アカウントは作られた
 * のにエラーだけ見える、という状態が一番たちが悪いため。
 */

export type Mail = {
	to: string;
	subject: string;
	html: string;
	text: string;
};

export async function sendMail(env: Env, mail: Mail): Promise<void> {
	const binding = env.EMAIL;

	if (!binding) {
		console.warn(
			`[mail] EMAIL binding is not configured; not sending to ${mail.to}\n` +
				`[mail] subject: ${mail.subject}\n` +
				`[mail] ${mail.text}`,
		);
		return;
	}

	try {
		await binding.send({
			to: mail.to,
			// Email Service に載せたドメインのアドレスでなければ送れない。
			from: env.MAIL_FROM,
			subject: mail.subject,
			html: mail.html,
			text: mail.text,
		});
	} catch (error) {
		// 送信できなかったことをそのまま利用者への 500 にしない。better-auth の
		// 呼び出し元（サインアップなど）を巻き込むと、アカウントは作られたのに
		// エラーだけ見える状態になる。
		console.error(`[mail] failed to send to ${mail.to}`, error);
	}
}

/** 本文の体裁。文面が増えても崩れないよう 1 か所にまとめておく。 */
export function template(options: {
	/** 本文の言語。読み上げと折り返しのために `<html lang>` に載せる。 */
	lang: string;
	heading: string;
	body: string;
	actionLabel: string;
	url: string;
	note: string;
}): { html: string; text: string } {
	const { lang, heading, body, actionLabel, url, note } = options;

	return {
		text: `${heading}\n\n${body}\n\n${actionLabel}: ${url}\n\n${note}`,
		html: `<!doctype html>
<html lang="${lang}"><body style="font-family:sans-serif;line-height:1.7;color:#16161d">
<h1 style="font-size:1.2rem">${heading}</h1>
<p>${body}</p>
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#ff0066;color:#fff;border-radius:8px;text-decoration:none">${actionLabel}</a></p>
<p style="font-size:.85rem;color:#666">${note}</p>
<p style="font-size:.8rem;color:#999;word-break:break-all">${url}</p>
</body></html>`,
	};
}
