import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { makeDeviceActionRunner } from "../../../../core/tools/actions";
import type { AxSnapshot } from "../../../../core/tools/observe/accessibility-model";
import { observeDevice } from "../../../../core/tools/observe/observe";
import { createSnapshotStore } from "../../../../core/tools/observe/snapshot-store";
import {
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_SCROLL_DURATION_MS,
	defaultScrollContainer,
	scrollDevice,
	scrollItem,
	scrollItemKey,
	scrollTravel,
	type ScrollRequest,
	type ScrollResult,
} from "../../../../core/tools/scroll";
import { axElement, androidSignInSnapshot } from "../../../fixtures/ax-view-snapshots";
import { usablePng } from "../../../fixtures/capture-images";

const DEVICE = "android:emulator-5554";
const PORTRAIT = { width: 1080, height: 2400, orientation: "portrait" };
const LANDSCAPE = { width: 2400, height: 1080, orientation: "landscape_left" };

/** A list of rows, so a page of a scroll is easy to write out. */
function listSnapshot(
	rows: readonly string[],
	options: {
		screen?: { width: number; height: number };
		box?: { x: number; y: number; width: number; height: number };
		scrollable?: boolean;
	} = {},
): AxSnapshot {
	const screen = options.screen ?? { width: 1080, height: 2400 };
	const box = options.box ?? { x: 0, y: 400, width: 1080, height: 1600 };
	return {
		screen,
		elements: [
			axElement("0", "android.widget.FrameLayout", {
				id: "root",
				frame: { x: 0, y: 0, width: screen.width, height: screen.height },
				windowId: 1,
				windowLayer: 1,
				windowActive: true,
			}),
			axElement("0.0", "androidx.recyclerview.widget.RecyclerView", {
				id: "tasks",
				testId: "com.example:id/tasks",
				frame: box,
				...(options.scrollable === false ? {} : { traits: ["scrollable"] }),
			}),
			...rows.map((row, index) =>
				axElement(`0.0.${index}`, "android.widget.TextView", {
					id: `row-${row}`,
					label: row,
					frame: {
						x: box.x,
						y: box.y + index * 160,
						width: box.width,
						height: 120,
					},
				}),
			),
		],
	};
}

function publish(snapshot: AxSnapshot, screen = PORTRAIT) {
	const store = createSnapshotStore();
	const view = store.publishObservation(store.beginObservation(DEVICE), {
		platform: "android",
		snapshot,
		screen,
		app: "com.example.app",
		all: false,
	});
	if (!view) throw new Error("Expected a published observation");
	return { store, view };
}

function harness(
	trees: readonly AxSnapshot[],
	screen: { width: number; height: number; orientation: string } = PORTRAIT,
) {
	const store = createSnapshotStore();
	const frames: Array<Record<string, unknown>> = [];
	let read = 0;
	let page = 0;
	let platform: "android" | "ios" = "android";
	const dependencies = {
		store,
		readForegroundApp: () => Effect.succeed("com.example.app"),
		resolveSession: () =>
			Effect.succeed({
				platform,
				dispatchInputFrame: async (data: Buffer) => {
					const frame = JSON.parse(data.subarray(1).toString());
					frames.push(frame);
					// A page turns when the finger lifts, not when the tree is read.
					if (frame.type === "end") page += 1;
				},
				captureScreenshot: async () => ({
					bytes: usablePng(screen.width, screen.height),
					mimeType: "image/png",
					capturedAt: 1,
				}),
				readConfig: async () => screen,
				readAccessibility: async () => {
					read += 1;
					return trees[page] ?? trees.at(-1);
				},
			}),
	};
	const runner = makeDeviceActionRunner(dependencies, () => Effect.void);
	return {
		store,
		frames,
		reads: () => read,
		platform: (value: "android" | "ios") => {
			platform = value;
		},
		observe: async () => {
			const observation = await Effect.runPromise(
				observeDevice(dependencies, DEVICE, { screenshot: false }),
			);
			if (!observation.view) throw new Error("Expected an observation view");
			return observation.view;
		},
		run: (request: ScrollRequest): Promise<ScrollResult> =>
			Effect.runPromise(
				scrollDevice({ ...dependencies, act: runner }, DEVICE, request),
			),
	};
}

describe("scroll geometry", () => {
	const box = { x: 0, y: 1000, width: 1080, height: 1000 };

	test("a vertical scroll travels the middle of the region", () => {
		expect(scrollTravel(box, "down")).toEqual({
			from: { x: 540, y: 1700 },
			to: { x: 540, y: 1300 },
		});
		expect(scrollTravel(box, "up")).toEqual({
			from: { x: 540, y: 1300 },
			to: { x: 540, y: 1700 },
		});
	});

	test("a horizontal scroll travels the same span on x", () => {
		expect(scrollTravel(box, "right")).toEqual({
			from: { x: 756, y: 1500 },
			to: { x: 324, y: 1500 },
		});
		expect(scrollTravel(box, "left")).toEqual({
			from: { x: 324, y: 1500 },
			to: { x: 756, y: 1500 },
		});
	});

	test("the default amount is the 70% to 30% span", () => {
		expect(scrollTravel(box, "down", DEFAULT_SCROLL_AMOUNT)).toEqual(
			scrollTravel(box, "down"),
		);
		expect(scrollTravel(box, "down", DEFAULT_SCROLL_AMOUNT).from.y).toBe(1700);
	});

	test("the amount scales the travel and stays inside the region", () => {
		expect(scrollTravel(box, "down", 20)).toEqual({
			from: { x: 540, y: 1600 },
			to: { x: 540, y: 1400 },
		});
		const full = scrollTravel(box, "down", 100);
		expect(full.from.y).toBe(1990);
		expect(full.to.y).toBe(1010);
	});
});

describe("scroll container", () => {
	test("the largest scrollable region of the screen wins", () => {
		const { view } = publish(androidSignInSnapshot);
		expect(defaultScrollContainer(view, androidSignInSnapshot)).toMatchObject({
			role: "list",
			source: "scrollable",
			box: { x: 0, y: 1000, width: 1080, height: 1000 },
		});
	});

	test("a screen with nothing scrollable falls back to the whole screen", () => {
		const flat: AxSnapshot = {
			screen: { width: 1080, height: 2400 },
			elements: [
				axElement("0", "android.widget.LinearLayout", {
					id: "root",
					frame: { x: 0, y: 0, width: 1080, height: 2400 },
				}),
				axElement("0.0", "android.widget.TextView", {
					id: "title",
					label: "Alpha",
					frame: { x: 40, y: 100, width: 1000, height: 120 },
				}),
			],
		};
		const { view } = publish(flat);
		expect(defaultScrollContainer(view, flat)).toMatchObject({
			role: "screen",
			source: "screen",
			ref: null,
			box: { x: 0, y: 0, width: 1080, height: 2400 },
		});
	});

	test("a landscape region keeps its own box and travel", () => {
		const landscape = listSnapshot(["Alpha", "Beta"], {
			screen: { width: 2400, height: 1080 },
			box: { x: 200, y: 100, width: 2000, height: 800 },
		});
		const { view } = publish(landscape, LANDSCAPE);
		const container = defaultScrollContainer(view, landscape);
		expect(container.box).toEqual({
			x: 200,
			y: 100,
			width: 2000,
			height: 800,
		});
		expect(scrollTravel(container.box, "down")).toEqual({
			from: { x: 1200, y: 660 },
			to: { x: 1200, y: 340 },
		});
	});

	test("a node outside the active window is never the default region", () => {
		const behind = listSnapshot(["Alpha", "Beta"]);
		const snapshot: AxSnapshot = {
			screen: behind.screen,
			elements: [
				...behind.elements,
				axElement("1", "android.widget.FrameLayout", {
					id: "sheet",
					frame: { x: 0, y: 1200, width: 1080, height: 1200 },
					windowId: 2,
					windowLayer: 2,
					windowActive: true,
				}),
				axElement("1.0", "android.widget.ScrollView", {
					id: "sheet-scroll",
					label: "Sheet",
					traits: ["scrollable"],
					frame: { x: 0, y: 1200, width: 1080, height: 1100 },
				}),
			],
		};
		const { view } = publish(snapshot);
		expect(defaultScrollContainer(view, snapshot)).toMatchObject({
			role: "scrollview",
			label: "Sheet",
			box: { x: 0, y: 1200, width: 1080, height: 1100 },
		});
	});
});

describe("scroll dispatch", () => {
	test("one call swipes the default region with no capture ID", async () => {
		const scroll = harness([androidSignInSnapshot]);

		const result = await scroll.run({ direction: "down" });

		expect(result.container).toMatchObject({ role: "list", source: "scrollable" });
		expect(result.from).toEqual({ x: 540, y: 1700 });
		expect(result.to).toEqual({ x: 540, y: 1300 });
		expect(result.durationMs).toBe(DEFAULT_SCROLL_DURATION_MS);
		expect(result.swipes).toBe(1);
		expect(result.action.dispatch.status).toBe("accepted");
		expect(result.action.resolved[0]).toMatchObject({
			type: "swipe",
			from: { pixels: { x: 540, y: 1700 }, role: "list" },
			to: { pixels: { x: 540, y: 1300 } },
		});
		const begin = scroll.frames.at(0);
		const end = scroll.frames.at(-1);
		expect(begin).toMatchObject({ type: "begin" });
		expect(begin?.y).toBeCloseTo(1700 / 2400, 5);
		expect(end).toMatchObject({ type: "end" });
		expect(end?.y).toBeCloseTo(1300 / 2400, 5);
	});

	test("--in scrolls the named region", async () => {
		const scroll = harness([listSnapshot(["Alpha", "Beta"])]);

		const result = await scroll.run({
			direction: "down",
			in: "com.example:id/tasks",
		});

		expect(result.container).toMatchObject({
			source: "target",
			role: "list",
			path: "0.0",
		});
		expect(result.from).toEqual({ x: 540, y: 1520 });
		expect(result.to).toEqual({ x: 540, y: 880 });
	});

	test("--in takes a ref from the observation the agent already read", async () => {
		const scroll = harness([listSnapshot(["Alpha", "Beta"])]);
		const observed = await scroll.observe();
		const list = observed.nodes
			.flatMap((node) => [node, ...node.children])
			.find((node) => node.role === "list");
		expect(list).toBeDefined();

		const result = await scroll.run({
			direction: "down",
			in: `@${list!.ref}`,
		});

		expect(result.container).toMatchObject({
			source: "target",
			ref: list!.ref,
			path: "0.0",
		});
		// The snapshot the agent read is reused, so a scroll adds no extra read.
		// The agent's own observe, the post-action read, and one settle read.
		// No extra read happens before dispatch.
		expect(scroll.reads()).toBe(3);
	});

	test("--in accepts an iOS list, which reports no scrollable trait", async () => {
		const table: AxSnapshot = {
			screen: { width: 402, height: 874 },
			elements: [
				axElement("0.0", "Table", {
					id: "tasks",
					label: "Tasks",
					frame: { x: 0, y: 100, width: 402, height: 600 },
				}),
				axElement("0.0.0", "StaticText", {
					id: "row-1",
					label: "Buy milk",
					frame: { x: 20, y: 120, width: 360, height: 40 },
				}),
			],
		};
		const scroll = harness([table], {
			width: 402,
			height: 874,
			orientation: "portrait",
		});
		scroll.platform("ios");

		const result = await scroll.run({ direction: "down", in: "Tasks" });

		expect(result.container).toMatchObject({
			source: "target",
			role: "list",
			label: "Tasks",
			box: { x: 0, y: 100, width: 402, height: 600 },
		});
		expect(result.from).toEqual({ x: 201, y: 520 });
	});

	test("an unknown region is refused before any input", async () => {
		const scroll = harness([listSnapshot(["Alpha"])]);

		await expect(
			scroll.run({ direction: "down", in: "Missing region" }),
		).rejects.toThrow(/no node matches "Missing region"/);
		expect(scroll.frames).toEqual([]);
	});

	test("a scroll that changes nothing reports no new page", async () => {
		const page = listSnapshot(["Alpha", "Beta"]);
		const scroll = harness([page, page]);

		const result = await scroll.run({ direction: "down" });

		expect(result.pages).toBe(0);
		expect(result.endReached).toBe(true);
		expect(result.swipes).toBe(1);
	});
});

describe("scroll to the end", () => {
	test("it stops when two pages in a row match", async () => {
		const first = listSnapshot(["Alpha", "Beta"]);
		const second = listSnapshot(["Gamma", "Delta"]);
		const last = listSnapshot(["Epsilon"]);
		const scroll = harness([first, second, last, last, last]);

		const result = await scroll.run({ direction: "down", toEnd: true });

		expect(result.pages).toBe(3);
		// One repeated page can be an absorbed swipe; the end needs two.
		expect(result.swipes).toBe(4);
		expect(result.endReached).toBe(true);
	});

	test("one absorbed swipe does not end the region", async () => {
		const first = listSnapshot(["Alpha"]);
		const second = listSnapshot(["Beta"]);
		const scroll = harness([first, first, second, second, second]);

		const result = await scroll.run({ direction: "down", toEnd: true });

		expect(result.pages).toBe(2);
		expect(result.endReached).toBe(true);
		expect(result.items).toBeNull();
	});

	test("the page limit stops a region that never settles", async () => {
		const pages = [1, 2, 3, 4, 5, 6].map((index) =>
			listSnapshot([`Row ${index}`]),
		);
		const scroll = harness(pages);

		const result = await scroll.run({
			direction: "down",
			toEnd: true,
			maxPages: 3,
		});

		expect(result.swipes).toBe(3);
		expect(result.endReached).toBe(false);
	});

	test("collect unions overlapping pages into one deduplicated list", async () => {
		const first = listSnapshot(["Alpha", "Beta", "Gamma"]);
		const second = listSnapshot(["Gamma", "Delta", "Epsilon"]);
		const third = listSnapshot(["Epsilon", "Zeta"]);
		const scroll = harness([first, second, third, third]);

		const result = await scroll.run({
			direction: "down",
			toEnd: true,
			collect: "text",
		});

		expect(result.pages).toBe(3);
		expect(result.endReached).toBe(true);
		expect(result.selector).toBe("text");
		expect(result.count).toBe(6);
		expect(result.items?.map((item) => item.text)).toEqual([
			"Alpha",
			"Beta",
			"Gamma",
			"Delta",
			"Epsilon",
			"Zeta",
		]);
	});

	test("collect without --to-end reads the page the scroll moved to", async () => {
		const scroll = harness([
			listSnapshot(["Alpha", "Beta"]),
			listSnapshot(["Gamma"]),
		]);

		const result = await scroll.run({ direction: "down", collect: "text" });

		expect(result.pages).toBe(1);
		expect(result.count).toBe(1);
		expect(result.items?.map((item) => item.text)).toEqual(["Gamma"]);
	});

	test("the scrolled container is never one of its own rows", async () => {
		const scroll = harness([
			listSnapshot(["Alpha"]),
			listSnapshot(["Alpha", "Beta"]),
		]);

		const result = await scroll.run({
			direction: "down",
			collect: "com.example:id/tasks",
		});

		expect(result.count).toBe(0);
		expect(result.items).toEqual([]);
	});

	test("rows that share a title but differ below it stay distinct", () => {
		const row = (title: string, subtitle: string) =>
			({
				ref: `e${title}${subtitle}`,
				id: `${title}${subtitle}`,
				path: `0.${title}${subtitle}`,
				role: "generic",
				rawRole: "android.view.ViewGroup",
				label: title,
				value: "",
				states: [],
				box: { x: 0, y: 0, width: 100, height: 40 },
				point: { x: 0.5, y: 0.1 },
				children: [
					{
						ref: `e${title}${subtitle}s`,
						id: `${title}${subtitle}s`,
						path: `0.${title}${subtitle}.0`,
						role: "text",
						rawRole: "android.widget.TextView",
						label: subtitle,
						value: "",
						states: [],
						box: { x: 0, y: 20, width: 100, height: 20 },
						point: { x: 0.5, y: 0.15 },
						children: [],
					},
				],
			}) as never;
		const keys = new Set(
			[row("Rent", "$1,200"), row("Rent", "$1,350")].map((node) =>
				scrollItemKey(scrollItem(node)),
			),
		);
		expect(keys.size).toBe(2);
	});
});
