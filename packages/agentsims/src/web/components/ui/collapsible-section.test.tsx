import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsibleSection } from "./collapsible-section";

const noop = () => {};

describe("CollapsibleSection", () => {
	test("uses a spaced rounded section without an open-state header divider", () => {
		const html = renderToStaticMarkup(
			<CollapsibleSection open onOpenChange={noop} summary="Simulator">
				Body
			</CollapsibleSection>,
		);

		expect(html).toContain(
			"lem-section mx-3 mt-2 overflow-hidden rounded-[10px]",
		);
		expect(html).toContain('data-collapsible-body="true"');
		expect(html).not.toContain("border-t border-white");
		expect(html).not.toContain("border-b border-white");
	});

	test("reserves one trailing disclosure slot after the summary content", () => {
		const html = renderToStaticMarkup(
			<CollapsibleSection open={false} onOpenChange={noop} summary="Media">
				Body
			</CollapsibleSection>,
		);

		const content = html.indexOf("data-collapsible-summary-content");
		const chevron = html.indexOf("data-collapsible-chevron");
		expect(content).toBeGreaterThan(-1);
		expect(chevron).toBeGreaterThan(content);
		expect(html).toContain("size-8 shrink-0");
	});
});
