import { describe, expect, test } from "bun:test";
import { AndroidSession } from "../../../../../core/android/session/session";
import type { AndroidNodeResult } from "../../../../../core/android/accessibility/ax-server";

const FIELD = {
	node: "0.1",
	resourceId: "com.example:id/email",
	className: "android.widget.EditText",
	windowId: 11,
	sourceId: 37,
};

function touchFrame(type: string, x: number, y: number): Buffer {
	return Buffer.concat([
		Buffer.from([0x03]),
		Buffer.from(JSON.stringify({ type, x, y })),
	]);
}

describe("Android session AX mutation barrier", () => {
	test("advances after a native field action is acknowledged", async () => {
		const acknowledged = Promise.withResolvers<AndroidNodeResult>();
		const mutations: string[] = [];
		const session = new AndroidSession("emulator-5554", {
			performAxAction: async () => acknowledged.promise,
			markAxMutation: (serial) => mutations.push(serial),
		});

		const action = session.performNodeAction("set-text", FIELD, "hello");
		expect(mutations).toEqual([]);
		acknowledged.resolve({ performed: true, node: null });
		expect(await action).toEqual({ performed: true, node: null });
		expect(mutations).toEqual(["emulator-5554"]);
		await session.close();
	});

	test("invalidates after refused and uncertain native field actions", async () => {
		const mutations: string[] = [];
		let result: "false" | "error" = "false";
		const session = new AndroidSession("emulator-5554", {
			performAxAction: async () => {
				if (result === "error") throw new Error("not dispatched");
				return { performed: false, node: null };
			},
			markAxMutation: (serial) => mutations.push(serial),
		});

		expect(await session.performNodeAction("focus", FIELD)).toMatchObject({
			performed: false,
		});
		result = "error";
		await expect(
			session.performNodeAction("set-text", FIELD, "hello"),
		).rejects.toThrow("not dispatched");
		expect(mutations).toEqual(["emulator-5554", "emulator-5554"]);
		await session.close();
	});

	test("advances only after physical touch dispatch is acknowledged", async () => {
		const acknowledged = Promise.withResolvers<void>();
		const mutations: string[] = [];
		const uiMutations: string[] = [];
		const session = new AndroidSession("R5CW1234ABC", {
			readScreenConfig: async () => ({
				width: 1080,
				height: 2400,
				orientation: "portrait",
				rotation: 0,
			}),
			warmAx: async () => {},
			touchDevice: async () => acknowledged.promise,
			markAxMutation: (serial) => mutations.push(serial),
			markUiMutation: (serial) => uiMutations.push(serial),
		});
		await session.start();

		const dispatch = session.dispatchInputFrame(touchFrame("begin", 0.5, 0.5));
		expect(mutations).toEqual([]);
		expect(uiMutations).toEqual(["R5CW1234ABC"]);
		acknowledged.resolve();
		await dispatch;
		expect(mutations).toEqual(["R5CW1234ABC"]);
		await session.close();
	});

	test("does not publish a UI mutation for malformed input", async () => {
		const mutations: string[] = [];
		const session = new AndroidSession("R5CW1234ABC", {
			readScreenConfig: async () => ({
				width: 1080,
				height: 2400,
				orientation: "portrait",
				rotation: 0,
			}),
			warmAx: async () => {},
			markUiMutation: (serial) => mutations.push(serial),
		});
		await session.start();

		await session.dispatchInputFrame(Buffer.from([0x03, 0x7b]));

		expect(mutations).toEqual([]);
		await session.close();
	});
});
