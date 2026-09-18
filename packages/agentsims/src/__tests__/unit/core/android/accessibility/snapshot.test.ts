import { describe, expect, test } from "bun:test";
import { collectAndroidAxSnapshot } from "../../../../../core/android/accessibility/snapshot";

const SCREEN = { width: 1080, height: 2400 };

function xml(attributes: string): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<hierarchy rotation="0">',
		'<node class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">',
		`<node class="android.widget.EditText" bounds="[40,240][1040,360]" ${attributes}></node>`,
		"</node>",
		"</hierarchy>",
	].join("");
}

async function field(attributes: string) {
	const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
		readXml: async () => xml(attributes),
		screen: SCREEN,
	});
	return snapshot.elements[1]!;
}

async function snapshotFromXml(value: string) {
	return collectAndroidAxSnapshot("emulator-5554", {
		readXml: async () => value,
		screen: SCREEN,
	});
}

describe("Android accessibility elements", () => {
	test("the helper's extra attributes land as element details", async () => {
		const snapshot = await snapshotFromXml(
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<hierarchy rotation="0">',
				'<node class="androidx.recyclerview.widget.RecyclerView" bounds="[0,0][1080,2400]" scrollable="true" collection-rows="30" collection-cols="1" actions="scroll-forward">',
				'<node class="android.widget.LinearLayout" content-desc="Butternut Squash Soup" bounds="[0,100][1080,300]" clickable="true" item-row="4" item-col="0" actions="expand,dismiss"></node>',
				'<node class="android.widget.EditText" bounds="[0,400][1080,500]" editable="true" text="Email" hint-text="true" labeled-by="Work email" error="Required" selection-start="0" selection-end="0" max-length="64"></node>',
				'<node class="android.widget.Switch" content-desc="Wi-Fi" bounds="[0,600][1080,700]" checkable="true" checked="true" state-desc="On" tooltip="Toggle wireless" heading="true" pane-title="Network"></node>',
				"</node>",
				"</hierarchy>",
			].join(""),
		);
		const [list, item, field, toggle] = snapshot.elements;
		expect(list).toMatchObject({
			collection: { rows: 30, cols: 1 },
			actions: ["scroll-forward"],
		});
		expect(item).toMatchObject({
			item: { row: 4, col: 0 },
			actions: ["expand", "dismiss"],
		});
		expect(field).toMatchObject({
			placeholder: "Email",
			labeledBy: "Work email",
			error: "Required",
			selection: { start: 0, end: 0 },
			maxLength: 64,
		});
		expect(toggle).toMatchObject({
			state: "On",
			hint: "Toggle wireless",
			heading: true,
			paneTitle: "Network",
		});
	});

	test("a ranged control reports its current, minimum, and maximum", async () => {
		const snapshot = await snapshotFromXml(
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<hierarchy rotation="0">',
				'<node class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">',
				'<node class="android.widget.SeekBar" content-desc="Display brightness" bounds="[42,357][1038,483]" range-current="238" range-min="0" range-max="255"></node>',
				'<node class="android.widget.Button" text="Done" bounds="[0,600][200,700]"></node>',
				"</node>",
				"</hierarchy>",
			].join(""),
		);
		expect(snapshot.elements[1]).toMatchObject({
			label: "Display brightness",
			range: { current: 238, min: 0, max: 255 },
		});
		expect(snapshot.elements[2]).not.toHaveProperty("range");
	});

	test("the hint of an empty field is its name, not its value", async () => {
		const node = await field('text="Search settings" editable="true" hint-text="true"');

		expect(node.label).toBe("Search settings");
		expect(node.value).toBe("");
		expect(node.traits).toContain("editable");
	});

	test("a filled field reports its value and keeps its description", async () => {
		expect(await field('text="hello" editable="true"')).toMatchObject({
			label: "",
			value: "hello",
		});
		expect(
			await field('text="hello" editable="true" content-desc="Search"'),
		).toMatchObject({ label: "Search", value: "hello" });
	});

	test("a node that is not editable still reads its text as its name", async () => {
		expect(await field('text="Sign in"')).toMatchObject({
			label: "Sign in",
			value: "Sign in",
		});
	});

	test("preserves native identity from the helper snapshot", async () => {
		expect(
			await field(
				'text="hello" resource-id="com.example:id/email" window-id="11" source-id="37"',
			),
		).toMatchObject({
			id: "11:37",
			testId: "com.example:id/email",
			windowId: 11,
			sourceId: 37,
		});
	});

	test("uses the supplied display while preserving window state", async () => {
		let screenConfigReads = 0;
		const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
			readXml: async () =>
				'<hierarchy><node window-id="42" window-layer="3" window-type="1" window-active="true" window-focused="true" class="android.widget.FrameLayout" visible-to-user="true" bounds="[0,0][1080,2424]"><node text="Ask" resource-id="app:id/composer" class="android.widget.EditText" visible-to-user="false" clickable="true" focusable="true" bounds="[60,2100][1020,2210]" /></node></hierarchy>',
			readScreenConfig: async () => {
				screenConfigReads += 1;
				return { width: 1, height: 1, orientation: "portrait" };
			},
			screen: { width: 1080, height: 2400 },
		});

		expect(screenConfigReads).toBe(0);
		expect(snapshot.screen).toEqual({ width: 1080, height: 2400 });
		expect(snapshot.elements[0]).toMatchObject({
			windowId: 42,
			windowLayer: 3,
			windowType: 1,
			windowActive: true,
			windowFocused: true,
		});
		expect(snapshot.elements[1]).toMatchObject({
			label: "Ask",
			nativeId: "app:id/composer",
			visibleToUser: false,
			traits: ["clickable", "focusable"],
		});
	});

	test("keeps structural paths and clamps elements to the display", async () => {
		const snapshot = await snapshotFromXml(
			'<hierarchy><node window-id="10" window-type="1" class="android.widget.FrameLayout" bounds="[0,0][1080,2424]"><node class="android.view.ViewGroup" visible-to-user="false" bounds="[0,0][0,0]"><node text="Nested" class="android.widget.Button" clickable="true" bounds="[-40,2100][1120,4288]" /></node></node></hierarchy>',
		);

		expect(snapshot.elements.map((element) => element.path)).toEqual([
			"0",
			"0.0",
			"0.0.0",
		]);
		expect(snapshot.elements[1]?.frame).toEqual({
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		});
		expect(snapshot.elements[2]?.frame).toEqual({
			x: 0,
			y: 2100,
			width: 1080,
			height: 300,
		});
	});

	test("keeps base paths stable while another window is open", async () => {
		const base =
			'<node class="android.widget.FrameLayout" bounds="[0,0][1080,2424]"><node text="Composer" class="android.widget.EditText" bounds="[60,2100][1020,2210]" /></node>';
		const sheet =
			'<node class="android.widget.FrameLayout" bounds="[0,900][1080,2424]"><node text="Close" class="android.widget.Button" bounds="[40,940][240,1040]" /></node>';
		const open = await snapshotFromXml(`<hierarchy>${base}${sheet}</hierarchy>`);
		const closed = await snapshotFromXml(`<hierarchy>${base}</hierarchy>`);

		expect(open.elements.find((element) => element.label === "Composer")?.path).toBe(
			"0.0",
		);
		expect(
			closed.elements.find((element) => element.label === "Composer")?.path,
		).toBe("0.0");
		expect(open.elements.find((element) => element.label === "Close")?.path).toBe(
			"1.0",
		);
	});

	test("uses screen config only when the native tree fails", async () => {
		let screenConfigReads = 0;
		const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
			readXml: async () => {
				throw new Error("AX timed out");
			},
			readScreenConfig: async () => {
				screenConfigReads += 1;
				return { width: 1080, height: 2424, orientation: "portrait" };
			},
		});

		expect(screenConfigReads).toBe(1);
		expect(snapshot).toMatchObject({
			screen: { width: 1080, height: 2424 },
			elements: [],
			errors: ["AX timed out"],
		});
	});

	test("forwards the requested helper mode without starting a fallback", async () => {
		const calls: string[] = [];
		const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
			mode: "settled",
			readFastXml: async (_serial, mode) => {
				calls.push(`fast:${mode}`);
				throw new Error("helper unavailable");
			},
			readFallbackXml: async () => {
				calls.push("fallback");
				return "<hierarchy />";
			},
			screen: SCREEN,
		});

		expect(calls).toEqual(["fast:settled"]);
		expect(snapshot.errors).toEqual(["helper unavailable"]);
	});

	test("keeps every element after the former 500-node limit", async () => {
		const children = Array.from(
			{ length: 650 },
			(_, index) =>
				`<node text="row ${index}" class="android.widget.TextView" bounds="[0,${index + 1}][100,${index + 2}]"/>`,
		).join("");
		const snapshot = await snapshotFromXml(
			`<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">${children}</node></hierarchy>`,
		);

		expect(snapshot.elements).toHaveLength(651);
		expect(snapshot.elements.at(-1)?.path).toBe("0.649");
	});

	test("keeps descendants after the former depth-80 limit", async () => {
		const depth = 90;
		const open = Array.from(
			{ length: depth + 1 },
			(_, index) =>
				`<node text="depth ${index}" class="android.view.View" bounds="[0,${index}][100,${index + 1}]">`,
		).join("");
		const snapshot = await snapshotFromXml(
			`<hierarchy>${open}${"</node>".repeat(depth + 1)}</hierarchy>`,
		);

		expect(snapshot.elements).toHaveLength(depth + 1);
		expect(snapshot.elements.at(-1)?.path.split(".")).toHaveLength(depth + 1);
	});
});
