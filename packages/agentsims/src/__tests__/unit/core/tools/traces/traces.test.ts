import { afterAll, expect, test } from "bun:test";
import {
	mkdirSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Fiber } from "effect";
import { Devices, type DeviceService } from "../../../../../core/tools/devices/devices";
import { CommandNotFound } from "../../../../../core/tools/errors";
import { makeTraceService, Traces, TracesLive } from "../../../../../core/tools/traces/traces";
import {
	actionCommand,
	traceId,
	type TraceCall,
	type TraceEnd,
	type TraceHeader,
	type TraceWriter,
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

function deferred<A>() {
	let resolve!: (value: A) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<A>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function writerFixture() {
	const records: Array<TraceHeader | TraceCall | TraceEnd> = [];
	const images = new Map<string, Uint8Array>();
	let closes = 0;
	const writer: TraceWriter = {
		append: async (record) => { records.push(record); },
		screenshot: (name, bytes) => { images.set(name, bytes); },
		close: async (record) => { closes += 1; records.push(record); },
	};
	return { writer, records, images, closes: () => closes };
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
	const events: string[] = [];
	const unsubscribe = traces.subscribe((event) => events.push(event.type));
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
	unsubscribe();
	expect(stopped.calls).toBe(3);
	expect(events).toEqual(["started", "call", "call", "call", "stopped"]);
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
	mkdirSync(join(directory, "screenshots"), { recursive: true });
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

	const individual = await Effect.runPromise(traces.openSource(directory));
	expect(individual.selectedId).toBe(directoryId);
	expect(
		(await Effect.runPromise(
			traces.readSource(individual.id, directoryId),
		)).trace.id,
	).toBe(directoryId);

	const library = await Effect.runPromise(traces.openSource(root));
	expect(library.selectedId).toBeNull();
	expect(library.traces.map((trace) => trace.id)).toEqual([directoryId]);
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

test("automatic tracing is lazy, isolates iOS and Android, and reuses only result images", async () => {
	const root = newRoot();
	let captures = 0;
	const traces = makeTraceService(root, () => Effect.sync(() => {
		captures += 1;
		return { bytes: new Uint8Array([99]), extension: "png" };
	}), { automatic: true });
	const observed = {
		observation: { image: { status: "ok", value: {
			bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg",
		} } },
	};
	const command = traces.traced(DEVICE, "observe", {}, Effect.succeed(observed));
	expect(traces.active(DEVICE)).toBeNull();
	expect(readdirSync(root)).toEqual([]);
	expect(await Effect.runPromise(command)).toBe(observed);
	expect(await Effect.runPromise(traces.traced(
		"android:emulator-5554", "tap", {}, Effect.succeed({ dispatch: { status: "none" } }),
	))).toEqual({ dispatch: { status: "none" } });
	await Effect.runPromise(traces.stopAll());
	expect(captures).toBe(0);
	const listed = await Effect.runPromise(traces.list());
	expect(listed).toHaveLength(2);
	for (const summary of listed) {
		const document = await Effect.runPromise(traces.read(summary.id));
		expect(document.end?.calls).toBe(1);
		if (summary.device === DEVICE) {
			expect(summary.platform).toBe("ios");
			expect(document.calls[0]?.screenshot).toBe("screenshots/000001.jpg");
			expect(Array.from(await Effect.runPromise(traces.screenshot(summary.id, "000001.jpg")))).toEqual([1, 2, 3]);
		} else {
			expect(summary.device).toBe("android:emulator-5554");
			expect(summary.platform).toBe("android");
			expect(document.calls[0]?.status).toBe("refused");
			expect(document.calls[0]?.screenshot).toBeNull();
		}
	}
});

test("concurrent first commands share a pending writer and return before disk startup", async () => {
	const opening = deferred<TraceWriter>();
	const fixture = writerFixture();
	let opens = 0;
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true,
		openWriter: () => { opens += 1; return opening.promise; },
	});
	expect(await Promise.all([
		Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("first"))),
		Effect.runPromise(traces.traced(DEVICE, "key", {}, Effect.succeed("second"))),
	])).toEqual(["first", "second"]);
	expect(opens).toBe(1);
	expect(traces.active(DEVICE)).toBeNull();
	expect((await Effect.runPromiseExit(traces.start(DEVICE)))._tag).toBe("Failure");
	const stopping = Effect.runPromise(traces.stop(DEVICE));
	expect(fixture.closes()).toBe(0);
	opening.resolve(fixture.writer);
	expect((await stopping).calls).toBe(2);
	expect(fixture.closes()).toBe(1);
	expect(fixture.records.map((record) => record.type)).toEqual(["trace", "call", "call", "end"]);
	expect((fixture.records.slice(1, 3) as TraceCall[]).map((call) => [call.seq, call.result])).toEqual([[1, "first"], [2, "second"]]);
});

test("a pending manual start is reused and rejects a duplicate start", async () => {
	const opening = deferred<TraceWriter>();
	const fixture = writerFixture();
	let opens = 0;
	let captures = 0;
	const traces = makeTraceService(newRoot(), () => Effect.sync(() => {
		captures += 1;
		return { bytes: new Uint8Array([3]), extension: "png" };
	}), {
		automatic: true,
		openWriter: () => { opens += 1; return opening.promise; },
	});
	const starting = Effect.runPromise(traces.start(DEVICE, { name: "Manual" }));
	expect((await Effect.runPromiseExit(traces.start(DEVICE)))._tag).toBe("Failure");
	expect(await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("input")))).toBe("input");
	expect(captures).toBe(1);
	expect(opens).toBe(1);
	opening.resolve(fixture.writer);
	await starting;
	await Effect.runPromise(traces.stop(DEVICE));
	expect(fixture.records[0]).toMatchObject({ type: "trace", name: "Manual" });
	expect(fixture.images.get("000001.png")).toEqual(new Uint8Array([3]));
	expect(fixture.closes()).toBe(1);
});

test("explicit stop stays stopped, and explicit start restores manual screenshot behavior", async () => {
	const root = newRoot();
	let captures = 0;
	const traces = makeTraceService(root, () => Effect.sync(() => {
		captures += 1;
		return { bytes: new Uint8Array([4]), extension: "png" };
	}), { automatic: true });
	await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("automatic")));
	const stopped = await Effect.runPromise(traces.stop(DEVICE));
	await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("off")));
	expect(traces.active(DEVICE)).toBeNull();
	expect((await Effect.runPromise(traces.list())).map((trace) => trace.id)).toEqual([stopped.id]);
	expect(captures).toBe(0);
	const manual = await Effect.runPromise(traces.start(DEVICE));
	expect(manual.id).not.toBe(stopped.id);
	await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("manual")));
	await Effect.runPromise(traces.stop(DEVICE));
	expect(captures).toBe(1);
	expect((await Effect.runPromise(traces.read(stopped.id))).calls[0]?.result).toBe("automatic");
	expect((await Effect.runPromise(traces.read(manual.id))).calls[0]?.result).toBe("manual");
});

test("stop before a first command suppresses automatic tracing only for that device", async () => {
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), { automatic: true });
	expect((await Effect.runPromiseExit(traces.stop(DEVICE)))._tag).toBe("Failure");
	await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("off")));
	await Effect.runPromise(traces.traced("android:emulator-5554", "tap", {}, Effect.succeed("on")));
	await Effect.runPromise(traces.stopAll());
	expect((await Effect.runPromise(traces.list())).map((trace) => trace.device)).toEqual(["android:emulator-5554"]);
	const fresh = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), { automatic: true });
	await Effect.runPromise(fresh.traced(DEVICE, "tap", {}, Effect.succeed("new runtime")));
	await Effect.runPromise(fresh.stopAll());
	expect(await Effect.runPromise(fresh.list())).toHaveLength(1);
});

test("stop drains admitted commands and does not send later commands into a closing trace", async () => {
	const fixture = writerFixture();
	const started = deferred<void>();
	const input = deferred<string>();
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true, openWriter: async () => fixture.writer,
	});
	const command = Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.promise(() => {
		started.resolve();
		return input.promise;
	})));
	await started.promise;
	const stopping = Effect.runPromise(traces.stop(DEVICE));
	expect(await Effect.runPromise(traces.traced(DEVICE, "key", {}, Effect.succeed("after stop")))).toBe("after stop");
	expect((await Effect.runPromiseExit(traces.start(DEVICE)))._tag).toBe("Failure");
	expect(fixture.closes()).toBe(0);
	input.resolve("original result");
	expect(await command).toBe("original result");
	expect((await stopping).calls).toBe(1);
	expect((fixture.records[1] as TraceCall).result).toBe("original result");
	expect(fixture.closes()).toBe(1);
});

test("finalization waits for pending startup and writes, and concurrent stops close once", async () => {
	const opening = deferred<TraceWriter>();
	const writeStarted = deferred<void>();
	const writeFinished = deferred<void>();
	const fixture = writerFixture();
	const writer: TraceWriter = {
		...fixture.writer,
		append: async (record) => {
			await fixture.writer.append(record);
			if (record.type === "call") {
				writeStarted.resolve();
				await writeFinished.promise;
			}
		},
	};
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true, openWriter: () => opening.promise,
	});
	await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("input")));
	const stopping = Effect.runPromise(traces.stop(DEVICE));
	const finalizing = Effect.runPromise(traces.stopAll());
	opening.resolve(writer);
	await writeStarted.promise;
	expect(fixture.closes()).toBe(0);
	writeFinished.resolve();
	await stopping;
	await finalizing;
	expect(fixture.closes()).toBe(1);
	expect(fixture.records.at(-1)).toMatchObject({ type: "end", calls: 1 });
	await Effect.runPromise(traces.traced("android:emulator-5554", "tap", {}, Effect.succeed("closed")));
	expect(traces.active("android:emulator-5554")).toBeNull();
	expect((await Effect.runPromiseExit(traces.start(DEVICE)))._tag).toBe("Failure");
});

test("startup failures preserve success, typed failures, defects, and interruption", async () => {
	const original = new CommandNotFound({ message: "Original failure" });
	const defect = new Error("Original defect");
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true, openWriter: async () => { throw new Error("Unwritable trace directory"); },
	});
	const value = { result: "original success" };
	expect(await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed(value)))).toBe(value);
	const failure = await Effect.runPromiseExit(traces.traced(DEVICE, "tap", {}, Effect.fail(original)));
	expect(Exit.isFailure(failure) && Cause.squash(failure.cause)).toBe(original);
	const died = await Effect.runPromiseExit(traces.traced(DEVICE, "tap", {}, Effect.die(defect)));
	expect(Exit.isFailure(died) && Cause.squash(died.cause)).toBe(defect);
	const interrupted = await Effect.runPromiseExit(traces.traced(DEVICE, "tap", {}, Effect.interrupt));
	expect(Exit.isFailure(interrupted) && Cause.isInterrupted(interrupted.cause)).toBe(true);
	await Effect.runPromise(traces.stopAll());
	expect(traces.active(DEVICE)).toBeNull();
});

test("external interruption returns before trace startup and finalization still owns the pending writer", async () => {
	const opening = deferred<TraceWriter>();
	const inputStarted = deferred<void>();
	const fixture = writerFixture();
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true, openWriter: () => opening.promise,
	});
	await Effect.runPromise(Effect.gen(function* () {
		const fiber = yield* Effect.fork(traces.traced(DEVICE, "tap", {}, Effect.sync(() => {
			inputStarted.resolve();
		}).pipe(Effect.zipRight(Effect.never))));
		yield* Effect.promise(() => inputStarted.promise);
		const exit = yield* Fiber.interrupt(fiber);
		expect(Exit.isFailure(exit) && Cause.isInterrupted(exit.cause)).toBe(true);
	}));
	expect(fixture.closes()).toBe(0);
	const finalizing = Effect.runPromise(traces.stopAll());
	opening.resolve(fixture.writer);
	await finalizing;
	expect(fixture.closes()).toBe(1);
	expect(fixture.records[1]).toMatchObject({ type: "call", status: "error", result: null });
	expect(fixture.records.at(-1)).toMatchObject({ type: "end", calls: 1 });
});

test("a failed header closes its allocated writer without changing input", async () => {
	const fixture = writerFixture();
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true,
		openWriter: async () => ({
			...fixture.writer,
			append: async () => { throw new Error("Header failure"); },
		}),
	});
	expect(await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("input")))).toBe("input");
	await Effect.runPromise(traces.stopAll());
	expect(fixture.closes()).toBe(1);
	expect(traces.active(DEVICE)).toBeNull();
});

test("failed writes and subscribers cannot change input results or leak writers", async () => {
	const fixture = writerFixture();
	const traces = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true,
		openWriter: async () => ({
			...fixture.writer,
			append: async (record) => {
				if (record.type === "call") throw new Error("Write failure");
				await fixture.writer.append(record);
			},
		}),
	});
	traces.subscribe(() => { throw new Error("Subscriber failure"); });
	expect(await Effect.runPromise(traces.traced(DEVICE, "tap", {}, Effect.succeed("input")))).toBe("input");
	await Effect.runPromise(traces.stopAll());
	expect(fixture.closes()).toBe(1);
	const circular: { self?: unknown } = {};
	circular.self = circular;
	const serialization = makeTraceService(newRoot(), () => Effect.die("Unexpected capture"), {
		automatic: true, openWriter: async () => writerFixture().writer,
	});
	expect(await Effect.runPromise(serialization.traced(DEVICE, "tap", circular, Effect.succeed(circular)))).toBe(circular);
	await Effect.runPromise(serialization.stopAll());
});

test("TracesLive enables lazy automatic tracing and its Effect scope finalizes the writer", async () => {
	const root = newRoot();
	const previous = process.env.AGENTSIMS_HOME_DIR;
	process.env.AGENTSIMS_HOME_DIR = root;
	const opened = deferred<void>();
	const devices = { captureScreenshot: () => Effect.die("Automatic tracing cannot capture") } as DeviceService;
	let id: string | undefined;
	try {
		const traces = await Effect.runPromise(Effect.gen(function* () {
			const traces = yield* Traces;
			expect(existsSync(join(root, "traces"))).toBe(false);
			traces.subscribe((event) => { if (event.type === "started") opened.resolve(); });
			expect(yield* traces.traced(DEVICE, "tap", {}, Effect.succeed("input"))).toBe("input");
			yield* Effect.promise(() => opened.promise);
			id = traces.active(DEVICE)?.id;
			return traces;
		}).pipe(Effect.provide(TracesLive), Effect.provideService(Devices, devices)));
		expect(traces.active(DEVICE)).toBeNull();
		expect(id).toBeDefined();
		const document = await Effect.runPromise(traces.read(id!));
		expect(document.calls[0]?.screenshot).toBeNull();
		expect(document.calls[0]?.result).toBe("input");
		expect(document.end?.calls).toBe(1);
	} finally {
		if (previous === undefined) delete process.env.AGENTSIMS_HOME_DIR;
		else process.env.AGENTSIMS_HOME_DIR = previous;
	}
});
