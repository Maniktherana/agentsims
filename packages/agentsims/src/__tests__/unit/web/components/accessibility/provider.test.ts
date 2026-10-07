import { describe, expect, test } from "bun:test";
import {
	AX_UNAVAILABLE_ERROR,
	type AxSnapshot,
} from "../../../../../core/tools/observe/accessibility-model";
import {
	axRefreshEndpoint,
	decodeAxSnapshotEvent,
	reconcileAxSnapshot,
} from "../../../../../web/components/accessibility/provider";

describe("decodeAxSnapshotEvent", () => {
	const usableSnapshot = (platform: "android" | "ios"): AxSnapshot => ({
		screen:
			platform === "android"
				? { width: 1080, height: 2424 }
				: { width: 390, height: 844 },
		elements: [
			{
				id: "title",
				path: "0.1",
				label: "Home",
				value: "",
				role: "text",
				type: platform === "android" ? "android.widget.TextView" : "StaticText",
				enabled: true,
				frame: { x: 20, y: 60, width: 120, height: 24 },
			},
		],
	});

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

	test("decodes the actual killed Android server error without a synthetic ready count", () => {
		const nativeError = "Android AX server exited (137): Killed";
		const result = decodeAxSnapshotEvent(
			JSON.stringify({
				screen: { width: 1080, height: 2424 },
				elements: [],
				errors: [nativeError],
			}),
			null,
		);
		expect(result?.status).toBe(nativeError);
		expect(result?.snapshot.errors).toEqual([nativeError]);
		expect(result?.snapshot.elements).toHaveLength(0);
		expect(result?.lastUsableSnapshot).toBeNull();
	});

	for (const platform of ["android", "ios"] as const) {
		test(`${platform}: retains the last usable tree separately from failed current data, then recovers`, () => {
			const ready = decodeAxSnapshotEvent(
				JSON.stringify(usableSnapshot(platform)),
				null,
			)!;
			expect(ready.lastUsableSnapshot).toBe(ready.snapshot);
			const errors = ["Native capture stopped", "No current hierarchy"];
			const failed = decodeAxSnapshotEvent(
				JSON.stringify({
					screen: { width: 1, height: 1 },
					elements: [],
					errors,
				}),
				ready.payload,
				ready.lastUsableSnapshot,
			)!;
			expect(failed.snapshot.elements).toHaveLength(0);
			expect(failed.snapshot.errors).toEqual(errors);
			expect(failed.lastUsableSnapshot).toBe(ready.snapshot);
			expect(failed.lastUsableSnapshot?.screen).toEqual(ready.snapshot.screen);
			const recovered = usableSnapshot(platform);
			recovered.elements[0]!.label = "Next screen";
			const next = decodeAxSnapshotEvent(
				JSON.stringify(recovered),
				failed.payload,
				failed.lastUsableSnapshot,
			)!;
			expect(next.lastUsableSnapshot).toBe(next.snapshot);
			expect(next.snapshot.errors).toBeUndefined();
			expect(next.lastUsableSnapshot?.elements[0]!.label).toBe("Next screen");
		});
	}

	test("partial failures keep their actual nodes but do not replace the last usable tree", () => {
		const previous = usableSnapshot("android");
		const partial = usableSnapshot("android");
		partial.elements[0]!.label = "Partial result";
		partial.errors = ["One window could not be read"];
		const next = decodeAxSnapshotEvent(
			JSON.stringify(partial),
			null,
			previous,
		)!;
		expect(next.snapshot.elements[0]!.label).toBe("Partial result");
		expect(next.snapshot.errors).toEqual(partial.errors);
		expect(next.lastUsableSnapshot).toBe(previous);
	});

	test("a new endpoint starts without retained evidence from a different device", () => {
		const first = decodeAxSnapshotEvent(
			JSON.stringify(usableSnapshot("ios")),
			null,
		)!;
		const otherDevice = decodeAxSnapshotEvent(
			JSON.stringify({
				screen: { width: 1080, height: 2424 },
				elements: [],
				errors: ["Android AX server exited (137): Killed"],
			}),
			null,
		)!;
		expect(first.lastUsableSnapshot?.elements).toHaveLength(1);
		expect(otherDevice.lastUsableSnapshot).toBeNull();
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
