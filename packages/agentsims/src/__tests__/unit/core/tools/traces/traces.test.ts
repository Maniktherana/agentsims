import { afterAll, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CommandNotFound } from "../../../../../core/tools/errors";
import { makeTraceService } from "../../../../../core/tools/traces/traces";
import {
	actionCommand,
	traceId,
	type TraceCall,
	type TraceEnd,
	type TraceHeader,
} from "../../../../../core/tools/traces/trace-file";

const DEVICE = "UDID-TRACE";
const roots: string[] = [];

function newRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "agentsims-traces-"));
	roots.push(root);
	return root;
}

function service(root: string) {
	return makeTraceService(root, () =>
		Effect.succeed({ bytes: new Uint8Array([7, 7, 7]), extension: "png" }),
	);
}

function lines(directory: string): unknown[] {
	return readFileSync(join(directory, "trace.jsonl"), "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as unknown);
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a trace id slugs the device, the time, and the name", () => {
	expect(
		traceId("android:emulator-5554", null, new Date("2026-09-19T00:12:03.120Z")),
	).toBe("android-emulator-5554-20260919-001203");
	expect(
		traceId("UDID-A", "Check out", new Date("2026-09-19T00:12:03.120Z")),
	).toBe("udid-a-20260919-001203-check-out");
});

test("an action batch is traced under its leading action", () => {
	expect(actionCommand([{ type: "long-press" }])).toBe("long-press");
	expect(actionCommand([{ type: "nonsense" }])).toBe("act");
	expect(actionCommand([])).toBe("act");
});

test("an empty trace directory lists no traces", async () => {
	const root = newRoot();
	const traces = service(root);
	expect(traces.directory()).toBe(root);
	expect(await Effect.runPromise(traces.list())).toEqual([]);
});

test("tracing off returns the command effect untouched", () => {
	const traces = service(newRoot());
	const effect = Effect.succeed("value");
	expect(traces.traced(DEVICE, "observe", {}, effect)).toBe(effect);
	expect(traces.active(DEVICE)).toBeNull();
});

test("a trace records every call, its screenshot, and its end", async () => {
	const root = newRoot();
	const traces = service(root);
	const started = await Effect.runPromise(
		traces.start(DEVICE, { name: "Check out" }),
	);
	expect(started.directory).toBe(join(root, started.id));
	expect(traces.active(DEVICE)?.calls).toBe(0);

	await Effect.runPromise(
		traces.traced(
			DEVICE,
			"observe",
			{ all: false, note: "x".repeat(5000) },
			Effect.succeed({
				device: DEVICE,
				view: { id: "s1" },
				image: {
					status: "ok",
					capturedAt: 1,
					value: {
						bytes: Buffer.from([1, 2, 3, 4]),
						mimeType: "image/png",
						width: 2,
						height: 2,
						captureId: "c1",
						observationId: "s1",
					},
				},
			}),
		),
	);
	await Effect.runPromise(
		traces.traced(
			DEVICE,
			"tap",
			{ actions: [{ type: "tap", target: "Nowhere" }] },
			Effect.succeed({
				dispatch: { status: "none", reason: "No node matches Nowhere." },
			}),
		),
	);
	const failure = await Effect.runPromiseExit(
		traces.traced(
			DEVICE,
			"find",
			{ q: "Save" },
			Effect.fail(new CommandNotFound({ message: "The device is gone." })),
		),
	);
	expect(failure._tag).toBe("Failure");

	const stopped = await Effect.runPromise(traces.stop(DEVICE));
	expect(stopped.calls).toBe(3);
	expect(traces.active(DEVICE)).toBeNull();

	const records = lines(started.directory);
	const header = records[0] as TraceHeader;
	expect(header).toMatchObject({
		type: "trace",
		version: 1,
		id: started.id,
		device: DEVICE,
		platform: "ios",
		name: "Check out",
	});

	const calls = records.slice(1, 4) as TraceCall[];
	expect(calls.map((call) => [call.seq, call.command, call.status])).toEqual([
		[1, "observe", "ok"],
		[2, "tap", "refused"],
		[3, "find", "error"],
	]);
	expect(calls[0]?.screenshot).toBe("screenshots/000001.png");
	expect(calls[1]?.screenshot).toBe("screenshots/000002.png");
	expect(calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
	expect(calls[2]?.result).toBeNull();
	expect(calls[2]?.error).toEqual({
		message: "The device is gone.",
		type: "CommandNotFound",
	});

	const request = calls[0]?.request as { note: string };
	expect(request.note).toHaveLength(4097);
	const observed = calls[0]?.result as {
		image: { value: { bytes: unknown } };
	};
	expect(observed.image.value.bytes).toEqual({ bytes: 4 });

	expect(readdirSync(join(started.directory, "screenshots")).sort()).toEqual([
		"000001.png",
		"000002.png",
		"000003.png",
	]);
	expect(records[4] as TraceEnd).toMatchObject({ type: "end", calls: 3 });

	const listed = await Effect.runPromise(traces.list());
	expect(listed).toHaveLength(1);
	expect(listed[0]).toMatchObject({
		id: started.id,
		device: DEVICE,
		calls: 3,
		endedAt: stopped.endedAt,
	});
	expect(await Effect.runPromise(traces.list("other"))).toEqual([]);

	const document = await Effect.runPromise(traces.read(started.id));
	expect(document.trace).toEqual(header);
	expect(document.calls).toEqual(calls);
	expect(document.end?.calls).toBe(3);

	const png = await Effect.runPromise(
		traces.screenshot(started.id, "000002.png"),
	);
	expect(Array.from(png)).toEqual([7, 7, 7]);
});

test("a copied trace uses its directory name as the public id", async () => {
	const root = newRoot();
	const directoryId = "copied-trace";
	const directory = join(root, directoryId);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "trace.jsonl"),
		`${JSON.stringify({
			type: "trace",
			version: 1,
			id: "original-trace",
			device: DEVICE,
			platform: "ios",
			startedAt: "2026-09-20T08:00:00.000Z",
			name: "Copied",
		})}\n`,
	);

	const traces = service(root);
	const listed = await Effect.runPromise(traces.list());
	expect(listed[0]?.id).toBe(directoryId);
	const document = await Effect.runPromise(traces.read(directoryId));
	expect(document.trace.id).toBe(directoryId);
});

test("one device holds one trace, and stop needs one to be open", async () => {
	const traces = service(newRoot());
	await Effect.runPromise(traces.start(DEVICE));
	const second = await Effect.runPromiseExit(traces.start(DEVICE));
	expect(second._tag).toBe("Failure");
	await Effect.runPromise(traces.stop(DEVICE));
	expect((await Effect.runPromiseExit(traces.stop(DEVICE)))._tag).toBe(
		"Failure",
	);
});

test("a trace read refuses a path that leaves the trace directory", async () => {
	const traces = service(newRoot());
	expect((await Effect.runPromiseExit(traces.read("../secrets")))._tag).toBe(
		"Failure",
	);
	expect(
		(await Effect.runPromiseExit(traces.screenshot("id", "../../passwd")))._tag,
	).toBe("Failure");
});
