import { describe, expect, test } from "bun:test";
import type {
	AndroidNodeAction,
	AndroidNodeDescription,
	AndroidNodeRef,
	AndroidNodeResult,
} from "../../../../../core/android/accessibility/ax-server";
import { AndroidSession } from "../../../../../core/android/session/session";

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
};

const IDENTITY = {
	id: "11:37",
	windowId: FIELD.windowId,
	sourceId: FIELD.sourceId,
};

const REQUEST = {
	node: "0.2",
	action: "focus" as const,
	testId: FIELD.resourceId,
	className: FIELD.class,
	identity: IDENTITY,
};

type NativeCall = {
	action: AndroidNodeAction;
	target: AndroidNodeRef;
	text?: string;
};

function sessionWith(input: {
	perform?: (call: NativeCall) => Promise<AndroidNodeResult>;
	focus?: () => Promise<AndroidNodeDescription | null>;
	mutations?: string[];
}): AndroidSession {
	return new AndroidSession("emulator-5554", {
		performAxAction: async (serial, action, target, text) => {
			expect(serial).toBe("emulator-5554");
			return (
				input.perform?.({ action, target, text }) ?? {
					performed: true,
					node: FIELD,
				}
			);
		},
		readAxFocus: async () => input.focus?.() ?? FIELD,
		markAxMutation: (serial) => input.mutations?.push(serial),
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

	test("rejects a refused focus action", async () => {
		const session = sessionWith({
			perform: async () => ({ performed: false, node: FIELD }),
		});

		await expect(session.performField(REQUEST)).rejects.toThrow(
			"Android refused to focus the field",
		);
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
				},
			}),
		});

		await expect(session.performField(REQUEST)).rejects.toThrow(
			"Android focused a different field",
		);
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
