import { describe, expect, test } from "bun:test";
import {
	axRoleOf,
	axStatesOf,
	buildAxView,
	flattenAxView,
	type AxPlatform,
	type AxViewNode,
} from "../../../../../core/tools/observe/ax-view";
import type { AxSnapshot } from "../../../../../core/tools/observe/accessibility-model";
import {
	androidSignInSnapshot,
	axElement,
	iosSettingsSnapshot,
} from "../../../../fixtures/ax-view-snapshots";

function view(
	snapshot: AxSnapshot,
	platform: AxPlatform,
	options: { all?: boolean; screen?: { width: number; height: number } } = {},
) {
	let next = 0;
	return buildAxView({
		snapshot,
		platform,
		screen: options.screen ?? snapshot.screen,
		all: options.all === true,
		nextRef: () => `e${(next += 1)}`,
	});
}

const byRef = (nodes: AxViewNode[]): Map<string, AxViewNode> =>
	new Map(flattenAxView(nodes).map((node) => [node.ref, node]));

describe("role mapping", () => {
	test("Android classes map to the ARIA names", () => {
		const cases: Array<[string, string]> = [
			["android.widget.EditText", "textbox"],
			["android.widget.Button", "button"],
			["android.widget.ImageButton", "button"],
			["android.widget.TextView", "text"],
			["android.widget.ImageView", "image"],
			["android.widget.Switch", "switch"],
			["android.widget.ToggleButton", "switch"],
			["android.widget.CheckBox", "checkbox"],
			["android.widget.RadioButton", "checkbox"],
			["android.widget.SeekBar", "slider"],
			["android.widget.Spinner", "combobox"],
			["android.webkit.WebView", "webview"],
			["androidx.recyclerview.widget.RecyclerView", "list"],
			["android.widget.ScrollView", "scrollview"],
			["android.view.ViewGroup", "generic"],
		];
		for (const [type, role] of cases)
			expect(axRoleOf(axElement("0", type), "android")).toBe(role);
	});

	test("an Android password field is a securetextbox", () => {
		const element = axElement("0", "android.widget.EditText", {
			traits: ["password"],
		});
		expect(axRoleOf(element, "android")).toBe("securetextbox");
	});

	test("iOS roles map to the same names", () => {
		const cases: Array<[string, string]> = [
			["Button", "button"],
			["TextField", "textbox"],
			["SecureTextField", "securetextbox"],
			["StaticText", "text"],
			["Cell", "cell"],
			["ScrollArea", "scrollview"],
			["Link", "link"],
			["Slider", "slider"],
			["WebArea", "webview"],
			["Group", "generic"],
		];
		for (const [type, role] of cases)
			expect(axRoleOf(axElement("0", type), "ios")).toBe(role);
	});
});

describe("states", () => {
	test("Android reports the states the dump gives", () => {
		expect(
			axStatesOf(
				axElement("0", "android.widget.CheckBox", {
					traits: [
						"focused",
						"checkable",
						"checked",
						"selected",
						"clickable",
						"scrollable",
						"long press",
					],
					visibleToUser: false,
					enabled: false,
				}),
			),
		).toEqual([
			"focused",
			"disabled",
			"checked",
			"selected",
			"clickable",
			"scrollable",
			"long-press",
			"offscreen",
		]);
	});

	test("a checkable node that is not checked reads unchecked", () => {
		expect(
			axStatesOf(
				axElement("0", "android.widget.CheckBox", { traits: ["checkable"] }),
			),
		).toEqual(["unchecked"]);
	});

	test("a generic clickable node stays and exposes native clickability", () => {
		const result = view(
			{
				screen: { width: 1080, height: 2400 },
				elements: [
					axElement("0", "android.view.ViewGroup", {
						id: "item-root",
						testId: "item_root",
						traits: ["clickable"],
					}),
					axElement("0.0", "android.widget.TextView", {
						id: "item-label",
						label: "task.html",
					}),
				],
			},
			"android",
		);
		expect(result.nodes[0]).toMatchObject({
			id: "item-root",
			role: "generic",
			states: ["clickable"],
		});
		expect(result.nodes[0]?.children[0]).toMatchObject({
			id: "item-label",
			role: "text",
			states: [],
		});
	});

	test("iOS reports only the states the bridge gives", () => {
		expect(axStatesOf(axElement("0", "Button", { enabled: false }))).toEqual([
			"disabled",
		]);
		expect(axStatesOf(axElement("0", "Button"))).toEqual([]);
	});
});

describe("pruning", () => {
	const result = view(androidSignInSnapshot, "android");
	const nodes = byRef(result.nodes);

	test("named and interactive nodes stay", () => {
		const labels = flattenAxView(result.nodes).map((node) => node.label);
		expect(labels).toContain("Email");
		expect(labels).toContain("Sign in");
		expect(labels).toContain("Autoplay");
	});

	test("a text child that repeats its parent label is dropped", () => {
		const signIn = [...nodes.values()].filter(
			(node) => node.label === "Sign in",
		);
		expect(signIn).toHaveLength(1);
		expect(signIn[0]!.role).toBe("button");
	});

	test("an unnamed container with no kept descendant is dropped", () => {
		expect(
			flattenAxView(result.nodes).some((node) => node.id === "spacer"),
		).toBe(false);
	});

	test("an unnamed container with one child collapses into the child", () => {
		const collapsed = view(
			{
				screen: { width: 100, height: 100 },
				elements: [
					axElement("0", "android.widget.FrameLayout"),
					axElement("0.0", "android.widget.LinearLayout"),
					axElement("0.0.0", "android.widget.Button", { label: "Go" }),
				],
			},
			"android",
		);
		expect(collapsed.nodes).toHaveLength(1);
		expect(collapsed.nodes[0]).toMatchObject({ role: "button", label: "Go" });
	});

	test("an irrelevant full-screen iOS root collapses into its child", () => {
		const collapsed = view(
			{
				screen: { width: 402, height: 874 },
				elements: [
					axElement("0", "Application", {
						id: "app-root",
						frame: { x: 0, y: 0, width: 402, height: 874 },
					}),
					axElement("0.0", "Button", { label: "Continue" }),
				],
			},
			"ios",
		);

		expect(flattenAxView(collapsed.nodes).map((node) => node.id)).toEqual([
			"node:0.0",
		]);
	});

	test("a container with several kept children holds the structure", () => {
		expect(result.nodes).toHaveLength(1);
		expect(result.nodes[0]!.children.map((node) => node.role)).toEqual([
			"generic",
			"list",
		]);
	});

	test("the counts report what was dropped", () => {
		expect(result.total).toBe(androidSignInSnapshot.elements.length);
		expect(result.shown).toBeLessThan(result.total);
		expect(Object.keys(result.refs)).toHaveLength(result.shown);
	});

	test("--all keeps every element", () => {
		const all = view(androidSignInSnapshot, "android", { all: true });
		expect(all.shown).toBe(all.total);
	});

	test("a scrollable node stays even without a label", () => {
		const list = [...nodes.values()].find((node) => node.id === "list");
		expect(list?.states).toContain("scrollable");
	});
});

describe("frames", () => {
	test("boxes scale from the accessibility space into screenshot pixels", () => {
		const result = view(iosSettingsSnapshot, "ios", {
			screen: { width: 1206, height: 2622 },
		});
		const back = flattenAxView(result.nodes).find(
			(node) => node.label === "Back",
		);
		expect(back?.box).toEqual({ x: 30, y: 60, width: 120, height: 120 });
		expect(back?.point.x).toBeCloseTo((10 + 40 / 2) / 402, 5);
		expect(back?.point.y).toBeCloseTo((20 + 40 / 2) / 874, 5);
	});

	test("iOS keeps the value after the colon and the disabled state", () => {
		const result = view(iosSettingsSnapshot, "ios");
		const nodes = flattenAxView(result.nodes);
		expect(nodes.find((node) => node.id === "title")?.value).toBe("Settings");
		expect(nodes.find((node) => node.id === "secret")).toMatchObject({
			role: "securetextbox",
			states: ["disabled"],
		});
	});
});

describe("warnings", () => {
	test("large and deep trees do not produce guessed truncation warnings", () => {
		const elements = Array.from({ length: 650 }, (_, index) =>
			axElement(`0.${index}`, "StaticText", { value: `row ${index}` }),
		);
		const ios = view(
			{ screen: { width: 402, height: 874 }, elements },
			"ios",
		);
		const path = Array.from({ length: 91 }, (_, index) => index).join(".");
		const android = view(
			{
				screen: { width: 1080, height: 2400 },
				elements: [
					axElement(path, "android.widget.TextView", { label: "deep" }),
				],
			},
			"android",
		);

		expect(ios.warnings).toEqual([]);
		expect(android.warnings).toEqual([]);
	});

	test("collector errors travel with the warnings", () => {
		const result = view(
			{
				screen: { width: 1, height: 1 },
				elements: [],
				errors: ["UIAutomator returned no accessibility elements"],
			},
			"android",
		);
		expect(result.warnings).toEqual([
			"UIAutomator returned no accessibility elements",
		]);
	});
});
