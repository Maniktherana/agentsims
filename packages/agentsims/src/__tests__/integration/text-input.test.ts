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
	type FieldSession,
	type TextInputAction,
} from "../../core/tools/text-input";
import type {
	AndroidNodeDescription,
	AndroidNodeRef,
	AndroidNodeResult,
} from "../../core/android/accessibility/ax-server";
import { AndroidSession } from "../../core/android/session/session";
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
	/** A platform session, instead of the scripted acknowledgements. */
	session?: FieldSession;
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
					session: options.session ?? {
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

const CONTAINER_LINK = {
	windowId: IDENTITY.windowId,
	sourceId: IDENTITY.sourceId,
	resourceId: IDENTITY.id,
	class: "android.widget.SearchView",
	editable: false,
};

/** The search container that the snapshot shows as one text field. */
const CONTAINER: AndroidNodeDescription = {
	class: CONTAINER_LINK.class,
	resourceId: IDENTITY.id,
	text: "",
	contentDesc: "Search",
	editable: false,
	hintText: false,
	password: false,
	focused: false,
	enabled: true,
	windowId: IDENTITY.windowId,
	sourceId: IDENTITY.sourceId,
	selectionStart: -1,
	selectionEnd: -1,
	bounds: "[40,240][1040,360]",
	ancestors: [],
};

/** The editable child of the container. Android focuses this node. */
function containerChild(value: string): AndroidNodeDescription {
	return {
		class: "android.widget.EditText",
		resourceId: "com.example:id/search_src_text",
		text: value,
		contentDesc: "",
		editable: true,
		hintText: false,
		password: false,
		focused: true,
		enabled: true,
		windowId: IDENTITY.windowId,
		sourceId: 3,
		selectionStart: value.length,
		selectionEnd: value.length,
		bounds: "[48,248][1032,352]",
		ancestors: [CONTAINER_LINK],
	};
}

/** The plain field of `snapshot`, as the Android helper describes it. */
function plainField(value: string): AndroidNodeDescription {
	return {
		...containerChild(value),
		class: "android.widget.EditText",
		resourceId: IDENTITY.id,
		sourceId: IDENTITY.sourceId,
		bounds: "[40,240][1040,360]",
		ancestors: [],
	};
}

function containerSnapshot(value: string): AxSnapshot {
	return {
		screen: SCREEN,
		elements: [
			axElement("0", "android.widget.FrameLayout", {
				id: "root",
				windowId: IDENTITY.windowId,
				windowActive: true,
				windowFocused: true,
				frame: { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height },
			}),
			axElement(IDENTITY.path, CONTAINER_LINK.class, {
				id: IDENTITY.id,
				label: "Search",
				value,
				windowId: IDENTITY.windowId,
				sourceId: IDENTITY.sourceId,
				traits: ["focusable"],
				frame: { x: 40, y: 240, width: 1000, height: 120 },
			}),
		],
	};
}

function androidSession(input: {
	serial?: string;
	perform: (call: {
		action: string;
		target: AndroidNodeRef;
		text?: string;
	}) => AndroidNodeResult;
	focus: () => AndroidNodeDescription | null;
	touches?: Array<{ phase: string; x: number; y: number }>;
}): AndroidSession {
	const serial = input.serial ?? "emulator-5554";
	return new AndroidSession(serial, {
		performAxAction: async (device, action, target, text) => {
			expect(device).toBe(serial);
			return input.perform({ action, target, text });
		},
		readAxFocus: async () => input.focus(),
		readScreenConfig: async () => ({
			width: SCREEN.width,
			height: SCREEN.height,
			orientation: "portrait",
		}),
		touchDevice: async (device, phase, x, y) => {
			expect(device).toBe(serial);
			input.touches?.push({ phase, x, y });
		},
	});
}

/** The device service binds the platform session behind its own functions. */
function fieldSessionOf(session: AndroidSession): FieldSession {
	return {
		performField: (request) => session.performField(request),
		readFocusedField: () => session.readFocusedField(),
	};
}

test("a wrapped field accepts the focus of its editable child", async () => {
	const calls: AndroidNodeRef[] = [];
	let value = "";
	const session = androidSession({
		perform: ({ action, target, text }) => {
			calls.push(target);
			if (action === "focus")
				return {
					performed: true,
					node: containerChild(value),
					requested: CONTAINER,
				};
			value = text ?? "";
			return { performed: true, node: containerChild(value) };
		},
		focus: () => containerChild(value),
	});
	const scripted = scenario({
		session: fieldSessionOf(session),
		initial: containerSnapshot(""),
		observations: [containerSnapshot(""), containerSnapshot("hello")],
	});

	const result = await scripted.run({
		type: "type",
		text: "hello",
		into: "Search",
		clear: true,
	});

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.dispatch).toBe("accepted");
		expect(result.right.verification.status).toBe("matched");
		expect(result.right.entry).toMatchObject({
			operation: "fill",
			expected: "hello",
			value: "hello",
			field: { label: "Search" },
		});
	}
	// The write reaches the child that holds Android's input focus.
	expect(calls.at(-1)).toEqual({
		node: "focus",
		windowId: IDENTITY.windowId,
		sourceId: 3,
	});
	expect(scripted.dispatches).toEqual([]);
	await session.close();
});

test("one tap repairs a refused focus before key input", async () => {
	const touches: Array<{ phase: string; x: number; y: number }> = [];
	const calls: string[] = [];
	const session = androidSession({
		serial: "R5CW1234ABC",
		touches,
		perform: ({ action }) => {
			calls.push(action);
			return { performed: false, node: null, requested: plainField("") };
		},
		focus: () => plainField(""),
	});
	const scripted = scenario({
		session: fieldSessionOf(session),
		initial: snapshot(""),
		observations: [snapshot(""), snapshot("hi")],
	});

	const result = await scripted.run({ type: "type", text: "hi", into: "Search" });

	expect(Either.isRight(result)).toBe(true);
	if (Either.isRight(result)) {
		expect(result.right.dispatch).toBe("accepted");
		expect(result.right.verification.status).toBe("matched");
		expect(result.right.entry.value).toBe("hi");
	}
	// Android refused the focus action once. One tap, and no second action.
	expect(calls).toEqual(["focus"]);
	expect(touches.map((touch) => touch.phase)).toEqual(["begin", "end"]);
	expect(scripted.dispatches).toEqual([[{ type: "type", text: "hi" }]]);
	await session.close();
});
