import { describe, expect, test } from "bun:test";
import { LiveAnnotationStore } from "../../../../web/annotation/live-controller";
import type {
	LiveAnnotationOptions,
	LiveAnnotationSummaryController,
} from "../../../../web/annotation/live-contracts";
import {
	endWorkspaceAnnotationMode,
	escapeWorkspaceAnnotationMode,
} from "../../../../web/annotation/workspace-mode";

function device(platform: "ios" | "android") {
	let restored = 0;
	const viewportX = platform === "ios" ? 100 : 500;
	const identity = {
		device: platform === "ios" ? "ios-one" : "android:one",
		platform,
		sessionId: `browser-view:${platform}`,
		app: null,
		orientation: "portrait" as const,
	};
	const options: LiveAnnotationOptions = {
		active: false,
		identity,
		cache: null,
		geometry: {
			viewport: { x: viewportX, y: 40, width: 300, height: 600 },
			image: { width: 900, height: 1800 },
			axScreen: { width: 300, height: 600 },
		},
		nativePreview: {
			identity,
			connected: true,
			status: "1 AX elements",
			snapshot: {
				screen:
					platform === "ios"
						? { width: 300, height: 600 }
						: { width: 900, height: 1800 },
				elements: [
					{
						id: `${platform}-button`,
						path: "0",
						label: platform === "ios" ? "Like" : "Continue",
						value: "",
						role: "button",
						type: platform === "ios" ? "Button" : "android.widget.Button",
						enabled: true,
						frame:
							platform === "ios"
								? { x: 20, y: 50, width: 80, height: 40 }
								: { x: 60, y: 150, width: 240, height: 120 },
					},
				],
			},
		},
		capturePresentedSurface: () => ({
			src: `data:image/png;base64,${btoa(platform)}`,
			width: 900,
			height: 1800,
			blob: new Blob([platform], { type: "image/png" }),
		}),
		onEndSelection: () => {
			restored++;
		},
		workspace: "workspace",
		contextClient: {
			create: async () => ({ id: `context:${platform}` }),
			update: async () => undefined,
			save: async () => undefined,
			remove: async () => undefined,
		},
	};
	const store = new LiveAnnotationStore(() => options);
	return {
		options,
		store,
		restored: () => restored,
		point: { x: viewportX + 40, y: 110 },
	};
}

function summary(
	fixture: ReturnType<typeof device>,
): LiveAnnotationSummaryController {
	const snapshot = fixture.store.getSnapshot();
	return {
		device: snapshot.device,
		editorId: snapshot.editor?.id ?? null,
		comments: snapshot.comments,
		status: snapshot.status,
		copying: snapshot.copying,
		sending: snapshot.sending,
		canSend: snapshot.canSend,
		editNote: fixture.store.editNote,
		closeEditor: fixture.store.closeEditor,
		endSelection: fixture.store.endSelection,
		removeNote: fixture.store.removeNote,
		prepareSendPayload: fixture.store.prepareSendPayload,
	};
}

function workspace() {
	const ios = device("ios"),
		android = device("android");
	const devices = [ios, android];
	return {
		ios,
		android,
		devices,
		summaries: () => devices.map(summary),
		setActive: (active: boolean) => {
			for (const fixture of devices) {
				fixture.options.active = active;
				fixture.store.syncOptions();
			}
		},
	};
}

describe("workspace annotation mode", () => {
	test("one activation blocks both platforms and each phone previews its own native target", () => {
		const fixture = workspace();
		for (const device of fixture.devices)
			expect(device.store.getSnapshot().inputDisabled).toBe(false);
		fixture.setActive(true);
		for (const device of fixture.devices) {
			expect(device.store.getSnapshot().inputDisabled).toBe(true);
			expect(device.store.getSnapshot().selecting).toBe(true);
			device.store.hover(device.point);
			expect(device.store.getSnapshot().hoverTarget?.viewportRect).toEqual({
				x: device.options.geometry!.viewport.x + 20,
				y: 90,
				width: 80,
				height: 40,
			});
		}
		fixture.android.store.hover(fixture.ios.point);
		expect(fixture.android.store.getSnapshot().hoverTarget).toBeNull();
		expect(fixture.ios.store.getSnapshot().hoverTarget).not.toBeNull();
	});

	for (const reversed of [false, true]) {
		test(`Escape closes another phone's editor before releasing input regardless of listener order (${reversed})`, () => {
			const fixture = workspace();
			fixture.setActive(true);
			fixture.android.store.select(fixture.android.point);
			fixture.android.store.setNote("Android draft");
			const evidence = fixture.android.store.getSnapshot().editor!.evidence;
			const controllers = fixture.summaries();
			if (reversed) controllers.reverse();
			expect(escapeWorkspaceAnnotationMode(controllers)).toBe("editor-closed");
			expect(fixture.android.store.getSnapshot().editor).toBeNull();
			for (const device of fixture.devices) {
				expect(device.store.getSnapshot().inputDisabled).toBe(true);
				expect(device.restored()).toBe(0);
			}
			expect(fixture.ios.store.getSnapshot().comments).toHaveLength(0);
			expect(fixture.android.store.getSnapshot().comments[0]!.evidence).toBe(
				evidence,
			);
			expect(escapeWorkspaceAnnotationMode(fixture.summaries())).toBe(
				"mode-ended",
			);
			for (const device of fixture.devices) {
				expect(device.store.getSnapshot().inputDisabled).toBe(false);
				expect(device.restored()).toBe(1);
			}
			fixture.setActive(false);
			expect(fixture.android.store.getSnapshot().comments[0]!.note).toBe(
				"Android draft",
			);
		});
	}

	test("an empty editor closes first even though it has no summary comment", () => {
		const fixture = workspace();
		fixture.setActive(true);
		fixture.android.store.select(fixture.android.point);
		expect(summary(fixture.android).comments).toHaveLength(0);
		expect(summary(fixture.android).editorId).not.toBeNull();
		expect(escapeWorkspaceAnnotationMode(fixture.summaries())).toBe(
			"editor-closed",
		);
		expect(fixture.android.store.getSnapshot().draft).toBeNull();
		for (const device of fixture.devices)
			expect(device.store.getSnapshot().inputDisabled).toBe(true);
		expect(escapeWorkspaceAnnotationMode(fixture.summaries())).toBe(
			"mode-ended",
		);
		for (const device of fixture.devices)
			expect(device.store.getSnapshot().inputDisabled).toBe(false);
	});

	test("the focused editor closes before other editors and every draft remains with its device", () => {
		const fixture = workspace();
		fixture.setActive(true);
		for (const device of fixture.devices) {
			device.store.select(device.point);
			device.store.setNote(device.options.identity.device);
		}
		expect(
			escapeWorkspaceAnnotationMode(fixture.summaries(), "android:one"),
		).toBe("editor-closed");
		expect(fixture.android.store.getSnapshot().editor).toBeNull();
		expect(fixture.ios.store.getSnapshot().editor).not.toBeNull();
		expect(escapeWorkspaceAnnotationMode(fixture.summaries())).toBe(
			"editor-closed",
		);
		expect(escapeWorkspaceAnnotationMode(fixture.summaries())).toBe(
			"mode-ended",
		);
		for (const device of fixture.devices) {
			expect(device.store.getSnapshot().comments).toHaveLength(1);
			expect(device.store.getSnapshot().comments[0]!.note).toBe(
				device.options.identity.device,
			);
			expect(device.store.getSnapshot().inputDisabled).toBe(false);
		}
	});

	test("ending mode from a dock action restores all inputs and reentry preserves comments", () => {
		const fixture = workspace();
		fixture.setActive(true);
		fixture.ios.store.select(fixture.ios.point);
		fixture.ios.store.setNote("iOS saved note");
		fixture.ios.store.saveDraft();
		fixture.android.store.select(fixture.android.point);
		fixture.android.store.setNote("Android retained draft");
		endWorkspaceAnnotationMode(fixture.summaries());
		for (const device of fixture.devices) {
			expect(device.store.getSnapshot().inputDisabled).toBe(false);
			expect(device.store.getSnapshot().editor).toBeNull();
			expect(device.restored()).toBe(1);
		}
		fixture.setActive(false);
		fixture.setActive(true);
		for (const device of fixture.devices) {
			expect(device.store.getSnapshot().inputDisabled).toBe(true);
			expect(device.store.getSnapshot().comments).toHaveLength(1);
			expect(device.store.getSnapshot().editor).toBeNull();
		}
		expect(fixture.ios.store.getSnapshot().notes[0]!.note).toBe(
			"iOS saved note",
		);
		expect(fixture.android.store.getSnapshot().draft!.note).toBe(
			"Android retained draft",
		);
	});
});
