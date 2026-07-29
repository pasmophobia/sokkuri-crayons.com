import { describe, expect, it } from "vitest";

import type { CommittedOp, OpPayload, PostState, SubmittedOp } from "./ops";
import { renderableOps } from "./ops";

const payload: OpPayload = {
	kind: "stroke",
	points: [{ x: 0, y: 0 }],
	color: "#000000",
	width: 0.01,
	blend: "normal",
};

function committed(id: string, seq: number, undone = false): CommittedOp {
	return { id, authorId: "u1", payload, seq, committedAt: seq, undone };
}

function pending(id: string, startedAt: number): SubmittedOp {
	return {
		id,
		authorId: "u1",
		payload,
		connectionId: "c1",
		startedAt,
		updatedAt: startedAt,
	};
}

function state(overrides: Partial<PostState> = {}): PostState {
	return { post: null, committedOps: [], pendingOps: [], ...overrides };
}

describe("renderableOps", () => {
	it("確定済みを seq 昇順に並べる", () => {
		const ops = renderableOps(
			state({ committedOps: [committed("c", 3), committed("a", 1), committed("b", 2)] }),
		);
		expect(ops.map((op) => op.id)).toEqual(["a", "b", "c"]);
	});

	it("取り消し済みは描かない", () => {
		const ops = renderableOps(
			state({ committedOps: [committed("a", 1), committed("b", 2, true), committed("c", 3)] }),
		);
		expect(ops.map((op) => op.id)).toEqual(["a", "c"]);
	});

	it("編集中の op は確定済みより後ろに、開始順で乗せる", () => {
		const ops = renderableOps(
			state({
				committedOps: [committed("c2", 2), committed("c1", 1)],
				pendingOps: [pending("p2", 200), pending("p1", 100)],
			}),
		);
		expect(ops.map((op) => op.id)).toEqual(["c1", "c2", "p1", "p2"]);
	});

	it("入力の配列を破壊しない", () => {
		const pendingOps = [pending("p2", 200), pending("p1", 100)];
		const committedOps = [committed("c2", 2), committed("c1", 1)];
		renderableOps(state({ committedOps, pendingOps }));
		expect(pendingOps.map((op) => op.id)).toEqual(["p2", "p1"]);
		expect(committedOps.map((op) => op.id)).toEqual(["c2", "c1"]);
	});

	it("op が無ければ空", () => {
		expect(renderableOps(state())).toEqual([]);
	});
});
