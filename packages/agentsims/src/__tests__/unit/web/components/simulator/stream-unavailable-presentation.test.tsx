import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { streamSurfaceState } from "../../../../../web/components/simulator/simulator-view";
import { StreamPlaceholder } from "../../../../../web/components/simulator/stream-placeholder";

describe("unavailable stream presentation", () => {
	test("dims a retained frame but uses the placeholder before any frame", () => {
		expect(streamSurfaceState(false, true)).toBe("retained-frame");
		expect(streamSurfaceState(false, false)).toBe("placeholder");
		expect(streamSurfaceState(true, true)).toBe("live");
	});

	test("reuses the blue device placeholder surface", () => {
		const html = renderToStaticMarkup(<StreamPlaceholder />);

		expect(html).toContain('data-agentsims-stream-placeholder="true"');
		expect(html).toContain(
			"linear-gradient(145deg,#6fa8e6_0%,#5b93d6_55%,#5188cf_100%)",
		);
	});
});
