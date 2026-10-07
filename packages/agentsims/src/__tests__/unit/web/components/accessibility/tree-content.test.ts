import { describe, expect, test } from "bun:test";
import type { AxElement } from "../../../../../core/tools/observe/accessibility-model";
import {
	accessibilityNativeRowContent,
	accessibilityTreeKeyForPath,
	accessibilityTreeRowTooltip,
	accessibilityTreeSearchResult,
	accessibilityTreeTooltipContentForPath,
	accessibilityTreeVisibleLabelForPath,
	buildAccessibilityTree,
	buildAccessibilityTreeProjection,
	refreshAccessibilityTreeProjection,
} from "../../../../../web/components/accessibility/tree";

const element = (changes: Partial<AxElement> = {}): AxElement => ({
	id: "native-button",
	path: "0.1",
	label: "Pay now",
	value: "",
	role: "button",
	type: "android.widget.Button",
	enabled: true,
	frame: { x: 20, y: 40, width: 120, height: 48 },
	...changes,
});

describe("native accessibility row content", () => {
	test("shows Android native type and semantic label without replacing it with a source owner", () => {
		const content = accessibilityNativeRowContent(
			element({
				source: {
					kind: "react-native",
					confidence: "exact-testid",
					testID: "pay",
					componentName: "CheckoutAction",
					elementName: "CheckoutAction",
					elementKind: "custom",
				},
			}),
		);
		expect(content.nativeType).toBe("android.widget.Button");
		expect(content.type).toBe("Button");
		expect(content.properties).toEqual(['label="Pay now"']);
		const native = element({
			source: {
				kind: "react-native",
				confidence: "exact-testid",
				testID: "pay",
				componentName: "CheckoutAction",
				elementName: "CheckoutAction",
				elementKind: "custom",
			},
		});
		const projection = buildAccessibilityTreeProjection([native]);
		expect(
			accessibilityTreeVisibleLabelForPath(projection, projection.paths[0]!),
		).toBe("Button");
	});

	test("reports distinct iOS role, value, state, and disabled status", () => {
		const content = accessibilityNativeRowContent(
			element({
				type: "TextField",
				role: "AXTextField",
				label: "Email",
				value: "person@example.com",
				state: "Invalid",
				enabled: false,
			}),
		);
		expect(content.type).toBe("TextField");
		expect(content.properties).toEqual([
			'role="AXTextField"',
			'label="Email"',
			'value="person@example.com"',
			'state="Invalid"',
			"enabled=false",
		]);
	});

	test("keeps clickable TextView truthful instead of inventing a Button type", () => {
		const content = accessibilityNativeRowContent(
			element({
				type: "android.widget.TextView",
				role: "android.widget.TextView",
				traits: ["clickable", "focused"],
			}),
		);
		expect(content.type).toBe("TextView");
		expect(content.properties).toContain('traits=["clickable","focused"]');
		expect(
			content.properties.some((property) => property.includes("Button")),
		).toBe(false);
	});

	test("suppresses generated identifier carrier text and duplicate native values", () => {
		const generated = accessibilityNativeRowContent(
			element({
				label: "ags_generated_123",
				value: "native-id",
				nativeId: "native-id",
			}),
		);
		expect(generated.properties).toEqual([]);
		const duplicate = accessibilityNativeRowContent(
			element({ value: "Pay now" }),
		);
		expect(duplicate.properties).toEqual(['label="Pay now"']);
	});

	test("never substitutes source visible text for missing native AX labels", () => {
		const content = accessibilityNativeRowContent(
			element({
				label: "",
				value: "",
				source: {
					kind: "react-native",
					confidence: "related-native-id",
					testID: "owner",
					componentName: "Card",
					visibleText: "Source-only text",
					matchReason: "ancestor-owner",
				},
			}),
		);
		expect(content.properties).toEqual([]);
		expect(content.type).toBe("Button");
	});

	test("quotes native text without losing literal newlines or quotes", () => {
		const label = 'Say "yes"\nthen continue';
		const content = accessibilityNativeRowContent(element({ label }));
		expect(JSON.parse(content.properties[0]!.slice("label=".length))).toBe(
			label,
		);
	});

	test("keeps full native type, AX path, source owner and source line available in tooltip data", () => {
		const node = element({
			source: {
				kind: "react-native",
				confidence: "exact-testid",
				testID: "pay",
				componentName: "CheckoutAction",
				file: "src/screens/Checkout.tsx",
				line: 72,
			},
		});
		const projection = buildAccessibilityTreeProjection([node]);
		const content = accessibilityTreeTooltipContentForPath(
			projection,
			projection.paths[0]!,
		);
		expect(content?.title).toContain("android.widget.Button");
		expect(content?.title).toContain('path="0.1"');
		expect(content?.title).toContain('sourceOwner="CheckoutAction"');
		expect(content?.sourceBasename).toBe("Checkout.tsx:72");
		expect(accessibilityTreeRowTooltip(node)).toContain('label="Pay now"');
	});

	test("display formatting preserves actual wrappers, child order, and reverse selection identity", () => {
		const root = element({
			id: "root",
			path: "0",
			type: "android.widget.FrameLayout",
			role: "android.widget.FrameLayout",
			label: "",
		});
		const child = element();
		const nested = element({
			id: "text",
			path: "0.1.0",
			type: "android.widget.TextView",
			role: "text",
			label: "Total",
		});
		const roots = buildAccessibilityTree([root, child, nested]);
		expect(roots).toHaveLength(1);
		expect(roots[0]!.children[0]!.children[0]!.element).toBe(nested);
		const projection = buildAccessibilityTreeProjection([root, child, nested]);
		expect(projection.paths).toHaveLength(3);
		for (const node of [root, child, nested]) {
			const key = `${node.id}@${node.path}`;
			expect(
				accessibilityTreeKeyForPath(
					projection,
					projection.pathsByKey.get(key)!,
				),
			).toBe(key);
			accessibilityNativeRowContent(node);
		}
		expect(projection.paths.filter((path) => path.endsWith("/"))).toHaveLength(
			2,
		);
	});

	test("native property updates refresh row data without changing model paths or source identity", () => {
		const node = element();
		const projection = buildAccessibilityTreeProjection([node]);
		const refreshed = refreshAccessibilityTreeProjection(projection, [
			{ ...node, value: "Updated", state: "Selected" },
		]);
		expect(refreshed.paths).toBe(projection.paths);
		expect(refreshed.pathsByKey).toBe(projection.pathsByKey);
		const refreshedNode = refreshed.entriesByPath.get(
			refreshed.paths[0]!,
		)!.element;
		expect(accessibilityNativeRowContent(refreshedNode).properties).toContain(
			'state="Selected"',
		);
		expect(node.state).toBeUndefined();
	});

	test("state search returns the native matching node with its real ancestors", () => {
		const root = element({
			id: "root",
			path: "0",
			type: "View",
			role: "View",
			label: "",
		});
		const child = element({ state: "Invalid", enabled: false });
		const projection = buildAccessibilityTreeProjection([root, child]);
		const result = accessibilityTreeSearchResult(projection, "invalid");
		expect(result.matchingKeys).toEqual(["native-button@0.1"]);
		expect(result.paths).toEqual(projection.paths);
		expect(
			accessibilityTreeSearchResult(projection, "disabled").matchingKeys,
		).toEqual(["native-button@0.1"]);
	});
});
