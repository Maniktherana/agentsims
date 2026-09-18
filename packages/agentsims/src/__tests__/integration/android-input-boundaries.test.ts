import { describe, expect, test } from "bun:test";
import { collectAndroidAxSnapshot } from "../../core/android/accessibility/snapshot";
import { androidKeycodeForHidUsage } from "../../core/android/device/input";
import { AndroidSession } from "../../core/android/session/session";
import { textToKeyEvents } from "../../core/ios/text-to-keys";
import { createSnapshotStore } from "../../core/tools/observe/snapshot-store";
import { resolveTarget } from "../../core/tools/observe/targets";

const DEVICE = "android:emulator-5554";

async function resolvedPoint(input: {
	xml: string;
	width: number;
	height: number;
	orientation: string;
	target: string;
}) {
	const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
		readXml: async () => input.xml,
		screen: { width: input.width, height: input.height },
	});
	const store = createSnapshotStore();
	const observation = store.publishObservation(store.beginObservation(DEVICE), {
		platform: "android",
		snapshot,
		screen: {
			width: input.width,
			height: input.height,
			orientation: input.orientation,
		},
		app: "com.example",
		all: true,
	});
	if (!observation) throw new Error("Observation was not published");
	return { snapshot, point: resolveTarget(store, DEVICE, { target: input.target }) };
}

function keyFrame(type: "down" | "up", usage: number): Buffer {
	return Buffer.concat([
		Buffer.from([0x06]),
		Buffer.from(JSON.stringify({ type, usage })),
	]);
}

describe("Android native input boundaries", () => {
	test("keeps AX controls in full-display coordinates when the app root is resized", async () => {
		const portrait = await resolvedPoint({
			xml: '<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,1600]"><node text="Save" class="android.widget.Button" clickable="true" bounds="[720,1280][960,1400]"/><node text="Negative" class="android.widget.TextView" bounds="[-100,-40][100,40]"/><node text="Outside" class="android.widget.TextView" bounds="[1000,2300][1200,2500]"/></node></hierarchy>',
			width: 1080,
			height: 2400,
			orientation: "portrait",
			target: "Save",
		});

		expect(portrait.snapshot.screen).toEqual({ width: 1080, height: 2400 });
		expect(portrait.point.pixels).toEqual({ x: 840, y: 1340 });
		expect(portrait.point.y).toBeCloseTo(1340 / 2400);
		expect(
			portrait.snapshot.elements.find((element) => element.label === "Negative")
				?.frame,
		).toEqual({ x: 0, y: 0, width: 100, height: 40 });
		expect(
			portrait.snapshot.elements.find((element) => element.label === "Outside")
				?.frame,
		).toEqual({ x: 1000, y: 2300, width: 80, height: 100 });

		const landscape = await resolvedPoint({
			xml: '<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][2400,700]"><node text="Save" class="android.widget.Button" clickable="true" bounds="[1800,500][2200,650]"/></node></hierarchy>',
			width: 2400,
			height: 1080,
			orientation: "landscape_left",
			target: "Save",
		});
		expect(landscape.snapshot.screen).toEqual({ width: 2400, height: 1080 });
		expect(landscape.point.pixels).toEqual({ x: 2000, y: 575 });
		expect(landscape.point.y).toBeCloseTo(575 / 1080);
	});

	test("sends complete text key phases through the Android helper boundary", async () => {
		const calls: Array<{ phase: "down" | "up"; keycode: number }> = [];
		const session = new AndroidSession("emulator-5554", {
			readScreenConfig: async () => ({
				width: 1080,
				height: 2400,
				orientation: "portrait",
				rotation: 0,
			}),
			warmAx: async () => {},
			keyDevice: async (_serial, phase, keycode) => {
				calls.push({ phase, keycode });
			},
		});
		await session.start();

		const text = "A:+_?file:///sdcard/Download/task.htmlz";
		const events = textToKeyEvents(text);
		for (const event of events)
			await session.dispatchInputFrame(keyFrame(event.type, event.usage));

		expect(calls).toEqual(
			events.map((event) => ({
				phase: event.type,
				keycode: androidKeycodeForHidUsage(event.usage),
			})),
		);
		expect(calls.slice(-2)).toEqual([
			{ phase: "down", keycode: 54 },
			{ phase: "up", keycode: 54 },
		]);
		await session.close();
	});
});
