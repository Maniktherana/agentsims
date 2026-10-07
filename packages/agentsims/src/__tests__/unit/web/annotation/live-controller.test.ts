import { describe, expect, test } from "bun:test";
import { LiveAnnotationStore } from "../../../../web/annotation/live-controller";
import { copyWorkspaceAnnotationNotes } from "../../../../web/annotation/copy";
import type {
	AnnotationSendPayload,
	LiveAnnotationOptions,
	LiveAnnotationSummaryController,
} from "../../../../web/annotation/live-contracts";
import { prepareAnnotationCache } from "../../../../web/annotation/selection";
import {
	annotationCapturedTargetRect,
	annotationEditorKeyAction,
	prepareWorkspaceAnnotationSend,
	workspaceAnnotationComments,
} from "../../../../web/annotation/presentation";

function setup(platform: "ios" | "android" = "ios") {
	let frame = "first";
	let captureCount = 0;
	let restored = 0;
	let contexts = 0;
	const calls: { name: string; value?: unknown }[] = [];
	const copies: AnnotationSendPayload[] = [];
	const options: LiveAnnotationOptions = {
		active: true,
		identity: {
			device: platform === "ios" ? "ios-1" : "android:one",
			platform,
			sessionId: "actual-session",
			app: null,
			orientation: "portrait",
		},
		cache: null,
		geometry: {
			viewport: { x: 100, y: 40, width: 300, height: 600 },
			image: { width: 900, height: 1800 },
			axScreen: { width: 300, height: 600 },
		},
		capturePresentedSurface: () => {
			captureCount++;
			return {
				src: `data:image/png;base64,${btoa(frame)}`,
				width: 900,
				height: 1800,
				blob: new Blob([frame], { type: "image/png" }),
			};
		},
		onEndSelection: () => {
			restored++;
		},
		now: () => 2000,
		workspace: "test-workspace",
		contextClient: {
			create: async (workspace, input, requestId) => {
				calls.push({ name: "create", value: { workspace, input, requestId } });
				return { id: `server-context-${++contexts}` };
			},
			update: async (_workspace, _id, note) => {
				calls.push({ name: "update", value: note });
			},
			save: async () => {
				calls.push({ name: "save" });
			},
			remove: async () => {
				calls.push({ name: "remove" });
			},
		},
		copy: async (payload) => {
			copies.push(payload);
		},
	};
	const store = new LiveAnnotationStore(() => options);
	return {
		store,
		options,
		calls,
		copies,
		frame: (next: string) => {
			frame = next;
		},
		captureCount: () => captureCount,
		restored: () => restored,
	};
}
const point = { x: 140, y: 110 };
async function settle() {
	for (let index = 0; index < 20; index++) await Promise.resolve();
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((finish) => {
		resolve = finish;
	});
	return { promise, resolve };
}

function summary(
	fixture: ReturnType<typeof setup>,
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
		clearCopiedNotes: fixture.store.clearCopiedNotes,
		prepareSendPayload: fixture.store.prepareSendPayload,
	};
}

describe("workspace annotation Copy", () => {
	for (const platform of ["ios", "android"] as const) {
		test(`${platform}: copies saved screenshots without a host capability and clears only after success`, async () => {
			const fixture = setup(platform);
			fixture.options.deviceName =
				platform === "ios" ? "iPhone 17" : "Pixel 10";
			fixture.store.select(point);
			fixture.store.setNote("Make it red");
			fixture.store.closeEditor();
			const image = fixture.store.getSnapshot().comments[0]!.evidence.image;
			const finishCopy = deferred();
			const copyEntered = deferred();
			let copied: AnnotationSendPayload | null = null;
			const operation = copyWorkspaceAnnotationNotes(
				[summary(fixture)],
				() => [summary(fixture)],
				{
					exportImages: async (payload) => {
						expect(payload.retainedContext?.ids).toEqual(["server-context-1"]);
						return new Map(
							payload.images.map((entry) => [
								entry.id,
								`/tmp/actual-captured-${entry.id}.png`,
							]),
						);
					},
					copy: async (payload) => {
						copied = payload;
						copyEntered.resolve();
						await finishCopy.promise;
					},
				},
			);
			await copyEntered.promise;
			expect(fixture.store.getSnapshot().comments).toHaveLength(1);
			expect(copied!.images[0]!.base64).toBe(image.base64);
			expect(copied!.prompt).toContain(fixture.options.deviceName!);
			expect(copied!.prompt).toContain("/tmp/actual-captured-");
			expect(copied!.prompt).not.toContain("Captured:");
			expect(copied!.prompt).not.toContain("attachment 1");
			finishCopy.resolve();
			await operation;
			expect(fixture.store.getSnapshot().comments).toHaveLength(0);
			expect(fixture.store.getSnapshot().editor).toBeNull();
		});
	}
	test("failed image export or clipboard write retains every comment", async () => {
		for (const phase of ["export", "clipboard"] as const) {
			const fixture = setup();
			fixture.store.select(point);
			fixture.store.setNote("Retain this");
			const before = fixture.store.getSnapshot().comments;
			await expect(
				copyWorkspaceAnnotationNotes(
					[summary(fixture)],
					() => [summary(fixture)],
					{
						exportImages: async (payload) => {
							if (phase === "export") throw new Error("Export failed");
							return new Map(
								payload.images.map((entry) => [entry.id, "/tmp/captured.png"]),
							);
						},
						copy: async () => {
							throw new Error("Clipboard rejected");
						},
					},
				),
			).rejects.toThrow();
			expect(fixture.store.getSnapshot().comments).toEqual(before);
		}
	});
	test("new and edited comments survive a successful in-flight Copy across devices", async () => {
		const first = setup("ios");
		const second = setup("android");
		second.options.contextClient!.create = async () => ({
			id: "android-context-1",
		});
		for (const fixture of [first, second]) {
			fixture.store.select(point);
			fixture.store.setNote("Original");
			fixture.store.closeEditor();
		}
		const finishCopy = deferred();
		const copyEntered = deferred();
		const operation = copyWorkspaceAnnotationNotes(
			[summary(first), summary(second)],
			() => [summary(first), summary(second)],
			{
				exportImages: async (payload) =>
					new Map(
						payload.images.map((entry) => [entry.id, "/tmp/captured.png"]),
					),
				copy: async () => {
					copyEntered.resolve();
					await finishCopy.promise;
				},
			},
		);
		await copyEntered.promise;
		second.store.editNote(second.store.getSnapshot().comments[0]!.id);
		second.store.setNote("Changed while copying");
		first.store.select(point);
		first.store.setNote("New while copying");
		finishCopy.resolve();
		await operation;
		expect(
			first.store.getSnapshot().comments.map((entry) => entry.note),
		).toEqual(["New while copying"]);
		expect(
			second.store.getSnapshot().comments.map((entry) => entry.note),
		).toEqual(["Changed while copying"]);
	});
	test("remote cleanup failure cannot bring successfully copied notes back", async () => {
		const fixture = setup();
		fixture.options.contextClient!.remove = async () => {
			throw new Error("Cleanup failed");
		};
		fixture.store.select(point);
		fixture.store.setNote("Copied");
		await copyWorkspaceAnnotationNotes(
			[summary(fixture)],
			() => [summary(fixture)],
			{
				exportImages: async (payload) =>
					new Map(
						payload.images.map((entry) => [entry.id, "/tmp/captured.png"]),
					),
				copy: async () => {},
			},
		);
		await settle();
		expect(fixture.store.getSnapshot().comments).toHaveLength(0);
	});
});

describe("live annotation state", () => {
	test("first Escape keeps a commented draft and input blocking; idle Escape restores input with comments retained", async () => {
		const fixture = setup();
		fixture.store.select(point);
		fixture.store.setNote("Keep this unfinished comment");
		fixture.store.escape();
		expect(fixture.store.getSnapshot().editor).toBeNull();
		expect(fixture.store.getSnapshot().inputDisabled).toBe(true);
		expect(fixture.store.getSnapshot().comments).toHaveLength(1);
		expect(fixture.store.getSnapshot().notes).toHaveLength(0);
		expect(fixture.restored()).toBe(0);
		await fixture.store.copyPrompt();
		expect(fixture.copies[0]?.prompt).toContain("Keep this unfinished comment");
		fixture.store.escape();
		expect(fixture.restored()).toBe(1);
		expect(fixture.store.getSnapshot().inputDisabled).toBe(false);
		expect(workspaceAnnotationComments([summary(fixture)])).toHaveLength(1);
	});
	test("an empty draft never becomes a summary comment", () => {
		const fixture = setup();
		fixture.store.select(point);
		expect(workspaceAnnotationComments([summary(fixture)])).toHaveLength(0);
		fixture.store.escape();
		expect(fixture.store.getSnapshot().draft).toBeNull();
		expect(fixture.store.getSnapshot().inputDisabled).toBe(true);
		expect(workspaceAnnotationComments([summary(fixture)])).toHaveLength(0);
	});
	test("summary editing survives activation, and Save keeps annotation input blocked", () => {
		const fixture = setup();
		fixture.store.select(point);
		fixture.store.setNote("Resume me");
		fixture.store.endSelection();
		const id = fixture.store.getSnapshot().comments[0]!.id;
		fixture.options.active = false;
		fixture.store.syncOptions();
		fixture.store.editNote(id);
		fixture.options.active = true;
		fixture.store.syncOptions();
		expect(fixture.store.getSnapshot().editor?.id).toBe(id);
		fixture.store.saveDraft();
		expect(fixture.store.getSnapshot().inputDisabled).toBe(true);
		expect(fixture.store.getSnapshot().notes).toHaveLength(1);
	});
	test("editor Enter saves, Shift Enter adds a line, and composition does not save", () => {
		expect(annotationEditorKeyAction("Enter", false)).toBe("save");
		expect(annotationEditorKeyAction("Enter", true)).toBe("newline");
		expect(annotationEditorKeyAction("Enter", false, true)).toBeNull();
	});
	test("combined review includes drafts from both devices and only actual saved server IDs", async () => {
		const first = setup("ios"),
			second = setup("android");
		for (const [fixture, serverId] of [
			[first, "real-ios-context"],
			[second, "real-android-context"],
		] as const) {
			fixture.options.send = async () => ({ status: "sent" });
			fixture.store.syncOptions();
			fixture.options.contextClient!.create = async () => ({ id: serverId });
			fixture.store.select(point);
			fixture.store.setNote(`Comment on ${fixture.options.identity.device}`);
			fixture.store.closeEditor();
		}
		const payload = await prepareWorkspaceAnnotationSend(
			[summary(first), summary(second)],
			() => [summary(first), summary(second)],
		);
		expect(payload?.retainedContext?.ids).toEqual([
			"real-ios-context",
			"real-android-context",
		]);
		expect(payload?.images).toHaveLength(2);
		expect(payload?.prompt).toContain("ios-1");
		expect(payload?.prompt).toContain("android:one");
		expect(first.calls.filter((call) => call.name === "save")).toHaveLength(1);
		expect(second.calls.filter((call) => call.name === "save")).toHaveLength(1);
		expect(first.store.getSnapshot().draft?.note).toContain("ios-1");
	});
	test("the captured thumbnail rectangle uses immutable screenshot coordinates", () => {
		const fixture = setup();
		fixture.store.select(point);
		fixture.store.setNote("Target");
		const note = fixture.store.getSnapshot().comments[0]!;
		const rect = annotationCapturedTargetRect(note, 64, 96)!;
		expect(rect.x).toBeCloseTo(11.84);
		expect(rect.y).toBeCloseTo(8.64);
		fixture.frame("later");
		expect(annotationCapturedTargetRect(note, 64, 96)).toEqual(rect);
		expect(fixture.captureCount()).toBe(1);
	});
	test("native hover uses exact bounds, updates under a stationary pointer, and captures a fixed region", () => {
		const fixture = setup();
		fixture.options.nativePreview = {
			identity: fixture.options.identity,
			connected: true,
			status: "1 AX elements",
			snapshot: {
				screen: { width: 300, height: 600 },
				elements: [
					{
						id: "native",
						path: "0",
						label: "Like",
						value: "",
						role: "button",
						type: "Button",
						enabled: true,
						frame: { x: 20, y: 50, width: 80, height: 40 },
					},
				],
			},
		};
		fixture.store.syncOptions();
		fixture.store.hover(point);
		expect(fixture.store.getSnapshot().hoverTarget?.viewportRect).toEqual({
			x: 120,
			y: 90,
			width: 80,
			height: 40,
		});
		const first = fixture.store.getSnapshot().hoverTarget;
		fixture.store.hover(point);
		expect(fixture.store.getSnapshot().hoverTarget).toBe(first);
		const next = structuredClone(fixture.options.nativePreview);
		next.snapshot!.elements[0]!.frame.width = 100;
		fixture.options.nativePreview = next;
		fixture.store.syncOptions();
		expect(fixture.store.getSnapshot().hoverTarget?.viewportRect.width).toBe(
			100,
		);
		fixture.store.select(point);
		fixture.store.setNote("Real native bounds");
		fixture.store.saveDraft();
		const note = fixture.store.getSnapshot().notes[0]!;
		expect(note.evidence.target.kind).toBe("region");
		expect(note.evidence.target.rect).toEqual({
			x: 60,
			y: 150,
			width: 300,
			height: 120,
		});
		const captured = fixture.store.noteViewportRect(note);
		fixture.options.nativePreview = structuredClone(next);
		fixture.options.nativePreview.snapshot!.elements[0]!.frame.x = 70;
		fixture.store.syncOptions();
		expect(fixture.store.noteViewportRect(note)).toEqual(captured);
		expect(fixture.captureCount()).toBe(1);
	});
	test("an identity change cannot retag a previous native snapshot as current", () => {
		const fixture = setup();
		fixture.options.nativePreview = {
			identity: fixture.options.identity,
			connected: true,
			status: "1 AX elements",
			snapshot: {
				screen: { width: 300, height: 600 },
				elements: [
					{
						id: "native",
						path: "0",
						label: "Like",
						value: "",
						role: "button",
						type: "Button",
						enabled: true,
						frame: { x: 20, y: 50, width: 80, height: 40 },
					},
				],
			},
		};
		fixture.store.syncOptions();
		fixture.store.hover(point);
		expect(fixture.store.getSnapshot().hoverTarget).not.toBeNull();
		fixture.options.identity = { ...fixture.options.identity, app: "other" };
		fixture.options.nativePreview = {
			...fixture.options.nativePreview,
			identity: fixture.options.identity,
		};
		fixture.store.syncOptions();
		fixture.store.hover(point);
		expect(fixture.store.getSnapshot().hoverTarget).toBeNull();
		fixture.options.nativePreview = structuredClone(
			fixture.options.nativePreview,
		);
		fixture.store.syncOptions();
		fixture.store.hover(point);
		expect(fixture.store.getSnapshot().hoverTarget).not.toBeNull();
		fixture.options.nativePreview = {
			...fixture.options.nativePreview,
			connected: false,
		};
		fixture.store.syncOptions();
		expect(fixture.store.getSnapshot().hoverTarget).toBeNull();
	});
	for (const failure of ["workspace", "duplicate-id", "capability"] as const) {
		test(`aggregate Send rejects ${failure} and retains all comments`, async () => {
			const first = setup("ios"),
				second = setup("android");
			for (const fixture of [first, second]) {
				fixture.options.send = async () => ({ status: "sent" });
				fixture.store.syncOptions();
				fixture.store.select(point);
				fixture.store.setNote("Keep me");
				fixture.store.closeEditor();
			}
			if (failure === "workspace") second.options.workspace = "other";
			// Context workspaces are bound at capture. Start the second comment again if changed.
			if (failure === "workspace") {
				second.store.removeNote(second.store.getSnapshot().comments[0]!.id);
				second.store.select(point);
				second.store.setNote("Other workspace");
				second.store.closeEditor();
			}
			if (failure === "capability") {
				second.options.send = undefined;
				second.store.syncOptions();
			}
			expect(
				await prepareWorkspaceAnnotationSend(
					[summary(first), summary(second)],
					() => [summary(first), summary(second)],
				),
			).toBeNull();
			expect(
				workspaceAnnotationComments([summary(first), summary(second)]),
			).toHaveLength(2);
		});
	}
	for (const platform of ["ios", "android"] as const) {
		test(`${platform}: captures the presented frame at click, before context work, and keeps it through Save`, async () => {
			const fixture = setup(platform);
			expect(fixture.store.getSnapshot().inputDisabled).toBe(true);
			fixture.store.select(point);
			expect(fixture.captureCount()).toBe(1);
			expect(fixture.calls).toHaveLength(0);
			expect(fixture.store.getSnapshot().inputDisabled).toBe(true);
			const evidence = fixture.store.getSnapshot().draft!.evidence;
			expect(evidence.target.kind).toBe("region");
			expect(evidence.target.rect).toEqual({
				x: 72,
				y: 162,
				width: 96,
				height: 96,
			});
			fixture.frame("later");
			fixture.store.setNote("Move this control");
			fixture.store.saveDraft();
			await settle();
			expect(fixture.captureCount()).toBe(1);
			expect(
				atob(fixture.store.getSnapshot().notes[0]!.evidence.image.base64),
			).toBe("first");
			expect(fixture.store.getSnapshot().notes[0]!.evidence).toBe(evidence);
			expect(fixture.calls.map((call) => call.name)).toEqual([
				"create",
				"update",
				"save",
			]);
			expect(fixture.calls[1]!.value).toBe("Move this control");
			expect(Object.isFrozen(evidence.target.rect)).toBe(true);
		});
		test(`${platform}: Escape restores input immediately and retains an unfinished draft`, () => {
			const fixture = setup(platform);
			fixture.store.select(point);
			fixture.store.setNote("Unfinished note");
			const id = fixture.store.getSnapshot().draft!.id;
			fixture.store.endSelection();
			expect(fixture.restored()).toBe(1);
			expect(fixture.store.getSnapshot().inputDisabled).toBe(false);
			expect(fixture.store.getSnapshot().editor).toBeNull();
			expect(fixture.store.getSnapshot().draft?.note).toBe("Unfinished note");
			fixture.options.active = false;
			fixture.store.syncOptions();
			fixture.options.active = true;
			fixture.store.syncOptions();
			expect(fixture.store.getSnapshot().editor).toBeNull();
			fixture.store.editNote(id);
			expect(fixture.store.getSnapshot().editor?.id).toBe(id);
			expect(fixture.captureCount()).toBe(1);
		});
	}

	test("keeps drafts and saved evidence isolated when devices change", async () => {
		const fixture = setup();
		const first = fixture.options.identity;
		fixture.store.select(point);
		fixture.store.setNote("iOS draft");
		fixture.options.identity = {
			...first,
			device: "android:two",
			platform: "android",
		};
		fixture.store.syncOptions();
		expect(fixture.store.getSnapshot().draft).toBeNull();
		fixture.frame("android");
		fixture.store.select(point);
		fixture.store.setNote("Android saved note");
		fixture.store.saveDraft();
		await fixture.store.copyPrompt();
		expect(fixture.copies[0]!.prompt).toContain("Android saved note");
		expect(fixture.store.getSnapshot().notes[0]!.evidence.device).toBe(
			"android:two",
		);
		expect(fixture.copies[0]!.prompt).not.toContain("iOS draft");
		fixture.options.identity = first;
		fixture.store.syncOptions();
		expect(fixture.store.getSnapshot().notes).toHaveLength(0);
		expect(fixture.store.getSnapshot().editor).toBeNull();
		expect(fixture.store.getSnapshot().draft?.note).toBe("iOS draft");
		expect(atob(fixture.store.getSnapshot().draft!.evidence.image.base64)).toBe(
			"first",
		);
	});

	test("reselects against the current cache at click rather than using stale hover", () => {
		const fixture = setup();
		fixture.options.identity.app = "app";
		fixture.options.cache = prepareAnnotationCache(
			{
				...fixture.options.identity,
				revision: 1,
				collectedAt: 1000,
				connected: true,
				dirty: false,
				confirmedUnchanged: false,
			},
			{
				screen: { width: 300, height: 600 },
				elements: [
					{
						id: "button",
						path: "0",
						label: "Button",
						value: "",
						role: "button",
						type: "Button",
						enabled: true,
						frame: { x: 20, y: 50, width: 80, height: 50 },
					},
				],
			},
		);
		fixture.store.hover(point);
		expect(fixture.store.getSnapshot().hoverTarget?.kind).toBe("element");
		fixture.options.cache = null;
		fixture.store.select(point);
		expect(fixture.store.getSnapshot().draft?.selection.kind).toBe("region");
	});

	test("editing a note changes only its text; removal waits for pending context operations", async () => {
		const fixture = setup();
		fixture.store.select(point);
		fixture.store.setNote("Original");
		fixture.store.saveDraft();
		const original = fixture.store.getSnapshot().notes[0]!;
		fixture.store.editNote(original.id);
		fixture.store.setNote("Edited");
		fixture.store.saveDraft();
		expect(fixture.store.getSnapshot().notes[0]!.evidence).toBe(
			original.evidence,
		);
		fixture.store.removeNote(original.id);
		await settle();
		expect(fixture.store.getSnapshot().notes).toHaveLength(0);
		expect(fixture.calls.map((call) => call.name)).toEqual([
			"create",
			"update",
			"save",
			"update",
			"save",
			"remove",
		]);
	});

	test("keeps local notes and copy usable after context failure without retrying capture", async () => {
		const fixture = setup();
		let creates = 0;
		fixture.options.contextClient!.create = async () => {
			creates++;
			throw new Error("offline");
		};
		fixture.store.select(point);
		fixture.store.setNote("Retained offline");
		await settle();
		fixture.store.saveDraft();
		await fixture.store.copyPrompt();
		await settle();
		expect(fixture.store.getSnapshot().notes).toHaveLength(1);
		expect(fixture.copies[0]!.prompt).toContain("Retained offline");
		expect(creates).toBe(1);
		expect(fixture.captureCount()).toBe(1);
	});

	for (const outcome of [
		"sent",
		"unavailable",
		"failed",
		"unknown",
		"throw",
	] as const)
		test(`explicit Send (${outcome}) retains notes and never retries`, async () => {
			const fixture = setup();
			let sends = 0;
			fixture.options.send = async () => {
				sends++;
				if (outcome === "throw") throw new Error("lost receipt");
				return { status: outcome };
			};
			fixture.store.syncOptions();
			fixture.store.select(point);
			fixture.store.setNote("Fix this");
			fixture.store.saveDraft();
			await settle();
			expect(sends).toBe(0);
			await fixture.store.sendPrompt();
			await settle();
			expect(sends).toBe(1);
			expect(fixture.store.getSnapshot().notes).toHaveLength(1);
			await fixture.store.copyPrompt();
			expect(fixture.copies).toHaveLength(1);
		});

	test("does not advertise or invoke Send without a host capability", async () => {
		const fixture = setup();
		fixture.store.select(point);
		fixture.store.setNote("Standalone");
		fixture.store.saveDraft();
		expect(fixture.store.getSnapshot().canSend).toBe(false);
		await fixture.store.sendPrompt();
		expect(fixture.store.getSnapshot().notes).toHaveLength(1);
		expect(fixture.store.getSnapshot().status).toContain("unavailable");
	});

	test("copies detached click-time evidence and retains notes when clipboard access fails", async () => {
		const fixture = setup();
		fixture.store.select(point);
		fixture.store.setNote("Copy this target");
		fixture.store.saveDraft();
		fixture.frame("current-screen");
		await fixture.store.copyPrompt();
		expect(atob(fixture.copies[0]!.images[0]!.base64)).toBe("first");
		expect(Object.isFrozen(fixture.copies[0]!.images[0])).toBe(true);
		fixture.options.copy = async () => {
			throw new Error("Permission denied");
		};
		await fixture.store.copyPrompt();
		expect(fixture.store.getSnapshot().notes).toHaveLength(1);
		expect(fixture.store.getSnapshot().status).toContain("retained");
		expect(fixture.captureCount()).toBe(1);
	});

	test("restores a note after failed removal so the user can retry explicitly", async () => {
		const fixture = setup();
		let removals = 0;
		fixture.options.contextClient!.remove = async () => {
			removals++;
			if (removals === 1) throw new Error("offline");
		};
		fixture.store.select(point);
		fixture.store.setNote("Keep until removal succeeds");
		fixture.store.saveDraft();
		const id = fixture.store.getSnapshot().notes[0]!.id;
		fixture.store.removeNote(id);
		await settle();
		expect(removals).toBe(1);
		expect(fixture.store.getSnapshot().notes[0]!.id).toBe(id);
		fixture.store.removeNote(id);
		await settle();
		expect(removals).toBe(2);
		expect(fixture.store.getSnapshot().notes).toHaveLength(0);
	});

	test("late host receipts remain on the originating phone", async () => {
		const fixture = setup();
		let finish!: (value: { status: "unknown" }) => void;
		fixture.options.send = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		fixture.store.select(point);
		fixture.store.setNote("iOS evidence");
		fixture.store.saveDraft();
		const pending = fixture.store.sendPrompt();
		await settle();
		const original = fixture.options.identity;
		fixture.options.identity = {
			...original,
			device: "android:other",
			platform: "android",
		};
		fixture.store.syncOptions();
		finish({ status: "unknown" });
		await pending;
		expect(fixture.store.getSnapshot().status).toBe("");
		expect(fixture.store.getSnapshot().notes).toHaveLength(0);
		fixture.options.identity = original;
		fixture.store.syncOptions();
		expect(fixture.store.getSnapshot().status).toContain("unknown");
		expect(fixture.store.getSnapshot().notes).toHaveLength(1);
	});

	test("Send waits for create, note update and Save, then supplies actual server IDs", async () => {
		const fixture = setup();
		const create = deferred(),
			update = deferred(),
			save = deferred();
		const operations: string[] = [];
		const sent: AnnotationSendPayload[] = [];
		fixture.options.contextClient = {
			create: async () => {
				operations.push("create");
				await create.promise;
				return { id: "actual-server-item" };
			},
			update: async (_workspace, id, note) => {
				operations.push("update");
				expect(id).toBe("actual-server-item");
				expect(note).toBe("Reviewed note");
				await update.promise;
			},
			save: async () => {
				operations.push("save");
				await save.promise;
			},
			remove: async () => {},
		};
		fixture.options.send = async (payload) => {
			sent.push(payload);
			return { status: "sent" };
		};
		fixture.store.select(point);
		fixture.store.setNote("Reviewed note");
		fixture.store.saveDraft();
		const localId = fixture.store.getSnapshot().notes[0]!.id;
		const pending = fixture.store.sendPrompt();
		await fixture.store.sendPrompt(); // Repeated clicks cannot dispatch while waiting.
		await settle();
		expect(operations).toEqual(["create"]);
		expect(sent).toHaveLength(0);
		await fixture.store.copyPrompt();
		expect(fixture.copies).toHaveLength(1);
		create.resolve();
		await settle();
		expect(operations).toEqual(["create", "update"]);
		expect(sent).toHaveLength(0);
		update.resolve();
		await settle();
		expect(operations).toEqual(["create", "update", "save"]);
		expect(sent).toHaveLength(0);
		save.resolve();
		await pending;
		expect(sent).toHaveLength(1);
		expect(sent[0]!.retainedContext).toEqual({
			workspace: "test-workspace",
			ids: ["actual-server-item"],
			prompt: sent[0]!.prompt,
		});
		expect(sent[0]!.retainedContext!.ids).not.toContain(localId);
		expect(Object.isFrozen(sent[0]!.retainedContext!.ids)).toBe(true);
	});

	for (const failed of ["create", "update", "save"] as const)
		test(`a failed ${failed} receipt blocks Send while local Copy remains available`, async () => {
			const fixture = setup();
			let sends = 0;
			if (failed === "create")
				fixture.options.contextClient!.create = async () => {
					throw new Error("offline");
				};
			else
				fixture.options.contextClient![failed] = async () => {
					throw new Error("offline");
				};
			fixture.options.send = async () => {
				sends++;
				return { status: "sent" };
			};
			fixture.store.select(point);
			fixture.store.setNote("Retained locally");
			fixture.store.saveDraft();
			await fixture.store.sendPrompt();
			expect(sends).toBe(0);
			expect(fixture.store.getSnapshot().notes[0]!.note).toBe(
				"Retained locally",
			);
			expect(fixture.store.getSnapshot().sending).toBe(false);
			await fixture.store.copyPrompt();
			expect(fixture.copies).toHaveLength(1);
			expect(fixture.captureCount()).toBe(1);
		});

	test("missing server IDs block dispatch rather than using client note IDs", async () => {
		const fixture = setup();
		let sends = 0;
		fixture.options.contextClient!.create = async () => ({ id: "" });
		fixture.options.send = async () => {
			sends++;
			return { status: "sent" };
		};
		fixture.store.select(point);
		fixture.store.setNote("No server receipt");
		fixture.store.saveDraft();
		await fixture.store.sendPrompt();
		expect(sends).toBe(0);
		expect(fixture.store.getSnapshot().notes).toHaveLength(1);
	});

	for (const mismatch of ["workspace", "duplicate-id"] as const)
		test(`${mismatch} prevents a combined retained-context Send`, async () => {
			const fixture = setup();
			let sends = 0;
			if (mismatch === "duplicate-id")
				fixture.options.contextClient!.create = async () => ({
					id: "same-server-id",
				});
			fixture.options.send = async () => {
				sends++;
				return { status: "sent" };
			};
			fixture.store.select(point);
			fixture.store.setNote("First note");
			fixture.store.saveDraft();
			if (mismatch === "workspace")
				fixture.options.workspace = "other-workspace";
			fixture.store.select({ x: 180, y: 140 });
			fixture.store.setNote("Second note");
			fixture.store.saveDraft();
			await fixture.store.sendPrompt();
			expect(sends).toBe(0);
			expect(fixture.store.getSnapshot().notes).toHaveLength(2);
			await fixture.store.copyPrompt();
			expect(fixture.copies[0]!.images).toHaveLength(2);
		});

	test("editing a reviewed note during receipt synchronization cancels dispatch", async () => {
		const fixture = setup();
		const gate = deferred();
		let sends = 0;
		fixture.options.contextClient!.update = async () => {
			await gate.promise;
		};
		fixture.options.send = async () => {
			sends++;
			return { status: "sent" };
		};
		fixture.store.select(point);
		fixture.store.setNote("Reviewed text");
		fixture.store.saveDraft();
		const pending = fixture.store.sendPrompt();
		fixture.store.editNote(fixture.store.getSnapshot().notes[0]!.id);
		fixture.store.setNote("Changed before delivery");
		gate.resolve();
		await pending;
		expect(sends).toBe(0);
		expect(fixture.store.getSnapshot().editor?.note).toBe(
			"Changed before delivery",
		);
	});

	test("removing a reviewed item during receipt synchronization cancels dispatch", async () => {
		const fixture = setup();
		const gate = deferred();
		let sends = 0;
		fixture.options.contextClient!.create = async () => {
			await gate.promise;
			return { id: "server-item" };
		};
		fixture.options.send = async () => {
			sends++;
			return { status: "sent" };
		};
		fixture.store.select(point);
		fixture.store.setNote("Remove explicitly");
		fixture.store.saveDraft();
		const pending = fixture.store.sendPrompt();
		fixture.store.removeNote(fixture.store.getSnapshot().notes[0]!.id);
		gate.resolve();
		await pending;
		await settle();
		expect(sends).toBe(0);
		expect(fixture.store.getSnapshot().notes).toHaveLength(0);
		expect(fixture.calls.some((call) => call.name === "remove")).toBe(true);
	});

	test("retains oversized pasted text and blocks Save until it is shortened", async () => {
		const fixture = setup();
		const long = "x".repeat(4097);
		fixture.store.select(point);
		fixture.store.setNote(long);
		fixture.store.saveDraft();
		expect(fixture.store.getSnapshot().editor?.note).toBe(long);
		expect(fixture.store.getSnapshot().notes).toHaveLength(0);
		fixture.store.retainDraft();
		await settle();
		expect(fixture.store.getSnapshot().draft?.note).toBe(long);
		expect(fixture.calls.map((call) => call.name)).toEqual(["create"]);
		fixture.store.editNote(fixture.store.getSnapshot().draft!.id);
		fixture.store.setNote("Shortened note");
		fixture.store.saveDraft();
		await settle();
		expect(fixture.store.getSnapshot().notes[0]!.note).toBe("Shortened note");
		expect(fixture.calls.map((call) => call.name)).toEqual([
			"create",
			"update",
			"save",
		]);
	});

	test("the note limit matches A03's UTF-16 length and the editor never truncates retained text", async () => {
		const fixture = setup();
		const unicode = "🙂".repeat(2048);
		fixture.store.select(point);
		fixture.store.setNote(unicode);
		fixture.store.saveDraft();
		await settle();
		expect(fixture.store.getSnapshot().notes[0]!.note).toBe(unicode);
		fixture.store.editNote(fixture.store.getSnapshot().notes[0]!.id);
		fixture.store.setNote(`${unicode}🙂`);
		fixture.store.saveDraft();
		expect(fixture.store.getSnapshot().editor?.note).toBe(`${unicode}🙂`);
		expect(fixture.store.getSnapshot().status).toContain("4,096");
		expect(fixture.calls.filter((call) => call.name === "update")).toHaveLength(
			1,
		);
		fixture.store.setNote(unicode);
		fixture.store.setNote("x".repeat(16_385));
		expect(fixture.store.getSnapshot().editor?.note).toBe(unicode);
	});

	test("missing native trees never show an arbitrary hover region or publish pointer updates", () => {
		const fixture = setup();
		fixture.options.cache = null;
		let changes = 0;
		fixture.store.subscribe(() => changes++);
		fixture.store.hover(point);
		fixture.store.hover(point);
		fixture.options.geometry = { ...fixture.options.geometry! };
		fixture.store.hover(point);
		expect(changes).toBe(0);
		fixture.store.hover({ x: point.x + 8, y: point.y });
		expect(changes).toBe(0);
		fixture.store.hover(null);
		fixture.store.hover(null);
		expect(changes).toBe(0);
	});

	test("pending removal retains the context budget until its evidence is released", async () => {
		const fixture = setup();
		const removal = deferred();
		fixture.options.contextClient!.remove = async () => {
			await removal.promise;
		};
		for (let index = 0; index < 32; index++) {
			fixture.store.select(point);
			fixture.store.setNote(`Note ${index}`);
			fixture.store.saveDraft();
		}
		fixture.store.removeNote(fixture.store.getSnapshot().notes[0]!.id);
		fixture.store.select(point);
		expect(fixture.captureCount()).toBe(32);
		expect(fixture.store.getSnapshot().draft).toBeNull();
		await settle();
		removal.resolve();
		await settle();
		fixture.store.select(point);
		expect(fixture.captureCount()).toBe(33);
		expect(fixture.store.getSnapshot().draft).not.toBeNull();
	});
});
