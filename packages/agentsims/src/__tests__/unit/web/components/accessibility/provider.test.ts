import { describe, expect, test } from "bun:test";
import {
	AX_UNAVAILABLE_ERROR,
	type AxSnapshot,
} from "../../../../../accessibility/model";
import {
	axRefreshEndpoint,
	decodeAxSnapshotEvent,
	reconcileAxSnapshot,
} from "../../../../../web/components/accessibility/provider";

describe("decodeAxSnapshotEvent", () => {
	test("skips an identical replay before parsing or replacing the tree", () => {
		const replay = "{not-valid-json";
		expect(decodeAxSnapshotEvent(replay, replay)).toBeNull();
	});

	test("decodes a changed snapshot and derives its status once", () => {
		const payload = JSON.stringify({
			screen: { width: 1080, height: 2424 },
			elements: [
				{
					id: "composer",
					path: "0",
					label: "Ask Vartalaap",
					value: "",
					role: "android.widget.EditText",
					type: "android.widget.EditText",
					enabled: true,
					frame: { x: 60, y: 2100, width: 960, height: 110 },
				},
			],
		});

		const result = decodeAxSnapshotEvent(payload, null);
		expect(result?.payload).toBe(payload);
		expect(result?.snapshot.elements).toHaveLength(1);
		expect(result?.status).toBe("1 AX elements");
	});

	test("preserves the unavailable status contract", () => {
		const payload = JSON.stringify({
			screen: { width: 1, height: 1 },
			elements: [],
			errors: [AX_UNAVAILABLE_ERROR],
		});

		expect(decodeAxSnapshotEvent(payload, null)?.status).toBe("AX unavailable");
	});

	test("surfaces native capture errors instead of reporting an empty tree", () => {
		const payload = JSON.stringify({
			screen: { width: 1080, height: 2424 },
			elements: [],
			errors: ["UIAutomator timed out"],
		});

		expect(decodeAxSnapshotEvent(payload, null)?.status).toBe(
			"UIAutomator timed out",
		);
	});

	test("reuses the full snapshot when a new payload is semantically identical", () => {
		const previous: AxSnapshot = {
			screen: { width: 1080, height: 2424 },
			elements: [
				{
					id: "composer",
					path: "0.4",
					label: "Ask Vartalaap",
					value: "",
					role: "android.widget.EditText",
					type: "android.widget.EditText",
					enabled: true,
					frame: { x: 60, y: 2100, width: 960, height: 110 },
					source: {
						kind: "react-native",
						confidence: "exact-testid",
						testID: "composer",
						componentName: "Textarea",
						file: "components/composer.tsx",
						line: 93,
						ownerStack: ["Composer", "ChatScreen"],
					},
				},
			],
		};
		const parsedAgain = JSON.parse(JSON.stringify(previous)) as AxSnapshot;

		expect(reconcileAxSnapshot(previous, parsedAgain)).toBe(previous);
	});

	test("reuses unchanged element objects when only one AX node changes", () => {
		const previous: AxSnapshot = {
			screen: { width: 390, height: 844 },
			elements: [
				{
					id: "title",
					path: "0.0",
					label: "New thread",
					value: "",
					role: "text",
					type: "StaticText",
					enabled: true,
					frame: { x: 120, y: 60, width: 150, height: 24 },
				},
				{
					id: "clock",
					path: "0.1",
					label: "10:25",
					value: "",
					role: "text",
					type: "StaticText",
					enabled: true,
					frame: { x: 12, y: 12, width: 44, height: 18 },
				},
			],
		};
		const next: AxSnapshot = {
			screen: { width: 390, height: 844 },
			elements: [
				{ ...previous.elements[0]!, frame: { ...previous.elements[0]!.frame } },
				{ ...previous.elements[1]!, label: "10:26" },
			],
		};

		const reconciled = reconcileAxSnapshot(previous, next);
		expect(reconciled).not.toBe(previous);
		expect(reconciled.elements[0]).toBe(previous.elements[0]);
		expect(reconciled.elements[1]).toBe(next.elements[1]);
		expect(reconciled.screen).toBe(previous.screen);
	});
});

describe("axRefreshEndpoint", () => {
	test("preserves the selected device query", () => {
		expect(axRefreshEndpoint("/.sim/ax?device=android%3Aemulator-5554")).toBe(
			"/.sim/ax/refresh?device=android%3Aemulator-5554",
		);
	});
});
