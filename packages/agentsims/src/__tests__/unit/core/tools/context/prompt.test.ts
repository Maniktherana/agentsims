import { expect, test } from "bun:test";
import type {
	ContextInput,
	ContextItem,
	ContextStructure,
} from "../../../../../core/tools/context/contracts";
import { exportContext } from "../../../../../core/tools/context/export";
import {
	CONTEXT_PROMPT_DETAILS,
	formatContextPrompt,
	type ContextPromptDetail,
} from "../../../../../core/tools/context/prompt";
import type { AxElement } from "../../../../../core/tools/observe/accessibility-model";
import { exportAnnotationNotes } from "../../../../../web/annotation/evidence";
import type { LiveAnnotationNote } from "../../../../../web/annotation/live-contracts";

const target: AxElement = {
	id: "remove",
	path: "0.0.1",
	label: "Remove",
	value: "",
	role: "button",
	type: "Button",
	enabled: true,
	frame: { x: 0, y: 300, width: 400, height: 100 },
	testId: "remove",
};

function annotation(
	element: Partial<AxElement> = {},
	structure?: ContextStructure,
): Extract<ContextInput, { kind: "annotation" }> {
	return {
		kind: "annotation",
		device: "ios-uuid",
		platform: "ios",
		sessionId: "session",
		capturedAt: 1000,
		note: "",
		logs: [],
		image: { mimeType: "image/png", width: 1200, height: 2400, base64: "AA==" },
		target: {
			kind: "element",
			rect: { x: 0, y: 900, width: 1200, height: 300 },
			revision: 1,
			collectedAt: 1000,
			app: "com.example.cart",
			orientation: "portrait",
			element: { ...target, ...element },
			...(structure ? { structure } : {}),
		},
	};
}

function prompt(
	evidence: ContextInput,
	note = "Make it red",
	detail?: ContextPromptDetail,
) {
	return formatContextPrompt([{ note, evidence }], detail);
}

function lineOf(text: string, name: string) {
	return text.split("\n").find((line) => line.startsWith(`**${name}:**`));
}

const source = {
	kind: "react-native" as const,
	confidence: "exact-testid" as const,
	matchReason: "test-id" as const,
	testID: "remove",
	file: "src/Cart.tsx",
	line: 42,
	column: 7,
	ownerStack: ["App", "CartScreen", "CartRow"],
};
const structure: ContextStructure = {
	ancestors: [{ label: "Cart", role: "list", testId: "cart-list" }],
	siblings: { total: 6, items: [{ label: "Oat milk", role: "text" }] },
	children: { total: 1, items: [{ label: "Remove", role: "text" }] },
	nearby: ["Total", "$12.00"],
	instance: { index: 2, total: 3, basis: "source" },
};

test("the heading names the target by role and text, and feedback is the last line", () => {
	const lines = prompt(annotation()).split("\n");
	expect(lines).toContain('### 1. button "Remove"');
	expect(lines.at(-1)).toBe("**Feedback:** Make it red");
});

test("an absent source says how to find the target", () => {
	expect(lineOf(prompt(annotation()), "Source")).toBe(
		"**Source:** not available — find by testID or label",
	);
	expect(
		lineOf(prompt(annotation({ testId: undefined, label: "" })), "Source"),
	).toBe("**Source:** not available — find by the screenshot");
});

test("a source found by nearby text is marked for verification", () => {
	expect(
		lineOf(
			prompt(
				annotation({
					source: {
						...source,
						matchReason: "nearby-visible-text",
						column: undefined,
					},
				}),
			),
			"Source",
		),
	).toBe("**Source:** src/Cart.tsx:42 — matched by nearby text, verify");
});

test("compact keeps only the heading, the source, and the feedback", () => {
	const text = prompt(annotation({ source }, structure), "Make it red", "compact");
	expect(lineOf(text, "Source")).toBe("**Source:** src/Cart.tsx:42:7");
	for (const name of ["Position", "React", "testID", "Instance", "Siblings"])
		expect(lineOf(text, name)).toBeUndefined();
	// Without a source, compact names the testID instead.
	const bare = prompt(annotation(), "Make it red", "compact");
	expect(lineOf(bare, "testID")).toBe("**testID:** remove");
	expect(lineOf(bare, "Source")).toBeUndefined();
});

test("standard adds owners, position, and the instance but not the structure", () => {
	const text = prompt(annotation({ source }, structure));
	expect(lineOf(text, "React")).toBe("**React:** App > CartScreen > CartRow");
	expect(lineOf(text, "Position")).toBe("**Position:** 0, 900 (1200x300)");
	expect(lineOf(text, "Instance")).toBe(
		"**Instance:** 2 of 3 with this source — change only this one",
	);
	for (const name of ["Enclosing", "Siblings", "Children", "Nearby text"])
		expect(lineOf(text, name)).toBeUndefined();
});

test("detailed adds the captured structure", () => {
	const text = prompt(annotation({ source }, structure), "Make it red", "detailed");
	expect(lineOf(text, "Enclosing")).toBe(
		'**Enclosing:** list "Cart" testID cart-list (nearest first)',
	);
	expect(lineOf(text, "Siblings")).toBe(
		'**Siblings:** text "Oat milk" (6 total, 1 shown)',
	);
	expect(lineOf(text, "Children")).toBe('**Children:** text "Remove" (1 total)');
	expect(lineOf(text, "Nearby text")).toBe('**Nearby text:** "Total", "$12.00"');
	expect(lineOf(text, "Orientation")).toBe("**Orientation:** portrait");
});

test("absent data is omitted, never printed as a placeholder", () => {
	const text = prompt(
		annotation({ testId: undefined, label: "", role: "", type: "" }),
		"",
		"detailed",
	);
	expect(text).not.toContain("undefined");
	expect(text).not.toContain('""');
	expect(text).not.toContain("()");
	for (const name of ["Feedback", "testID", "Value", "Instance", "Enclosing", "React"])
		expect(lineOf(text, name)).toBeUndefined();
});

test("notes from one device and capture share one header and one screenshot line", () => {
	const shared = annotation();
	const other = {
		...annotation(),
		image: { ...shared.image, base64: "AQ==" },
	};
	const text = formatContextPrompt([
		{ note: "One", evidence: shared, deviceName: "iPhone 17" },
		{ note: "Two", evidence: shared, deviceName: "iPhone 17" },
	]);
	expect(text.match(/^## /gm)).toHaveLength(1);
	expect(text.split("\n")[0]).toBe(
		"## Screen feedback: com.example.cart on iPhone 17 (iOS)",
	);
	expect(text.match(/\*\*Screenshot:\*\*/g)).toHaveLength(1);
	const split = formatContextPrompt([
		{ note: "One", evidence: shared },
		{ note: "Two", evidence: other },
		{ note: "Three", evidence: { ...shared, device: "android:one", platform: "android" } },
	]);
	expect(split.match(/^## /gm)).toHaveLength(2);
	expect(split.match(/\*\*Screenshot:\*\*/g)).toHaveLength(3);
	expect(split).toContain("**Screenshot:** 1200x2400 px — attached image 2");
});

test("browser copy and runtime export produce one prompt for the same evidence", () => {
	const evidence = { ...annotation(), deviceName: "iPhone 17" };
	const item: ContextItem = {
		...evidence,
		note: "Make it red",
		id: "remote",
		workspace: "one",
		state: "saved",
		createdAt: 1,
		updatedAt: 1,
	};
	const note = {
		id: "local",
		deviceName: "iPhone 17",
		state: "saved",
		note: "Make it red",
		evidence,
	} as unknown as LiveAnnotationNote;
	for (const detail of CONTEXT_PROMPT_DETAILS)
		expect(exportAnnotationNotes([note], undefined, detail).prompt).toBe(
			exportContext([item], detail).prompt,
		);
});
