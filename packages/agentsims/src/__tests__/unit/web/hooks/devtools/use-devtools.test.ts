import { describe, expect, test } from "bun:test";
import { reuseDevToolsTargets } from "../../../../../web/hooks/devtools/use-devtools";
import type { DevToolsTarget } from "../../../../../web/devtools/client";

const target = (id: string) =>
	({ id, title: id, url: `https://${id}` }) as unknown as DevToolsTarget;

describe("DevTools target poll", () => {
	test("a poll with the same targets keeps the previous array and sets no new state", () => {
		const previous = [target("a")];
		expect(reuseDevToolsTargets(previous, [target("a")])).toBe(previous);
	});

	test("a changed poll returns the new targets", () => {
		const next = [target("b")];
		expect(reuseDevToolsTargets([target("a")], next)).toBe(next);
	});
});
