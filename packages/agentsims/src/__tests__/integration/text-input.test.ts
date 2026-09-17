import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import type { ActionResult } from "../../core/tools/actions";
import { makeDeviceService } from "../../core/tools/devices/devices";
import { CommandUnavailable } from "../../core/tools/errors";
import type { AxSnapshot } from "../../core/tools/observe/accessibility-model";
import {
	createSnapshotStore,
	type DeviceSnapshot,
} from "../../core/tools/observe/snapshot-store";
import {
	runTextInput,
	type DeviceField,
	type FieldIdentity,
	type FieldRequest,
	type FieldResult,
	type TextInputAction,
} from "../../core/tools/text-input";
import type { PreviewServer } from "../../server/http/server";
import { axElement } from "../fixtures/ax-view-snapshots";
import { usablePng } from "../fixtures/capture-images";
import { startTestServer } from "../helpers/server";

const DEVICE = "android:emulator-5554";
const SCREEN = { width: 1080, height: 2400, orientation: "portrait" };
const IDENTITY = {
	id: "com.example:id/search",
	path: "0.0",
	role: "textbox" as const,
	windowId: 1,
	sourceId: 2,
};
const servers: PreviewServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop()));
});

function snapshot(
	value: string,
	options: { present?: boolean; focused?: boolean; password?: boolean } = {},
): AxSnapshot {
	const elements = [
		axElement("0", "android.widget.FrameLayout", {
			id: "root",
			windowId: 1,
			windowActive: true,
			windowFocused: true,
			frame: { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height },
		}),
	];
	if (options.present !== false)
		elements.push(
			axElement(IDENTITY.path, "android.widget.EditText", {
				id: IDENTITY.id,
				label: "Search",
				value,
				windowId: IDENTITY.windowId,
				sourceId: IDENTITY.sourceId,
				traits: [
					"focusable",
					...(options.focused === false ? [] : ["focused"]),
					...(options.password ? ["password"] : []),
				],
				frame: { x: 40, y: 240, width: 1000, height: 120 },
			}),
		);
	return { screen: SCREEN, elements };
}

function field(
	value: string,
	options: {
		focused?: boolean;
		editable?: boolean;
		password?: boolean;
		selection?: { start: number; end: number } | null;
		identity?: FieldIdentity | null;
	} = {},
): DeviceField {
	return {
		value,
		editable: options.editable ?? true,
		password: options.password ?? false,
		focused: options.focused ?? true,
		...(options.identity === null
			? {}
			: { identity: options.identity ?? IDENTITY }),
		...(options.selection === null
			? {}
			: { selection: options.selection ?? { start: value.length, end: value.length } }),
	};
}

function publish(
	store: ReturnType<typeof createSnapshotStore>,
	raw: AxSnapshot,
): DeviceSnapshot {
	const ticket = store.beginObservation(DEVICE);
	const view = store.publishObservation(ticket, {
		platform: "android",
		snapshot: raw,
		screen: SCREEN,
		app: "com.example.app",
		all: false,
	});
	if (!view) throw new Error("Expected the scripted observation to publish.");
	return view;
}

type Scenario = {
	initial?: AxSnapshot;
	observations?: Array<AxSnapshot | null>;
	fieldResults?: FieldResult[];
	focusedFields?: Array<DeviceField | null>;
	failDispatchAt?: number;
};

function scenario(options: Scenario = {}) {
	const store = createSnapshotStore();
	publish(store, options.initial ?? snapshot(""));
	const observations = [...(options.observations ?? [])];
	const fieldResults = [...(options.fieldResults ?? [])];
	const focusedFields = [...(options.focusedFields ?? [])];
	const fieldRequests: FieldRequest[] = [];
	const dispatches: ReadonlyArray<unknown>[] = [];
	let observationCalls = 0;

	const run = (action: TextInputAction) =>
		Effect.runPromise(
			runTextInput(
				{
					device: DEVICE,
					store,
					session: {
						performField: async (request) => {
							fieldRequests.push(request);
							const result = fieldResults.shift();
							if (!result)
								throw new Error("Missing scripted field acknowledgement.");
							return result;
						},
						readFocusedField: async () => focusedFields.shift() ?? null,
					},
					dispatch: (actions) => {
						dispatches.push(actions);
						if (dispatches.length === options.failDispatchAt)
							return Effect.fail(
								new CommandUnavailable({
									message: "Return transport closed",
									effect: "unknown",
								}),
							);
						return Effect.succeed(undefined);
					},
					observe: () =>
						Effect.sync(() => {
							observationCalls += 1;
							const raw = observations.shift();
							return {
								view: raw ? publish(store, raw) : null,
								warnings: raw ? [] : ["Accessibility unavailable."],
							};
						}),
				},
				action,
			).pipe(Effect.either),
		);

	return {
		run,
		fieldRequests,
		dispatches,
		observationCalls: () => observationCalls,
	};
}

test("one HTTP text workflow returns explicit native evidence", async () => {
	const reads = [snapshot("old"), snapshot("old"), snapshot("new")];
	const fieldResults: FieldResult[] = [
		{ performed: true, field: field("old", { selection: { start: 1, end: 1 } }) },
		{ performed: true, field: field("new") },
	];
	const screenshot = usablePng(SCREEN.width, SCREEN.height);
	const service = makeDeviceService(
		{
			memoryReport: async () => ({ ok: false }),
			page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
		},
		{
			start: async (device) => ({ error: null, device }),
			shutdown: async () => null,
			states: async () => [],
		},
		() =>
			Effect.succeed({
				platform: "android" as const,
				dispatchInputFrame: async () => undefined,
				captureScreenshot: async () => ({
					bytes: screenshot,
					mimeType: "image/png",
					capturedAt: Date.now(),
					width: SCREEN.width,
					height: SCREEN.height,
				}),
				readConfig: async () => SCREEN,
				readAccessibility: async () => reads.shift() ?? snapshot("new"),
				performField: async () => {
					const result = fieldResults.shift();
					if (!result) throw new Error("Missing field acknowledgement.");
					return result;
				},
				readFocusedField: async () => field("new"),
			}),
		() => Effect.succeed("com.example.app"),
	);
	const { origin, server } = await startTestServer({ deviceCommands: service });
	servers.push(server);
	const client = new ApplicationCommandClient({ origin });
	await client.observeDevice(DEVICE);

	const result = (await client.actDevice(DEVICE, [
		{ type: "type", text: "new", into: "Search", clear: true },
	])) as ActionResult;

	expect(result.dispatch.status).toBe("accepted");
	expect(result.verification.status).toBe("matched");
	expect(result.text).toMatchObject({
		operation: "fill",
		expected: "new",
		value: "new",
	});
});

test("unsupported text is rejected before focus or dispatch", async () => {
	const scripted = scenario();
	const result = await scripted.run({
		type: "type",
		text: "a\nb",
		into: "Search",
	});

	expect(Either.isLeft(result)).toBe(true);
	if (Either.isLeft(result)) {
		expect(result.left.effect).toBe("none");
		expect(result.left.message).toContain("Unsupported character");
	}
	expect(scripted.fieldRequests).toEqual([]);
	expect(scripted.dispatches).toEqual([]);
	expect(scripted.observationCalls()).toBe(0);
});

test("input stops when focus is absent or belongs to another field", async () => {
	for (const focused of [
		field("old", { focused: false }),
		field("old", {
			identity: { ...IDENTITY, id: "other", path: "0.1", sourceId: 3 },
		}),
	]) {
		const scripted = scenario({
			initial: snapshot("old"),
			observations: [snapshot("old")],
			fieldResults: [{ performed: true, field: focused }],
		});
		const result = await scripted.run({ type: "type", text: "x", into: "Search" });

		expect(Either.isLeft(result)).toBe(true);
		if (Either.isLeft(result)) expect(result.left.effect).toBe("unknown");
		expect(scripted.dispatches).toEqual([]);
	}
});

test("type predicts replacement from the reported selection", async () => {
	const scripted = scenario({
		initial: snapshot("hXXlo"),
		observations: [snapshot("hXXlo"), snapshot("hello")],
		fieldResults: [
			{
				performed: true,
				field: field("hXXlo", { selection: { start: 1, end: 3 } }),
			},
		],
		focusedFields: [field("hello")],
	});
	const result = await scripted.run({ type: "type", text: "el", into: "Search" });

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.entry.expected).toBe("hello");
		expect(result.right.entry.value).toBe("hello");
		expect(result.right.verification.status).toBe("matched");
	}
	expect(scripted.dispatches).toEqual([[{ type: "type", text: "el" }]]);
});

test("a matched value and confirmed target submit one Return", async () => {
	const scripted = scenario({
		initial: snapshot(""),
		observations: [snapshot(""), snapshot("done")],
		fieldResults: [{ performed: true, field: field("") }],
		focusedFields: [field("done")],
	});
	const result = await scripted.run({
		type: "type",
		text: "done",
		into: "Search",
		submit: true,
	});

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.verification.status).toBe("matched");
		expect(result.right.entry.submit.status).toBe("accepted");
	}
	expect(scripted.dispatches).toEqual([
		[{ type: "type", text: "done" }],
		[{ type: "key", key: "enter" }],
	]);
});

test("a mismatch suppresses submit", async () => {
	const scripted = scenario({
		initial: snapshot("old"),
		observations: [snapshot("old"), snapshot("ne")],
		fieldResults: [
			{ performed: true, field: field("old") },
			{ performed: true, field: field("ne") },
		],
		focusedFields: [field("ne")],
	});
	const result = await scripted.run({
		type: "type",
		text: "new",
		into: "Search",
		clear: true,
		submit: true,
	});

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.verification.status).toBe("mismatch");
		expect(result.right.entry.submit.status).toBe("suppressed");
	}
	expect(scripted.dispatches).toEqual([]);
});

test("unavailable verification suppresses submit", async () => {
	for (const options of [
		{
			before: field("a", { selection: null }),
			after: snapshot("ab"),
			focused: field("ab"),
			reason: "current text selection is unavailable",
		},
		{
			before: field("a", { selection: { start: 1, end: 1 } }),
			after: snapshot("", { present: false }),
			focused: null,
			reason: "target field is not present after input",
		},
	]) {
		const scripted = scenario({
			initial: snapshot("a"),
			observations: [snapshot("a"), options.after],
			fieldResults: [{ performed: true, field: options.before }],
			focusedFields: [options.focused],
		});
		const result = await scripted.run({
			type: "type",
			text: "b",
			into: "Search",
			submit: true,
		});

		expect(Either.isRight(result)).toBe(true);
		if (Either.isRight(result)) {
			expect(result.right.verification.status).toBe("unavailable");
			expect(result.right.entry.submit).toMatchObject({
				requested: true,
				status: "suppressed",
				reason: expect.stringContaining(options.reason),
			});
		}
		expect(scripted.dispatches).toEqual([[{ type: "type", text: "b" }]]);
	}
});

test("a protected value suppresses submit", async () => {
	const protectedIdentity: FieldIdentity = {
		...IDENTITY,
		role: "securetextbox",
	};
	const scripted = scenario({
		initial: snapshot("", { password: true }),
		observations: [
			snapshot("", { password: true }),
			snapshot("", { password: true }),
		],
		fieldResults: [
			{
				performed: true,
				field: field("", { password: true, identity: protectedIdentity }),
			},
		],
		focusedFields: [
			field("", { password: true, identity: protectedIdentity }),
		],
	});
	const result = await scripted.run({
		type: "type",
		text: "secret",
		into: "Search",
		submit: true,
	});

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.verification).toMatchObject({
			status: "unavailable",
			reason: "The protected field does not expose a value.",
		});
		expect(result.right.entry).toMatchObject({
			expected: null,
			value: null,
			submit: {
				requested: true,
				status: "suppressed",
				reason: expect.stringContaining("protected field"),
			},
		});
	}
	expect(scripted.dispatches).toEqual([[{ type: "type", text: "secret" }]]);
});

test("a refused native fill is not retried with key input", async () => {
	const scripted = scenario({
		initial: snapshot("old"),
		observations: [snapshot("old")],
		fieldResults: [
			{ performed: true, field: field("old") },
			{ performed: false, field: field("old") },
		],
	});
	const result = await scripted.run({
		type: "type",
		text: "new",
		into: "Search",
		clear: true,
	});

	expect(Either.isLeft(result)).toBe(true);
	if (Either.isLeft(result)) expect(result.left.effect).toBe("unknown");
	expect(scripted.fieldRequests.map((request) => request.action)).toEqual([
		"focus",
		"set-text",
	]);
	expect(scripted.dispatches).toEqual([]);
});

test("lost focus suppresses submit after verified input", async () => {
	const scripted = scenario({
		initial: snapshot(""),
		observations: [snapshot(""), snapshot("done")],
		fieldResults: [{ performed: true, field: field("") }],
		focusedFields: [field("done", { focused: false })],
	});
	const result = await scripted.run({
		type: "type",
		text: "done",
		into: "Search",
		submit: true,
	});

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.verification.status).toBe("unavailable");
		expect(result.right.entry.submit.status).toBe("suppressed");
	}
	expect(scripted.dispatches).toEqual([[{ type: "type", text: "done" }]]);
});

test("submit failure preserves verified text evidence", async () => {
	const scripted = scenario({
		initial: snapshot(""),
		observations: [snapshot(""), snapshot("done")],
		fieldResults: [{ performed: true, field: field("") }],
		focusedFields: [field("done")],
		failDispatchAt: 2,
	});
	const result = await scripted.run({
		type: "type",
		text: "done",
		into: "Search",
		submit: true,
	});

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.dispatch).toBe("unknown");
		expect(result.right.verification.status).toBe("matched");
		expect(result.right.entry).toMatchObject({
			expected: "done",
			value: "done",
			submit: { status: "unknown", reason: "Return transport closed" },
		});
	}
});
