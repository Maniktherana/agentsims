import { expect, test } from "bun:test";
import { CONTEXT_LIMITS } from "../../../../core/tools/context/contracts";
import type { AxElement } from "../../../../core/tools/observe/accessibility-model";
import { prepareAnnotationSpatialSnapshot } from "../../../../web/annotation/selection";
import { annotationTargetStructure } from "../../../../web/annotation/structure";

const screen = { width: 400, height: 800 };

function element(
	path: string,
	label: string,
	frame: AxElement["frame"],
	extra: Partial<AxElement> = {},
): AxElement {
	return {
		id: path,
		path,
		label,
		value: "",
		role: "button",
		type: "Button",
		enabled: true,
		frame,
		...extra,
	};
}

const rowSource = {
	kind: "react-native" as const,
	confidence: "exact-testid" as const,
	matchReason: "test-id" as const,
	testID: "remove",
	file: "src/Cart.tsx",
	line: 42,
	column: 7,
};

function cartTree(): AxElement[] {
	return [
		element("0", "", { x: 0, y: 0, ...screen }, { role: "Other", type: "Other" }),
		element(
			"0.0",
			"Cart",
			{ x: 0, y: 100, width: 400, height: 600 },
			{ role: "list", type: "List", testId: "cart-list" },
		),
		...[0, 1, 2].map((index) =>
			element(
				`0.0.${index}`,
				"Remove",
				{ x: 0, y: 100 + index * 200, width: 400, height: 100 },
				{ testId: "remove", source: rowSource },
			),
		),
		...Array.from({ length: 10 }, (_, index) =>
			element(
				`0.0.1.${index}`,
				`Item ${index}`,
				{ x: index * 40, y: 300, width: 40, height: 20 },
				{ role: "text", type: "StaticText" },
			),
		),
		// Overlaps row 2 on screen but belongs to another branch of the tree.
		element(
			"1",
			"Overlay banner",
			{ x: 0, y: 300, width: 400, height: 100 },
			{ role: "text", type: "StaticText" },
		),
	];
}

function structureFor(elements: AxElement[], path: string) {
	const cache = prepareAnnotationSpatialSnapshot({ screen, elements });
	const key = cache.elements.find((entry) => entry.element.path === path)!.key;
	return annotationTargetStructure(cache, key)!;
}

test("a note on the second of three same-source rows reports instance 2 of 3", () => {
	expect(structureFor(cartTree(), "0.0.1").instance).toEqual({
		index: 2,
		total: 3,
		basis: "source",
	});
	expect(structureFor(cartTree(), "0.0.2").instance?.index).toBe(3);
});

test("without direct source, instances group by role and label only", () => {
	const elements = [
		element("0", "Delete", { x: 0, y: 10, width: 100, height: 40 }),
		element("1", "Delete", { x: 0, y: 60, width: 100, height: 40 }),
		element(
			"2",
			"Delete",
			{ x: 0, y: 110, width: 100, height: 40 },
			{ role: "text", type: "StaticText" },
		),
	];
	expect(structureFor(elements, "1").instance).toEqual({
		index: 2,
		total: 2,
		basis: "label",
	});
	expect(structureFor(elements, "2")?.instance).toBeUndefined();
});

test("hierarchy comes from tree links, never from overlapping bounds", () => {
	const structure = structureFor(cartTree(), "0.0.1");
	const names = [
		...(structure.ancestors ?? []),
		...(structure.siblings?.items ?? []),
		...(structure.children?.items ?? []),
	].map((node) => node.label);
	expect(names).not.toContain("Overlay banner");
	expect(structure.ancestors?.map((node) => node.label)).toEqual(["Cart"]);
	expect(structure.siblings?.total).toBe(2);
	expect(structure.nearby).toContain("Overlay banner");
	expect(structure.nearby).not.toContain("Remove");
});

test("an ancestor that fills the screen is never listed", () => {
	const elements = cartTree();
	elements[0] = { ...elements[0]!, label: "Root window" };
	expect(
		structureFor(elements, "0.0.1").ancestors?.map((node) => node.label),
	).toEqual(["Cart"]);
});

test("hierarchy lists never exceed their caps and keep the real totals", () => {
	const chain = Array.from({ length: 7 }, (_, depth) =>
		element(
			Array.from({ length: depth + 1 }, () => "0").join("."),
			`Level ${depth}`,
			{ x: depth * 10, y: depth * 10, width: 300 - depth * 20, height: 300 - depth * 20 },
			{ role: "group", type: "Group" },
		),
	);
	const leaf = "0.0.0.0.0.0.0";
	const children = Array.from({ length: 9 }, (_, index) =>
		element(`${leaf}.${index}`, `Child ${index}`, {
			x: 70 + index,
			y: 70,
			width: 1,
			height: 1,
		}),
	);
	const others = Array.from({ length: 9 }, (_, index) =>
		element(`${index + 1}`, `Other ${index}`, {
			x: 0,
			y: 400 + index * 30,
			width: 50,
			height: 20,
		}),
	);
	const siblings = Array.from({ length: 9 }, (_, index) =>
		element(`0.0.0.0.0.0.${index + 1}`, `Sibling ${index}`, {
			x: 245,
			y: 60 + index * 20,
			width: 4,
			height: 4,
		}),
	);
	const structure = structureFor(
		[...chain, ...children, ...siblings, ...others],
		leaf,
	);
	expect(structure.ancestors!.length).toBe(CONTEXT_LIMITS.structureItems);
	expect(structure.ancestors![0]!.label).toBe("Level 5");
	expect(structure.children).toMatchObject({ total: 9 });
	expect(structure.children!.items.length).toBe(CONTEXT_LIMITS.structureItems);
	expect(structure.siblings).toMatchObject({ total: 9 });
	expect(structure.siblings!.items.length).toBe(CONTEXT_LIMITS.structureItems);
	expect(structure.nearby!.length).toBe(CONTEXT_LIMITS.nearbyTexts);
});

test("long captured text is capped", () => {
	const elements = [
		element("0", "x".repeat(5000), { x: 0, y: 0, width: 200, height: 200 }, {
			role: "group",
		}),
		element("0.0", "Target", { x: 10, y: 10, width: 20, height: 20 }),
	];
	const label = structureFor(elements, "0.0").ancestors![0]!.label!;
	expect(label.length).toBeLessThanOrEqual(CONTEXT_LIMITS.structureText);
});
