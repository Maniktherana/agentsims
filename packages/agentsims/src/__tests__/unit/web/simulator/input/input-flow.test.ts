import { describe, expect, test } from "bun:test";
import {
	INPUT_ACK_TIMEOUT_MS,
	InputFlow,
	type InputFlowTimer,
	type InputMessage,
} from "../../../../../web/simulator/input/input-flow";

function harness(limit?: number) {
	const sent: InputMessage[] = [];
	const timers = new Map<number, () => void>();
	let next = 0;
	const timer: InputFlowTimer = {
		set: (callback) => {
			timers.set(++next, callback);
			return next;
		},
		clear: (handle) => timers.delete(handle as number),
	};
	const flow = new InputFlow((message) => sent.push(message), timer, limit);
	const expire = () => {
		const callbacks = [...timers.values()];
		timers.clear();
		for (const callback of callbacks) callback();
	};
	const types = () => sent.map((m) => (m.payload as { type?: string; x?: number }).type ?? m.tag);
	return { flow, sent, expire, types };
}

const touch = (type: string, x = 0) => ({ tag: 0x03, payload: { type, x, y: 0.5 } });

describe("input flow", () => {
	test("an acknowledging server gets one message in flight; a waiting move is replaced", () => {
		const { flow, sent, types } = harness();
		flow.send(touch("begin"));
		flow.acknowledge();
		flow.send(touch("move", 0.1));
		flow.send(touch("move", 0.2));
		flow.send(touch("move", 0.3));
		expect(types()).toEqual(["begin", "move"]);
		flow.acknowledge();
		expect(sent.at(-1)!.payload).toEqual({ type: "move", x: 0.3, y: 0.5 });
		expect(flow.stats.coalesced).toBe(1);
		expect(flow.stats.inFlight).toBe(1);
	});

	test("begin and end are never merged, dropped, or reordered", () => {
		const { flow, types } = harness();
		flow.send(touch("begin"));
		flow.acknowledge();
		flow.send(touch("move", 0.1));
		flow.send(touch("move", 0.2));
		flow.send(touch("end", 0.2));
		flow.send(touch("begin", 0.5));
		flow.send(touch("move", 0.6));
		for (let i = 0; i < 6; i++) flow.acknowledge();
		expect(types()).toEqual(["begin", "move", "move", "end", "begin", "move"]);
	});

	test("an overflowing queue drops moves and keeps gesture boundaries", () => {
		const { flow, types } = harness(3);
		flow.send(touch("begin"));
		flow.acknowledge();
		flow.send(touch("move", 0.1));
		flow.send({ tag: 0x04, payload: { button: "home" } });
		flow.send(touch("move", 0.2));
		flow.send(touch("end", 0.2));
		flow.send(touch("begin", 0.4));
		for (let i = 0; i < 6; i++) flow.acknowledge();
		expect(types()).toEqual(["begin", "move", 0x04, "end", "begin"]);
		expect(flow.stats.dropped).toBe(1);
	});

	test("a server without acknowledgements gets every message at once", () => {
		const { flow, types } = harness();
		flow.send(touch("begin"));
		flow.send(touch("move", 0.1));
		flow.send(touch("end", 0.1));
		expect(types()).toEqual(["begin", "move", "end"]);
	});

	test("a lost acknowledgement releases the slot after the timeout", () => {
		const { flow, types, expire } = harness();
		flow.send(touch("begin"));
		flow.acknowledge();
		flow.send(touch("move"));
		flow.send(touch("end"));
		expect(types()).toEqual(["begin", "move"]);
		expect(INPUT_ACK_TIMEOUT_MS).toBeGreaterThan(0);
		expire();
		expect(types()).toEqual(["begin", "move", "end"]);
	});
});
