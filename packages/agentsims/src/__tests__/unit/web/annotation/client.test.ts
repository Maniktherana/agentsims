import { expect, test } from "bun:test";
import { annotationClipboardFlavors } from "../../../../web/annotation/client";

test("the copied prompt carries plain text and one PNG, never an HTML flavor", async () => {
	const png = new Blob(["png"], { type: "image/png" });
	const flavors = annotationClipboardFlavors(
		Promise.resolve({ prompt: "### 1. button", images: [] }),
		async () => png,
	);
	expect(Object.keys(flavors).sort()).toEqual(["image/png", "text/plain"]);
	expect(await (await flavors["text/plain"]).text()).toBe("### 1. button");
	expect(await flavors["image/png"]).toBe(png);
});
