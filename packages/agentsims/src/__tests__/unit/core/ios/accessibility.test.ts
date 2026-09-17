import { describe, expect, test } from "bun:test";
import {
	iosAxSnapshot,
	iosFocusedField,
} from "../../../../core/ios/accessibility";
import { iosSettingsSnapshot } from "../../../fixtures/ax-view-snapshots";

const screen = { x: 0, y: 0, width: 402, height: 874 };

function rawNode(
	id: string,
	type: string,
	frame: { x: number; y: number; width: number; height: number },
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		AXUniqueId: id,
		AXLabel: null,
		AXValue: null,
		enabled: true,
		frame,
		role_description: type,
		type,
		children: [],
		...overrides,
	};
}

describe("iOS accessibility normalization", () => {
	test("normalizes the existing iOS settings fixture and keeps its screen root", () => {
		const raw = [
			rawNode("root", "Application", screen, {
				children: [
					rawNode(
						"back",
						"Button",
						{ x: 10, y: 20, width: 40, height: 40 },
						{
							AXLabel: "Back",
						},
					),
					rawNode(
						"scroll",
						"ScrollArea",
						{ x: 0, y: 80, width: 402, height: 700 },
						{
							children: [
								rawNode(
									"title",
									"StaticText",
									{ x: 20, y: 100, width: 200, height: 30 },
									{ AXValue: "Settings" },
								),
								rawNode(
									"secret",
									"SecureTextField",
									{ x: 20, y: 200, width: 360, height: 44 },
									{ AXLabel: "Passcode", enabled: false },
								),
							],
						},
					),
				],
			}),
		];
		const expected = {
			...iosSettingsSnapshot,
			elements: [
				{
					id: "root",
					path: "0",
					label: "",
					value: "",
					role: "Application",
					type: "Application",
					enabled: true,
					frame: screen,
					testId: "root",
					nativeId: "root",
				},
				...iosSettingsSnapshot.elements.map((element) => ({
					...element,
					testId: element.id,
					nativeId: element.id,
				})),
			],
		};

		expect(iosAxSnapshot(raw)).toEqual(expected);
	});

	test("keeps empty and error payload behavior", () => {
		const empty = { screen: { width: 1, height: 1 }, elements: [] };
		expect(iosAxSnapshot([])).toEqual(empty);
		expect(iosAxSnapshot(null)).toEqual(empty);
		expect(iosAxSnapshot({ errors: ["AX unavailable"] })).toEqual(empty);
	});

	test("requires one native-focused text field and preserves its selection", () => {
		const fieldFrame = { x: 20, y: 100, width: 300, height: 44 };
		const field = rawNode("email", "TextField", fieldFrame, {
			AXValue: "hello",
			focused: true,
			selection: { start: 1, end: 3 },
		});
		const raw = [rawNode("root", "Application", screen, { children: [field] })];

		expect(iosFocusedField(raw)).toEqual({
			value: "hello",
			editable: true,
			password: false,
			focused: true,
			identity: { id: "email" },
			selection: { start: 1, end: 3 },
		});
		expect(iosAxSnapshot(raw).elements[1]?.traits).toEqual(["focused"]);
		expect(
			iosFocusedField([
				rawNode("root", "Application", screen, {
					children: [
						field,
						rawNode("other", "TextField", fieldFrame, { focused: true }),
					],
				}),
			]),
		).toBeNull();
		expect(
			iosFocusedField([rawNode("root", "Application", screen)]),
		).toBeNull();
	});

	test("keeps one field identity when traversal siblings change", () => {
		const fieldFrame = { x: 28, y: 808, width: 286, height: 28 };
		const field = rawNode("", "TextField", fieldFrame, {
			AXUniqueId: null,
			AXValue: "AgentSims",
			focused: true,
			role_description: "search text field",
		});
		const before = [
			rawNode("root", "Application", screen, {
				children: [rawNode("message", "StaticText", fieldFrame), field],
			}),
		];
		const after = [
			rawNode("root", "Application", screen, { children: [field] }),
		];

		const beforeField = iosAxSnapshot(before).elements.at(-1)!;
		const afterField = iosAxSnapshot(after).elements.at(-1)!;
		expect(beforeField.path).toBe("0.1");
		expect(afterField.path).toBe("0.0");
		expect(afterField.id).toBe(beforeField.id);
		expect(iosFocusedField(after)?.identity).toEqual({ id: beforeField.id });
	});

	test("keeps every element after the former 500-element limit", () => {
		const children = Array.from({ length: 650 }, (_, index) =>
			rawNode(`row-${index}`, "StaticText", {
				x: 0,
				y: index + 1,
				width: 100,
				height: 1,
			}),
		);
		const result = iosAxSnapshot([
			rawNode("root", "Application", screen, { children }),
		]);

		expect(result.elements).toHaveLength(651);
		expect(result.elements.at(-1)?.id).toBe("row-649");
	});

	test("keeps descendants after the former depth-80 limit", () => {
		let branch = rawNode("leaf", "StaticText", {
			x: 0,
			y: 1,
			width: 100,
			height: 1,
		});
		for (let depth = 89; depth >= 0; depth--) {
			branch = rawNode(
				`branch-${depth}`,
				"Group",
				{
					x: 0,
					y: depth + 2,
					width: 100,
					height: 1,
				},
				{ children: [branch] },
			);
		}

		const result = iosAxSnapshot([
			rawNode("root", "Application", screen, { children: [branch] }),
		]);
		expect(result.elements).toHaveLength(92);
		expect(result.elements.at(-1)?.id).toBe("leaf");
		expect(result.elements.at(-1)?.path.split(".")).toHaveLength(92);
	});

	test("stops cycles and skips malformed nodes", () => {
		const cyclic = rawNode("cycle", "Group", {
			x: 0,
			y: 1,
			width: 100,
			height: 1,
		});
		cyclic.children = [null, cyclic];

		const result = iosAxSnapshot([
			rawNode("root", "Application", screen, { children: [cyclic] }),
		]);
		expect(result.elements.map((element) => element.id)).toEqual([
			"root",
			"cycle",
		]);
	});
});
