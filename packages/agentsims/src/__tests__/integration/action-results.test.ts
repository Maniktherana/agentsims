import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { makeDeviceService } from "../../core/tools/devices/devices";
import { CommandUnavailable } from "../../core/tools/errors";
import type { AxSnapshot } from "../../core/tools/observe/accessibility-model";
import type { PreviewServer } from "../../server/http/server";
import { axElement, androidSignInSnapshot } from "../fixtures/ax-view-snapshots";
import { usablePng } from "../fixtures/capture-images";
import { startTestServer } from "../helpers/server";

const servers: PreviewServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop()));
});

const ANDROID = "android:emulator-5554";
const IOS = "ios-device";
const screens = {
	[ANDROID]: { width: 1080, height: 2400, orientation: "portrait" },
	[IOS]: { width: 1206, height: 2622, orientation: "portrait" },
} as const;
const images = {
	[ANDROID]: usablePng(screens[ANDROID].width, screens[ANDROID].height),
	[IOS]: usablePng(screens[IOS].width, screens[IOS].height),
};

type Behaviour = {
	trees?: Partial<Record<string, AxSnapshot[]>>;
	apps?: Partial<Record<string, string[]>>;
	failAccessibilityAt?: Partial<Record<string, number[]>>;
	failDispatch?: boolean;
	onDispatch?: (device: string, call: number) => Promise<void> | void;
	onScreenshot?: (device: string, call: number) => Promise<void> | void;
};

async function start(behaviour: Behaviour = {}) {
	const frames: Array<{ device: string; input: unknown }> = [];
	// Every read of the device, in order. A watch has to sample before the
	// settle read, so the order is the evidence.
	const events: string[] = [];
	const reads = new Map<string, number>();
	const appReads = new Map<string, number>();
	const screenshots = new Map<string, number>();
	let dispatchCalls = 0;
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
		(device) =>
			Effect.succeed({
				platform: device === IOS ? ("ios" as const) : ("android" as const),
				dispatchInputFrame: async (data: Buffer) => {
					dispatchCalls += 1;
					await behaviour.onDispatch?.(device, dispatchCalls);
					if (behaviour.failDispatch)
						throw new Error("The device connection closed.");
					frames.push({
						device,
						input: JSON.parse(data.subarray(1).toString()),
					});
				},
				captureScreenshot: async () => {
					events.push("screenshot");
					const call = (screenshots.get(device) ?? 0) + 1;
					screenshots.set(device, call);
					await behaviour.onScreenshot?.(device, call);
					const screen = screens[device as keyof typeof screens];
					return {
						bytes: images[device as keyof typeof images],
						mimeType: "image/png",
						capturedAt: Date.now(),
						width: screen.width,
						height: screen.height,
					};
				},
				readConfig: async () => screens[device as keyof typeof screens],
				readAccessibility: async () => {
					events.push("read");
					const index = reads.get(device) ?? 0;
					reads.set(device, index + 1);
					if (behaviour.failAccessibilityAt?.[device]?.includes(index))
						throw new Error("The accessibility service stopped.");
					const trees = behaviour.trees?.[device];
					return trees?.[index] ?? trees?.at(-1) ?? androidSignInSnapshot;
				},
			}),
		(device) =>
			Effect.sync(() => {
				const index = appReads.get(device) ?? 0;
				appReads.set(device, index + 1);
				const apps = behaviour.apps?.[device];
				return apps?.[index] ?? apps?.at(-1) ?? "com.example.app";
			}),
	);
	const { origin, server } = await startTestServer({ deviceCommands: service });
	servers.push(server);
	return {
		client: new ApplicationCommandClient({ origin }),
		service,
		frames,
		events,
		reads,
		screenshots,
		dispatchCalls: () => dispatchCalls,
	};
}

const changedTree: AxSnapshot = {
	...androidSignInSnapshot,
	elements: [
		...androidSignInSnapshot.elements,
		axElement("0.3", "android.widget.Button", {
			id: "dismiss",
			label: "Dismiss",
			frame: { x: 40, y: 1800, width: 400, height: 120 },
		}),
	],
};

const structuralTree: AxSnapshot = {
	screen: androidSignInSnapshot.screen,
	elements: [
		axElement("0", "android.widget.FrameLayout", {
			id: "root",
			frame: { x: 0, y: 0, width: 1080, height: 2400 },
		}),
	],
};

function autoplayTree(checked: boolean, label = "Autoplay"): AxSnapshot {
	return {
		...androidSignInSnapshot,
		elements: androidSignInSnapshot.elements.map((element) =>
			element.id === "autoplay"
				? {
						...element,
						label,
						traits: checked ? ["checkable", "checked"] : ["checkable"],
					}
				: element,
		),
	};
}

/** The sign-in screen with a dialog over it, as a long press opens. */
const popupTree: AxSnapshot = {
	...androidSignInSnapshot,
	elements: [
		...androidSignInSnapshot.elements,
		axElement("1", "android.app.AlertDialog", {
			id: "popup",
			label: "Add to playlist",
			frame: { x: 200, y: 600, width: 600, height: 300 },
		}),
		axElement("1.0", "android.widget.Button", {
			id: "cancel",
			label: "Cancel",
			frame: { x: 220, y: 620, width: 200, height: 100 },
		}),
		axElement("1.1", "android.widget.Button", {
			id: "ok",
			label: "OK",
			frame: { x: 440, y: 620, width: 200, height: 100 },
		}),
	],
};

function windowTree(windowId: number): AxSnapshot {
	return {
		screen: androidSignInSnapshot.screen,
		elements: [
			axElement("0", "android.widget.FrameLayout", {
				id: `window-${windowId}`,
				windowId,
				windowActive: true,
				windowFocused: true,
				frame: { x: 0, y: 0, width: 1080, height: 2400 },
			}),
			axElement("0.0", "android.widget.Button", {
				id: "continue",
				label: "Continue",
			}),
		],
	};
}

test("accepted generic input reports dispatch separately and returns fresh refs", async () => {
	const { client } = await start({
		trees: { [ANDROID]: [androidSignInSnapshot, changedTree] },
	});
	const before = (await client.observeDevice(ANDROID)) as {
		view: { refs: Record<string, string> };
	};
	const ref = Object.entries(before.view.refs).find(
		([, id]) => id === "autoplay",
	)![0];

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: `@${ref}` },
	])) as {
		dispatch: { status: string };
		verification: { status: string; observed: Record<string, unknown> };
		view: { id: string; refs: Record<string, string> };
		captureReason: string | null;
	};

	expect(result.dispatch.status).toBe("accepted");
	expect(result.verification).toMatchObject({
		status: "mismatch",
		observed: { checked: { before: true, after: true } },
	});
	expect(result.view.id).toStartWith("s");
	expect(Object.keys(result.view.refs)).not.toContain(ref);
	expect(result.captureReason).toBe("ax_unchanged");
});

test("refusal before dispatch changes nothing and keeps refs and captures", async () => {
	const { client, frames } = await start();
	await client.observeDevice(ANDROID);
	const before = (await client.observeDevice(ANDROID)) as {
		captureId: string;
		view: { id: string; refs: Record<string, string> };
	};
	const disabled = Object.entries(before.view.refs).find(
		([, id]) => id === "remember",
	)![0];

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: "@e1" },
	])) as {
		dispatch: { status: string; reason: string };
		view: { id: string; refs: Record<string, string> };
		accessibility: { status: string };
		image: unknown;
		captureReason: string | null;
		warnings: string[];
	};

	expect(result.dispatch.status).toBe("none");
	expect(result.dispatch.reason).toContain("ref @e1 is not addressable");
	expect(result.view.id).toBe(before.view.id);
	expect(result.view.refs).toEqual(before.view.refs);
	expect(result.accessibility.status).toBe("ok");
	expect(result.image).toBeNull();
	expect(result.captureReason).toBeNull();
	expect(result.warnings).toContain(
		"Nothing was sent to the device. Refs and captures from the last observation are still valid.",
	);
	expect(frames).toHaveLength(0);

	const refAfterRefusal = (await client.actDevice(ANDROID, [
		{ type: "tap", target: `@${disabled}` },
	])) as { dispatch: { reason: string }; view: { id: string } };
	expect(refAfterRefusal.dispatch.reason).toContain("is disabled");
	expect(refAfterRefusal.view.id).toBe(before.view.id);

	const captureAfterRefusal = (await client.actDevice(ANDROID, [
		{ type: "tap", target: "50%,50%", capture: before.captureId },
	])) as { dispatch: { status: string } };
	expect(captureAfterRefusal.dispatch.status).toBe("accepted");
	expect(frames.length).toBeGreaterThan(0);
});

type VerificationResult = {
	dispatch: { status: string };
	verification: { status: string; observed: Record<string, unknown> | null };
};

/** Observe once and index the refs by element ID. */
async function refsById(
	client: ApplicationCommandClient,
): Promise<Record<string, string>> {
	const observation = (await client.observeDevice(ANDROID)) as {
		view: { refs: Record<string, string> };
	};
	return Object.fromEntries(
		Object.entries(observation.view.refs).map(([ref, id]) => [id, ref]),
	);
}

test.each([
	["matched", true],
	["mismatch", false],
] as const)("a switch tap reports the checked state (%s)", async (status, flips) => {
	const { client } = await start({
		trees: {
			[ANDROID]: [
				autoplayTree(false),
				autoplayTree(false),
				autoplayTree(flips),
			],
		},
	});
	const ref = (await refsById(client))["autoplay"]!;

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: `@${ref}` },
	])) as VerificationResult;

	expect(result.dispatch.status).toBe("accepted");
	expect(result.verification).toMatchObject({
		status,
		observed: { checked: { before: false, after: flips } },
	});
});

test.each([
	["a dialog", true],
	["nothing", false],
] as const)("a long press describes what opened (%s)", async (_label, opens) => {
	const { client } = await start({
		trees: {
			[ANDROID]: [
				androidSignInSnapshot,
				androidSignInSnapshot,
				opens ? popupTree : androidSignInSnapshot,
			],
		},
	});
	const ref = (await refsById(client))["com.example:id/submit"]!;

	const result = (await client.actDevice(ANDROID, [
		{ type: "long-press", target: `@${ref}` },
	])) as VerificationResult;

	expect(result.dispatch.status).toBe("accepted");
	expect(result.verification).toMatchObject({
		status: "not_applicable",
		reason: "Observed after the action.",
		observed: {
			screenChanged: opens,
			foregroundApp: "com.example.app",
			newWindows: opens ? ['dialog "Add to playlist" (Cancel, OK)'] : [],
			gone: false,
		},
	});
});

test.each([
	["moved", true],
	["still", false],
] as const)("a swipe describes whether the list moved (%s)", async (_label, moves) => {
	const { client } = await start({
		trees: {
			[ANDROID]: [
				androidSignInSnapshot,
				androidSignInSnapshot,
				moves ? autoplayTree(true, "Autoplay off") : androidSignInSnapshot,
			],
		},
	});
	const refs = await refsById(client);

	const result = (await client.actDevice(ANDROID, [
		{
			type: "swipe",
			from: `@${refs["list"]}`,
			to: `@${refs["com.example:id/submit"]}`,
		},
	])) as VerificationResult;

	expect(result.dispatch.status).toBe("accepted");
	expect(result.verification).toMatchObject({
		status: "not_applicable",
		reason: "Observed after the action.",
		observed: {
			contentMoved: moves,
			firstVisible: {
				before: "Autoplay",
				after: moves ? "Autoplay off" : "Autoplay",
			},
		},
	});
});

test("a semantic target is checked again immediately before dispatch", async () => {
	const withoutAutoplay: AxSnapshot = {
		...androidSignInSnapshot,
		elements: androidSignInSnapshot.elements.filter(
			(element) => element.id !== "autoplay",
		),
	};
	const { client, frames } = await start({
		trees: { [ANDROID]: [androidSignInSnapshot, withoutAutoplay] },
	});
	const before = (await client.observeDevice(ANDROID)) as {
		view: { refs: Record<string, string> };
	};
	const ref = Object.entries(before.view.refs).find(
		([, id]) => id === "autoplay",
	)![0];

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: `@${ref}` },
	])) as { dispatch: { status: string; reason: string } };

	expect(result.dispatch.status).toBe("none");
	expect(result.dispatch.reason).toContain("changed before dispatch");
	expect(frames).toEqual([]);
});

test("an uncertain dispatch is not retried and keeps a fresh AX result", async () => {
	const { client, dispatchCalls } = await start({ failDispatch: true });
	const observation = (await client.observeDevice(ANDROID)) as {
		view: { refs: Record<string, string> };
	};
	const ref = Object.entries(observation.view.refs).find(
		([, id]) => id === "autoplay",
	)![0];

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: `@${ref}` },
	])) as {
		dispatch: { status: string; reason: string };
		accessibility: { status: string };
		view: { id: string };
	};

	expect(result.dispatch).toMatchObject({
		status: "unknown",
		reason: "The device connection closed.",
	});
	expect(result.accessibility.status).toBe("ok");
	expect(result.view.id).toStartWith("s");
	expect(dispatchCalls()).toBe(1);
});

test("AX failure does not erase accepted dispatch and triggers a screenshot", async () => {
	const { client, screenshots } = await start({
		failAccessibilityAt: { [ANDROID]: [0] },
	});

	const result = (await client.actDevice(ANDROID, [
		{ type: "button", button: "back" },
	])) as {
		dispatch: { status: string };
		accessibility: { status: string; error: string };
		view: null;
		captureReason: string;
		image: { status: string };
	};

	expect(result.dispatch.status).toBe("accepted");
	expect(result.accessibility).toMatchObject({
		status: "error",
		error: "The accessibility service stopped.",
	});
	expect(result.view).toBeNull();
	expect(result.captureReason).toBe("ax_failed");
	expect(result.image.status).toBe("ok");
	expect(screenshots.get(ANDROID)).toBe(1);
});

test.each([
	["explicit", { explicit: true }],
	["coordinate", { coordinate: true }],
	["ax_unusable", { structural: true }],
	["foreground_changed", { app: true }],
	["window_changed", { window: true }],
	["ax_unchanged", { unchanged: true }],
] as const)("captures for %s", async (reason, mode) => {
	const trees = mode.structural
		? [structuralTree]
		: mode.window
			? [windowTree(1), windowTree(2)]
			: [androidSignInSnapshot, androidSignInSnapshot];
	const { client, screenshots } = await start({
		trees: { [ANDROID]: trees },
		...(mode.app
			? { apps: { [ANDROID]: ["com.before", "com.after", "com.after"] } }
			: {}),
	});
	let action: Record<string, unknown> = { type: "button", button: "back" };
	let options = {};
	if (!mode.structural && !mode.explicit) {
		const observation = (await client.observeDevice(ANDROID)) as {
			captureId: string;
		};
		if (mode.coordinate)
			action = {
				type: "tap",
				target: "50%,50%",
				capture: observation.captureId,
			};
	}
	if (mode.explicit) options = { screenshot: true };
	const before = screenshots.get(ANDROID) ?? 0;

	const result = (await client.actDevice(ANDROID, [action], options)) as {
		captureReason: string;
		image: { status: string };
	};

	expect(result.captureReason).toBe(reason);
	expect(result.image.status).toBe("ok");
	expect(screenshots.get(ANDROID)).toBe(before + 1);
});

test("geometry changes are meaningful and rotate does not capture only for unchanged AX", async () => {
	const moved: AxSnapshot = {
		...androidSignInSnapshot,
		elements: androidSignInSnapshot.elements.map((element) =>
			element.id === "com.example:id/submit"
				? { ...element, frame: { ...element.frame, y: element.frame.y + 20 } }
				: element,
		),
	};
	const geometry = await start({
		trees: { [ANDROID]: [androidSignInSnapshot, moved] },
	});
	await geometry.client.observeDevice(ANDROID);
	const changed = (await geometry.client.actDevice(ANDROID, [
		{ type: "button", button: "back" },
	])) as { captureReason: string | null; image: unknown };
	expect(changed.captureReason).toBeNull();
	expect(changed.image).toBeNull();

	const rotation = await start();
	await rotation.client.observeDevice(ANDROID);
	const unchangedRotate = (await rotation.client.actDevice(ANDROID, [
		{ type: "rotate", orientation: "portrait" },
	])) as { captureReason: string | null; image: unknown };
	expect(unchangedRotate.captureReason).toBeNull();
	expect(unchangedRotate.image).toBeNull();
});

test("same-device actions serialize while different devices remain parallel", async () => {
	const entered = Promise.withResolvers<void>();
	const secondEntered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let androidDispatches = 0;
	const test = await start({
		onDispatch: async (device) => {
			if (device === ANDROID) {
				androidDispatches += 1;
				if (androidDispatches > 1) secondEntered.resolve();
			}
			if (device === ANDROID && androidDispatches === 1) {
				entered.resolve();
				await release.promise;
			}
		},
	});
	const first = Effect.runPromise(
		test.service.act(ANDROID, [{ type: "button", button: "back" }]),
	);
	await entered.promise;
	const second = Effect.runPromise(
		test.service.act(ANDROID, [{ type: "button", button: "home" }]),
	);
	const other = Effect.runPromise(
		test.service.act(IOS, [{ type: "button", button: "home" }]),
	);

	await other;
	expect(test.dispatchCalls()).toBe(2);
	expect(androidDispatches).toBe(1);
	release.resolve();
	await secondEntered.promise;
	await Promise.all([first, second]);
	expect(test.dispatchCalls()).toBe(3);
});

test("browser mutation invalidation does not wait for the CLI action lock", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const test = await start({
		onDispatch: async () => {
			entered.resolve();
			await release.promise;
		},
	});
	const action = Effect.runPromise(
		test.service.act(ANDROID, [{ type: "button", button: "back" }]),
	);
	await entered.promise;

	test.service.mutate(ANDROID);
	release.resolve();
	const result = await action;
	expect(result.dispatch.status).toBe("accepted");
});

test("a browser mutation during screenshot capture cannot publish stale refs", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const test = await start({
		onScreenshot: async (_device, call) => {
			if (call !== 1) return;
			entered.resolve();
			await release.promise;
		},
	});
	const action = Effect.runPromise(
		test.service.act(
			ANDROID,
			[{ type: "button", button: "back" }],
			{ screenshot: true },
		),
	);
	await entered.promise;
	test.service.mutate(ANDROID);
	release.resolve();

	const result = await action;
	expect(result.dispatch.status).toBe("accepted");
	expect(result.view?.id).toStartWith("s");
	const ref = Object.entries(result.view?.refs ?? {}).find(
		([, id]) => id === "autoplay",
	)?.[0];
	const next = await Effect.runPromise(
		test.service.act(ANDROID, [{ type: "tap", target: `@${ref}` }]),
	);
	expect(next.dispatch.status).toBe("accepted");
});

test("app operations use dispatch, foreground verification, and fresh AX", async () => {
	const test = await start({
		apps: { [ANDROID]: ["com.before", "com.after", "com.after"] },
	});
	await test.client.observeDevice(ANDROID);

	const result = await Effect.runPromise(
		test.service.operation(
			ANDROID,
			Effect.succeed(undefined),
			{
				kind: "foreground_app",
				operation: "launch",
				expected: "com.after",
			},
		),
	);

	expect(result.dispatch.status).toBe("accepted");
	expect(result.verification).toMatchObject({
		status: "matched",
		observed: { foregroundApp: "com.after" },
	});
	expect(result.accessibility.status).toBe("ok");
	expect(result.captureReason).toBe("foreground_changed");
});

test("an unavailable app operation is refused before dispatch", async () => {
	const test = await start();

	const result = await Effect.runPromise(
		test.service.operation(
			ANDROID,
			Effect.fail(
				new CommandUnavailable({ message: "App operations are unavailable." }),
			),
			{
				kind: "foreground_app",
				operation: "launch",
				expected: "com.after",
			},
		),
	);

	expect(result.dispatch).toEqual({
		status: "none",
		reason: "App operations are unavailable.",
	});
	expect(result.captureReason).toBeNull();
});


test("the post-action read waits for the screen to stop changing", async () => {
	// The first read after input still shows the old screen; the next two agree.
	const { client, reads } = await start({
		trees: {
			[ANDROID]: [androidSignInSnapshot, androidSignInSnapshot, changedTree, changedTree],
		},
	});
	const before = (await client.observeDevice(ANDROID)) as {
		view: { refs: Record<string, string> };
	};
	const ref = Object.entries(before.view.refs).find(
		([, id]) => id === "autoplay",
	)![0];
	const readsBefore = reads.get(ANDROID) ?? 0;

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: `@${ref}` },
	])) as {
		settled: boolean;
		settledMs: number;
		view: { refs: Record<string, string> };
		verification: { observed: Record<string, unknown> };
	};

	expect(result.settled).toBe(true);
	expect(result.settledMs).toBeGreaterThanOrEqual(250);
	expect(Object.values(result.view.refs)).toContain("dismiss");
	expect((reads.get(ANDROID) ?? 0) - readsBefore).toBeGreaterThanOrEqual(3);
});

test("a screen that keeps changing reports an unsettled read at the limit", async () => {
	const pages = Array.from({ length: 12 }, (_unused, index) => ({
		...androidSignInSnapshot,
		elements: [
			...androidSignInSnapshot.elements,
			axElement("0.3", "android.widget.TextView", {
				id: `tick-${index}`,
				label: `Tick ${index}`,
				frame: { x: 40, y: 1800, width: 400, height: 120 },
			}),
		],
	}));
	const { client } = await start({ trees: { [ANDROID]: pages } });
	const before = (await client.observeDevice(ANDROID)) as {
		view: { refs: Record<string, string> };
	};
	const ref = Object.entries(before.view.refs).find(
		([, id]) => id === "autoplay",
	)![0];

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: `@${ref}` },
	])) as { settled: boolean; settledMs: number };

	expect(result.settled).toBe(false);
	expect(result.settledMs).toBe(1500);
});

test("a watched tap samples from dispatch, before the settle read", async () => {
	const { client, events } = await start({
		trees: { [ANDROID]: [androidSignInSnapshot, androidSignInSnapshot] },
	});
	const before = (await client.observeDevice(ANDROID)) as {
		view: { refs: Record<string, string> };
	};
	const ref = Object.entries(before.view.refs).find(
		([, id]) => id === "autoplay",
	)![0];
	events.length = 0;

	const result = (await client.actDevice(
		ANDROID,
		[{ type: "tap", target: `@${ref}` }],
		{ watch: { durationMs: 50, samples: 3 } },
	)) as {
		dispatch: { status: string };
		watch: { frames: unknown[]; sheets: unknown[] };
		settled: boolean;
	};

	expect(result.dispatch.status).toBe("accepted");
	expect(result.watch.frames).toHaveLength(3);
	expect(result.watch.sheets).toHaveLength(1);
	// The check before dispatch reads, then the sampler runs, then the
	// post-action read waits the screen out.
	expect(events.slice(0, 5)).toEqual([
		"read",
		"screenshot",
		"screenshot",
		"screenshot",
		"read",
	]);
});

test("a refused tap never samples", async () => {
	const { client, events, screenshots } = await start();
	await client.observeDevice(ANDROID);
	const shots = screenshots.get(ANDROID) ?? 0;
	events.length = 0;

	const result = (await client.actDevice(
		ANDROID,
		[{ type: "tap", target: "@e999999" }],
		{ watch: { durationMs: 0, samples: 4 } },
	)) as { dispatch: { status: string }; watch?: unknown };

	expect(result.dispatch.status).toBe("none");
	expect(result.watch).toBeUndefined();
	expect(screenshots.get(ANDROID) ?? 0).toBe(shots);
	expect(events).toEqual([]);
});

test("an app launch watches the screen the launch fills", async () => {
	const test = await start({
		apps: { [ANDROID]: ["com.before", "com.after", "com.after"] },
	});
	await test.client.observeDevice(ANDROID);
	test.events.length = 0;

	const result = await Effect.runPromise(
		test.service.operation(
			ANDROID,
			Effect.succeed(undefined),
			{
				kind: "foreground_app",
				operation: "launch",
				expected: "com.after",
			},
			{ watch: { durationMs: 0, samples: 2 } },
		),
	);

	expect(result.dispatch.status).toBe("accepted");
	expect(result.watch?.frames).toHaveLength(2);
	expect(test.events.slice(0, 3)).toEqual([
		"screenshot",
		"screenshot",
		"read",
	]);
});

test("a refusal performs no settle reads", async () => {
	const { client, reads } = await start();
	await client.observeDevice(ANDROID);
	const readsBefore = reads.get(ANDROID) ?? 0;

	const result = (await client.actDevice(ANDROID, [
		{ type: "tap", target: "@e999999" },
	])) as { dispatch: { status: string }; settledMs?: number };

	expect(result.dispatch.status).toBe("none");
	expect(result.settledMs).toBeUndefined();
	expect(reads.get(ANDROID) ?? 0).toBe(readsBefore);
});
