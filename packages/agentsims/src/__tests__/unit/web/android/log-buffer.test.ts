import { expect, test } from "bun:test";
import { appendAndroidLogLines } from "../../../../web/android/log-buffer";
import type { AndroidLogLine } from "../../../../android/contracts";

test("paused browser logs stay within row and text budgets", () => {
	const line: AndroidLogLine = {
		id: 1,
		time: "12:00",
		pid: 1,
		tid: 1,
		level: "I",
		tag: "Example",
		message: "x".repeat(4096),
	};
	const rows = appendAndroidLogLines(
		[],
		Array.from({ length: 10000 }, (_, id) => ({ ...line, id })),
	);
	expect(rows.length).toBeLessThan(130);
	expect(rows.at(-1)?.id).toBe(9999);
	expect(
		rows.reduce(
			(bytes, row) =>
				bytes +
				(row.message.length + row.tag.length + row.time.length + 64) * 2,
			0,
		),
	).toBeLessThanOrEqual(1024 * 1024);
});
