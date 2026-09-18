import { describe, expect, test } from "bun:test";
import type {
	AndroidNodeAction,
	AndroidNodeDescription,
	AndroidNodeRef,
	AndroidNodeResult,
} from "../../../../../core/android/accessibility/ax-server";
import { AndroidSession } from "../../../../../core/android/session/session";

const ROOT = {
	windowId: 11,
	sourceId: 20,
	resourceId: "",
	class: "android.widget.LinearLayout",
	editable: false,
};

const WRAPPER_LINK = {
	windowId: 11,
	sourceId: 36,
	resourceId: "com.example:id/email_layout",
	class: "com.google.android.material.textfield.TextInputLayout",
	editable: false,
};

const FIELD: AndroidNodeDescription = {
	class: "android.widget.EditText",
	resourceId: "com.example:id/email",
	text: "",
	contentDesc: "Email",
	editable: true,
	hintText: true,
	password: false,
	focused: true,
	enabled: true,
	windowId: 11,
	sourceId: 37,
	selectionStart: 0,
	selectionEnd: 0,
	bounds: "[20,40][420,120]",
	ancestors: [WRAPPER_LINK, ROOT],
};

/** The layout around the field. Its child takes Android's input focus. */
const WRAPPER: AndroidNodeDescription = {
	...FIELD,
	class: WRAPPER_LINK.class,
	resourceId: WRAPPER_LINK.resourceId,
	contentDesc: "",
	editable: false,
	focused: false,
	sourceId: WRAPPER_LINK.sourceId,
	bounds: "[20,30][420,130]",
	ancestors: [ROOT],
};

/** An inner node of a compound field. Android reports focus on it. */
const INNER: AndroidNodeDescription = {
	...FIELD,
	class: "android.widget.TextView",
	resourceId: "",
	sourceId: 41,
	bounds: "[24,44][416,116]",
	ancestors: [
		{
			windowId: FIELD.windowId,
			sourceId: FIELD.sourceId,
			resourceId: FIELD.resourceId,
			class: FIELD.class,
			editable: true,
		},
		WRAPPER_LINK,
		ROOT,
	],
};

const IDENTITY = {
	id: "11:37",
	windowId: FIELD.windowId,
	sourceId: FIELD.sourceId,
};

const WRAPPER_IDENTITY = {
	id: "11:36",
	windowId: WRAPPER.windowId,
	sourceId: WRAPPER.sourceId,
};

const REQUEST = {
	node: "0.2",
	action: "focus" as const,
	testId: FIELD.resourceId,
	className: FIELD.class,
	identity: IDENTITY,
};

const WRAPPER_REQUEST = {
	node: "0.2",
	action: "focus" as const,
	testId: WRAPPER.resourceId,
	className: WRAPPER.class,
	identity: WRAPPER_IDENTITY,
};

type NativeCall = {
	action: AndroidNodeAction;
	target: AndroidNodeRef;
	text?: string;
};

type TouchCall = { phase: string; x: number; y: number };

function sessionWith(input: {
	serial?: string;
	perform?: (call: NativeCall) => Promise<AndroidNodeResult>;
	focus?: () => Promise<AndroidNodeDescription | null>;
	mutations?: string[];
	touches?: TouchCall[];
	screen?: { width: number; height: number };
}): AndroidSession {
	const serial = input.serial ?? "emulator-5554";
	return new AndroidSession(serial, {
		performAxAction: async (device, action, target, text) => {
			expect(device).toBe(serial);
			return (
				input.perform?.({ action, target, text }) ?? {
					performed: true,
					node: FIELD,
				}
			);
		},
		readAxFocus: async () => input.focus?.() ?? FIELD,
		markAxMutation: (device) => input.mutations?.push(device),
		readScreenConfig: async () => ({
			width: input.screen?.width ?? 1080,
			height: input.screen?.height ?? 2400,
			orientation: "portrait",
		}),
		touchDevice: async (device, phase, x, y) => {
			expect(device).toBe(serial);
			input.touches?.push({ phase, x, y });
		},
	});
}

describe("Android field identity", () => {
	test("keeps the snapshot path when resource IDs are duplicated", async () => {
		let nativeTarget: AndroidNodeRef | null = null;
		const session = sessionWith({
			perform: async ({ target }) => {
				nativeTarget = target;
				return { performed: true, node: FIELD };
			},
		});

		expect(await session.performField(REQUEST)).toMatchObject({
			performed: true,
			field: { focused: true },
		});
		expect(nativeTarget).toMatchObject({
			node: "0.2",
			resourceId: "com.example:id/email",
			windowId: 11,
			sourceId: 37,
		});
		await session.close();
	});

	test("accepts a native acknowledgement for an already-focused target", async () => {
		const calls: NativeCall[] = [];
		const session = sessionWith({
			perform: async (call) => {
				calls.push(call);
				return { performed: true, node: FIELD };
			},
		});

		expect(await session.performField(REQUEST)).toMatchObject({
			performed: true,
			field: { focused: true, identity: IDENTITY },
		});
		expect(calls).toHaveLength(1);
		await session.close();
	});

	test("binds a set-text request to the focused node window and source", async () => {
		let nativeTarget: AndroidNodeRef | null = null;
		const session = sessionWith({
			focus: async () => FIELD,
			perform: async ({ target }) => {
				nativeTarget = target;
				throw new Error("Android field changed. Run observe again");
			},
		});

		expect(await session.readFocusedField()).toEqual({
			value: "",
			editable: true,
			password: false,
			focused: true,
			identity: IDENTITY,
			selection: { start: 0, end: 0 },
		});
		await expect(
			session.performField({
				node: "focus",
				action: "set-text",
				text: "a",
				identity: IDENTITY,
			}),
		).rejects.toThrow("Android field changed");
		expect(nativeTarget).toEqual({
			node: "focus",
			windowId: 11,
			sourceId: 37,
		});
		await session.close();
	});

	test("rejects a changed window after focus", async () => {
		const session = sessionWith({
			focus: async () => FIELD,
			perform: async () => ({
				performed: true,
				node: { ...FIELD, windowId: 18, sourceId: 61 },
			}),
		});
		await session.readFocusedField();

		await expect(
			session.performField({
				node: "focus",
				action: "set-text",
				text: "a",
				identity: IDENTITY,
			}),
		).rejects.toThrow("Android focused a different field");
		await session.close();
	});

	test("accepts the editable field inside the requested layout", async () => {
		const calls: NativeCall[] = [];
		const session = sessionWith({
			perform: async (call) => {
				calls.push(call);
				if (call.action === "focus")
					return { performed: true, node: FIELD, requested: WRAPPER };
				return {
					performed: true,
					node: { ...FIELD, text: call.text ?? "", hintText: false },
				};
			},
		});

		expect(await session.performField(WRAPPER_REQUEST)).toMatchObject({
			performed: true,
			// The caller gets the node that it named in the snapshot.
			field: { focused: true, editable: true, identity: WRAPPER_IDENTITY },
		});
		expect(
			await session.performField({
				node: "focus",
				action: "set-text",
				text: "a@b.c",
				identity: WRAPPER_IDENTITY,
			}),
		).toMatchObject({
			performed: true,
			field: { value: "a@b.c", identity: WRAPPER_IDENTITY },
		});
		// The write goes to the node that holds Android's input focus.
		expect(calls.at(-1)?.target).toEqual({
			node: "focus",
			windowId: FIELD.windowId,
			sourceId: FIELD.sourceId,
		});
		await session.close();
	});

	test("accepts an editable node inside the requested field", async () => {
		const session = sessionWith({
			perform: async () => ({
				performed: true,
				node: INNER,
				requested: FIELD,
			}),
		});

		expect(await session.performField(REQUEST)).toMatchObject({
			performed: true,
			field: { focused: true, identity: IDENTITY },
		});
		await session.close();
	});

	test("accepts an editable layout around the requested field", async () => {
		const session = sessionWith({
			perform: async () => ({
				performed: true,
				node: { ...WRAPPER, editable: true, focused: true },
				requested: FIELD,
			}),
		});

		expect(await session.performField(REQUEST)).toMatchObject({
			performed: true,
			field: { focused: true, identity: IDENTITY },
		});
		await session.close();
	});

	test("keeps the field of the snapshot on a later focus read", async () => {
		const session = sessionWith({
			perform: async () => ({ performed: true, node: FIELD, requested: WRAPPER }),
			focus: async () => FIELD,
		});
		await session.performField(WRAPPER_REQUEST);

		expect(await session.readFocusedField()).toMatchObject({
			focused: true,
			identity: WRAPPER_IDENTITY,
		});
		await session.close();
	});

	test("taps a refused field once and accepts the focus that follows", async () => {
		const calls: NativeCall[] = [];
		const touches: TouchCall[] = [];
		const session = sessionWith({
			serial: "R5CW1234ABC",
			touches,
			perform: async (call) => {
				calls.push(call);
				return { performed: false, node: null, requested: FIELD };
			},
			focus: async () => FIELD,
		});

		expect(await session.performField(REQUEST)).toMatchObject({
			performed: true,
			field: { focused: true, identity: IDENTITY },
		});
		expect(calls).toHaveLength(1);
		expect(touches.map((touch) => touch.phase)).toEqual(["begin", "end"]);
		for (const touch of touches) {
			expect(touch.x).toBeCloseTo(220, 6);
			expect(touch.y).toBeCloseTo(80, 6);
		}
		await session.close();
	});

	test("rejects a refused focus action that one tap cannot repair", async () => {
		const calls: NativeCall[] = [];
		const touches: TouchCall[] = [];
		const session = sessionWith({
			serial: "R5CW1234ABC",
			touches,
			perform: async (call) => {
				calls.push(call);
				return { performed: false, node: null, requested: FIELD };
			},
			focus: async () => ({ ...FIELD, focused: false }),
		});

		await expect(session.performField(REQUEST)).rejects.toThrow(
			"Android refused to focus the field",
		);
		expect(calls).toHaveLength(1);
		expect(touches).toHaveLength(2);
		await session.close();
	});

	test("rejects a refused set-text action", async () => {
		const session = sessionWith({
			perform: async () => ({ performed: false, node: FIELD }),
		});
		await session.readFocusedField();

		await expect(
			session.performField({
				node: "focus",
				action: "set-text",
				text: "a",
				identity: IDENTITY,
			}),
		).rejects.toThrow("Android refused to set text");
		await session.close();
	});

	test("rejects an unrelated focused field", async () => {
		const session = sessionWith({
			perform: async () => ({
				performed: true,
				node: {
					...FIELD,
					resourceId: "com.example:id/search",
					sourceId: 52,
					ancestors: [ROOT],
				},
				requested: FIELD,
			}),
		});

		const failure = session.performField(REQUEST);
		await expect(failure).rejects.toThrow(
			"Android focused a different field. Run observe again",
		);
		// The reason names the field that Android focused instead.
		await expect(failure).rejects.toThrow("com.example:id/search");
		await session.close();
	});

	test("binds consecutive writes to the most recently focused field", async () => {
		const other = {
			...FIELD,
			resourceId: "com.example:id/search",
			windowId: 12,
			sourceId: 52,
		};
		const calls: NativeCall[] = [];
		const session = sessionWith({
			perform: async (call) => {
				calls.push(call);
				if (call.action === "focus")
					return {
						performed: true,
						node: call.target.sourceId === other.sourceId ? other : FIELD,
					};
				return { performed: true, node: { ...other, text: call.text ?? "" } };
			},
		});

		await session.performField(REQUEST);
		await session.performField({
			node: "0.4",
			action: "focus",
			testId: other.resourceId,
			className: other.class,
			identity: {
				id: "12:52",
				windowId: other.windowId,
				sourceId: other.sourceId,
			},
		});
		await session.performField({
			node: "0.4",
			action: "set-text",
			text: "query",
			identity: {
				id: "12:52",
				windowId: other.windowId,
				sourceId: other.sourceId,
			},
		});

		expect(calls.at(-1)?.target).toMatchObject({
			node: "focus",
			windowId: 12,
			sourceId: 52,
		});
		await session.close();
	});

	test("returns the value from a validated write", async () => {
		const mutations: string[] = [];
		const session = sessionWith({
			focus: async () => FIELD,
			mutations,
			perform: async ({ action, target, text }) => {
				expect(action).toBe("set-text");
				expect(text).toBe("hello");
				expect(target).toMatchObject({
					windowId: FIELD.windowId,
					sourceId: FIELD.sourceId,
				});
				return {
					performed: true,
					node: {
						...FIELD,
						text: "hello",
						hintText: false,
						selectionStart: 5,
						selectionEnd: 5,
					},
				};
			},
		});
		await session.readFocusedField();

		expect(
			await session.performField({
				node: "focus",
				action: "set-text",
				text: "hello",
				identity: IDENTITY,
			}),
		).toEqual({
			performed: true,
			field: {
				value: "hello",
				editable: true,
				password: false,
				focused: true,
				identity: IDENTITY,
				selection: { start: 5, end: 5 },
			},
		});
		expect(mutations).toEqual(["emulator-5554"]);
		await session.close();
	});
});
