import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { encode as encodePng } from "fast-png";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
	Contexts,
	ContextsLive,
} from "../../../../../core/tools/context/context";
import {
	ContextError,
	CONTEXT_LIMITS,
} from "../../../../../core/tools/context/contracts";
import type {
	ContextInput,
	ContextItem,
} from "../../../../../core/tools/context/contracts";
import { createContextStore } from "../../../../../core/tools/context/store";
import { LogStore } from "../../../../../core/tools/logs/store";

const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZkAAAAASUVORK5CYII=";

function fixture(
	device = "ios-a",
	platform: "ios" | "android" = "ios",
): ContextInput {
	return {
		kind: "annotation",
		device,
		platform,
		sessionId: `${device}:session`,
		capturedAt: 123,
		note: "Move this button.",
		logs: [],
		target: {
			kind: "element",
			revision: 7,
			collectedAt: 120,
			app: "com.example.app",
			orientation: "portrait",
			rect: { x: 0, y: 0, width: 1, height: 1 },
			element: {
				id: "pay",
				path: "/0",
				label: "Pay",
				value: "",
				role: "button",
				type: "Button",
				enabled: true,
				frame: { x: 10, y: 20, width: 30, height: 40 },
			},
		},
		image: { mimeType: "image/png", width: 1, height: 1, base64: png },
	};
}

function error(run: () => unknown, code: ContextError["code"]): void {
	try {
		run();
		throw new Error("Expected a context error");
	} catch (value) {
		expect(value).toBeInstanceOf(ContextError);
		expect((value as ContextError).code).toBe(code);
	}
}

test("draft capture detaches image, element, logs, and source from live state", () => {
	const store = createContextStore();
	const input = fixture();
	if (input.kind !== "annotation" || input.target.kind !== "element")
		throw new Error("fixture");
	const logs = new LogStore();
	const record = logs.append({
		device: input.device,
		platform: input.platform,
		source: "ios-native",
		level: "info",
		message: "paid",
	});
	const source = {
		projectKey: "p",
		testID: "pay",
		file: "App.tsx",
		line: 2,
		startLine: 1,
		lines: ["first", "second"],
	};
	const draft = store.createDraft("workspace-a", {
		...input,
		source,
		logs: [record],
	});
	input.target.element.label = "A different screen";
	input.target.element.frame.x = 999;
	source.lines[1] = "changed";
	const saved = store.save("workspace-a", draft.id);
	expect(saved.kind).toBe("annotation");
	if (saved.kind !== "annotation" || saved.target.kind !== "element")
		throw new Error("fixture");
	expect(saved.target.element.label).toBe("Pay");
	expect(saved.target.element.frame.x).toBe(10);
	expect(saved.source?.lines[1]).toBe("second");
	expect(saved.image.base64).toBe(png);
	expect(saved.logs[0]?.id).toBe(record.id);
	expect(Object.isFrozen(saved.target.element.frame)).toBe(true);
	expect(Object.isFrozen(saved.logs)).toBe(true);
	expect(draft.state).toBe("draft");
	logs.dispose();
});

test("device and workspace switches preserve independent drafts and saved items", () => {
	const store = createContextStore();
	const ios = store.createDraft("one", fixture());
	const android = store.createDraft("one", fixture("android:b", "android"));
	const other = store.createDraft("two", fixture());
	store.updateNote("one", android.id, "Android change");
	store.save("one", ios.id);
	expect(store.list("one", "ios-a").map((item) => item.id)).toEqual([ios.id]);
	expect(store.list("one", "android:b")[0]?.note).toBe("Android change");
	expect(store.get("two", other.id).note).toBe("Move this button.");
	error(() => store.get("two", ios.id), "missing");
	error(() => store.updateNote("two", ios.id, "wrong workspace"), "missing");
	expect(store.save("one", ios.id)).toBe(store.get("one", ios.id));
});

test("removal, workspace clearing, and disposal release all retained evidence", () => {
	const store = createContextStore();
	const a = store.createDraft("one", fixture());
	store.createDraft("two", fixture());
	const before = store.usage().bytes;
	expect(store.remove("one", a.id)).toBe(true);
	expect(store.remove("one", a.id)).toBe(false);
	expect(store.usage().bytes).toBeLessThan(before);
	store.clearWorkspace("two");
	expect(store.usage()).toEqual({ bytes: 0, items: 0, workspaces: 0 });
	store.createDraft("three", fixture());
	store.dispose();
	store.dispose();
	expect(store.usage()).toEqual({ bytes: 0, items: 0, workspaces: 0 });
	error(() => store.createDraft("three", fixture()), "closed");
});

test("workspace capacity rejects new evidence without evicting unsent drafts", () => {
	const store = createContextStore();
	const ids: string[] = [];
	for (let index = 0; index < CONTEXT_LIMITS.itemsPerWorkspace; index++)
		ids.push(store.createDraft("one", fixture()).id);
	error(() => store.createDraft("one", fixture()), "limit");
	expect(store.list("one").map((item) => item.id)).toEqual(ids);
	store.remove("one", ids[4]!);
	expect(store.createDraft("one", fixture()).state).toBe("draft");
});

test("note limits reject an update without changing the prior draft", () => {
	const store = createContextStore();
	const draft = store.createDraft("one", {
		...fixture(),
		note: "x".repeat(4096),
	});
	error(() => store.updateNote("one", draft.id, "x".repeat(4097)), "limit");
	expect(store.get("one", draft.id)).toBe(draft);
});

test("the server storage limit preserves existing items across workspaces", () => {
	const store = createContextStore();
	const input = fixture();
	if (input.kind !== "annotation") throw new Error("fixture");
	const data = encodePng({
		width: 1000,
		height: 2000,
		channels: 4,
		data: randomBytes(8_000_000),
	});
	const image = {
		mimeType: "image/png" as const,
		width: 1000,
		height: 2000,
		base64: Buffer.from(data).toString("base64"),
	};
	const ids: string[] = [];
	for (let index = 0; index < 8; index++)
		ids.push(store.createDraft(`workspace-${index}`, { ...input, image }).id);
	const retained = store.usage().bytes;
	error(() => store.createDraft("workspace-9", { ...input, image }), "limit");
	expect(store.usage().bytes).toBe(retained);
	expect(store.get("workspace-0", ids[0]!).state).toBe("draft");
	store.remove("workspace-0", ids[0]!);
	expect(store.createDraft("workspace-9", { ...input, image }).state).toBe(
		"draft",
	);
	store.dispose();
});

test("malformed images, incorrect dimensions, and out-of-image targets are rejected", () => {
	const store = createContextStore();
	const input = fixture();
	if (input.kind !== "annotation") throw new Error("fixture");
	for (const image of [
		{ ...input.image, base64: "????" },
		{ ...input.image, base64: Buffer.from("not an image").toString("base64") },
		{ ...input.image, width: 2 },
		{ ...input.image, mimeType: "image/jpeg" as const },
	])
		error(() => store.createDraft("one", { ...input, image }), "invalid");
	error(
		() =>
			store.createDraft("one", {
				...input,
				target: { ...input.target, rect: { x: 0, y: 0, width: 2, height: 1 } },
			}),
		"invalid",
	);
	error(
		() =>
			store.createDraft("one", {
				...input,
				image: {
					...input.image,
					base64: "A".repeat(Math.ceil(CONTEXT_LIMITS.imageBytes / 3) * 4 + 4),
				},
			}),
		"limit",
	);
	expect(store.usage().items).toBe(0);
});

test("log evidence preserves occurrences and rejects another device or an oversized selection", () => {
	const logs = new LogStore();
	const record = logs.append({
		device: "android:b",
		platform: "android",
		source: "android-native",
		level: "error",
		message: "failed",
	});
	const store = createContextStore();
	const input: ContextInput = {
		kind: "logs",
		device: "android:b",
		platform: "android",
		capturedAt: 1,
		note: "Investigate",
		logs: [record],
	};
	expect(store.createDraft("one", input).logs[0]).toEqual(record);
	error(
		() => store.createDraft("one", { ...input, device: "ios-a" }),
		"invalid",
	);
	error(() => store.createDraft("one", { ...input, logs: [] }), "invalid");
	error(
		() =>
			store.createDraft("one", {
				...input,
				logs: Array.from({ length: 201 }, () => record),
			}),
		"limit",
	);
	error(
		() =>
			store.createDraft("one", {
				...input,
				logs: [{ ...record, message: "x".repeat(65536) }],
			}),
		"limit",
	);
	logs.dispose();
});

test("source evidence has bounded lines and bytes", () => {
	const store = createContextStore();
	const input = fixture();
	if (input.kind !== "annotation") throw new Error("fixture");
	const source = {
		projectKey: "p",
		testID: "pay",
		file: "App.tsx",
		line: 1,
		startLine: 1,
		lines: ["line"],
	};
	error(
		() =>
			store.createDraft("one", {
				...input,
				source: { ...source, lines: Array(42).fill("line") },
			}),
		"limit",
	);
	error(
		() =>
			store.createDraft("one", {
				...input,
				source: { ...source, lines: ["x".repeat(32768)] },
			}),
		"limit",
	);
	error(
		() =>
			store.createDraft("one", {
				...input,
				source: { ...source, startLine: 3 },
			}),
		"invalid",
	);
});

test("Effect scope disposal closes the context service", async () => {
	const runtime = ManagedRuntime.make(Layer.fresh(ContextsLive));
	const service = await runtime.runPromise(Contexts);
	const item: ContextItem = await runtime.runPromise(
		service.createDraft("one", fixture()),
	);
	expect(item.state).toBe("draft");
	await runtime.dispose();
	const result = await Effect.runPromise(Effect.either(service.list("one")));
	expect(result._tag).toBe("Left");
	if (result._tag === "Left") expect(result.left.code).toBe("closed");
});
