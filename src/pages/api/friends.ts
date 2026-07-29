import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { removeFriendship, requestFriendship, respondToRequest } from "../../lib/friends";

export const prerender = false;

type Body =
	| { action: "request"; username: string }
	| { action: "accept" | "decline"; userId: string }
	| { action: "remove"; userId: string };

/** フレンドの申請・承認・解除。自分に関する操作しか受け付けない。 */
export const POST: APIRoute = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) return Response.json({ message: "sign in first" }, { status: 401 });

	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return Response.json({ message: "body must be valid json" }, { status: 400 });
	}

	switch (body?.action) {
		case "request": {
			if (typeof body.username !== "string" || body.username.trim() === "") {
				return Response.json({ message: "ユーザー名を入力してください" }, { status: 400 });
			}
			const outcome = await requestFriendship(env.DB, user.id, body.username);
			if (!outcome.ok) return Response.json({ message: outcome.reason }, { status: 400 });
			return Response.json({ status: outcome.status });
		}

		case "accept":
		case "decline": {
			if (typeof body.userId !== "string") {
				return Response.json({ message: "userId is required" }, { status: 400 });
			}
			const changed = await respondToRequest(
				env.DB,
				user.id,
				body.userId,
				body.action === "accept",
			);
			if (!changed) return Response.json({ message: "その申請はありません" }, { status: 404 });
			return Response.json({ ok: true });
		}

		case "remove": {
			if (typeof body.userId !== "string") {
				return Response.json({ message: "userId is required" }, { status: 400 });
			}
			await removeFriendship(env.DB, user.id, body.userId);
			return Response.json({ ok: true });
		}

		default:
			return Response.json({ message: "unknown action" }, { status: 400 });
	}
};
