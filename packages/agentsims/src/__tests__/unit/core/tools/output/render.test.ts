import { expect, test } from "bun:test";
import type { ActionResult } from "../../../../../core/tools/actions";
import type {
	DeviceObservation,
	DeviceScreenshot,
} from "../../../../../core/tools/observe/observe";
import type {
	DeviceWait,
	DeviceWatch,
} from "../../../../../core/tools/observe/watch";
import type { ScrollResult } from "../../../../../core/tools/scroll";
import type { SequenceResult } from "../../../../../core/tools/sequence";
import {
	renderActionResult,
	renderCommandOutput,
	renderMatches,
	renderObservation,
	renderScreenshot,
	renderScrollResult,
	renderSequenceResult,
	renderWait,
	renderWatch,
} from "../../../../../core/tools/output/render";

const context = {
	app: "com.example.app",
	orientation: "portrait",
	generation: 3,
	changedDuringCapture: false,
	before: { status: "ok" as const, capturedAt: 1, value: null },
	after: { status: "ok" as const, capturedAt: 2, value: null },
};

const observation: DeviceObservation = {
	device: "UDID-A",
	platform: "ios",
	startedAt: 1,
	completedAt: 2,
	observationId: "s1",
	captureId: "c1",
	accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
	image: { status: "error", capturedAt: 1, error: "No image" },
	context,
	view: null,
	warnings: [],
};

const screenshot: DeviceScreenshot = {
	device: "UDID-A",
	platform: "ios",
	startedAt: 1,
	completedAt: 2,
	observationId: null,
	captureId: "c1",
	image: { status: "error", capturedAt: 1, error: "No image" },
	context,
	warnings: [],
};

const action: ActionResult = {
	device: "UDID-A",
	dispatch: { status: "accepted", reason: "Input frames were accepted." },
	verification: {
		status: "matched",
		reason: "The target changed its checked state.",
		observed: { checked: { before: false, after: true } },
	},
	resolved: [{ type: "tap", from: { x: 0.5, y: 0.5, ref: "e3" } }],
	accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
	view: null,
	image: null,
	captureReason: null,
	warnings: [],
};

const matches = {
	device: "UDID-A",
	snapshot: "s1",
	query: "Save",
	nodes: [],
};

const wait: DeviceWait = {
	device: "UDID-A",
	platform: "ios",
	condition: { kind: "for", text: "Saved" },
	satisfied: true,
	startedAt: 1,
	elapsedMs: 120,
	polls: 2,
	timeoutMs: 5000,
	intervalMs: 250,
	observation,
	warnings: [],
};

const watch: DeviceWatch = {
	device: "UDID-A",
	platform: "ios",
	startedAt: 1,
	completedAt: 2,
	durationMs: 1000,
	requestedSamples: 4,
	requestedIntervalMs: 250,
	achievedIntervalMs: 260,
	frames: [],
	sheets: [],
	observation,
	warnings: [],
};

const sequence: SequenceResult = {
	device: "UDID-A",
	steps: [
		{ index: 0, action: { type: "tap", target: "Save" }, result: action },
	],
	stoppedAt: null,
	completed: 1,
	total: 1,
};

const scroll: ScrollResult = {
	device: "UDID-A",
	direction: "down",
	container: { role: "list", label: "Recipes", ref: "e4" },
	from: { x: 100, y: 800 },
	to: { x: 100, y: 200 },
	amount: 80,
	durationMs: 300,
	swipes: 1,
	pages: 1,
	endReached: false,
	selector: null,
	count: null,
	items: null,
	action,
};

test.each([
	["observe", observation, () => renderObservation(observation, null)],
	["screenshot", screenshot, () => renderScreenshot(screenshot, null)],
	["find", matches, () => renderMatches(matches)],
	["wait", wait, () => renderWait(wait)],
	[
		"watch",
		watch,
		() => renderWatch(watch, { sheets: [], frames: [] }),
	],
	["run", sequence, () => renderSequenceResult(sequence)],
	["scroll", scroll, () => renderScrollResult(scroll)],
	["tap", action, () => renderActionResult(action)],
	["app:launch", action, () => renderActionResult(action)],
] as const)(
	"%s renders as the CLI renders it without artifacts",
	(command, result, cli) => {
		expect(renderCommandOutput(command, result)).toBe(cli());
	},
);

test("a command without a renderer prints its payload as JSON", () => {
	const apps = [{ bundleId: "com.example.app", name: "Example" }];
	expect(renderCommandOutput("app:list", apps)).toBe(
		JSON.stringify(apps, null, 2),
	);
});
