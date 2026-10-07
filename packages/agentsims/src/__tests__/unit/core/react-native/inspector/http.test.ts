import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	inspectorJson,
	symbolicateRnLog,
} from "../../../../../core/react-native/inspector/http";
import {
	metroOrigin,
	parseRnLog,
} from "../../../../../core/react-native/inspector/protocol";
import { createRnProjectContext } from "../../../../../core/react-native/source-context";

const metro = metroOrigin("http://localhost:8081");
const signal = () => new AbortController().signal;
const project = createRnProjectContext(
	"/private/tmp/agentsims-inspector-fixture",
);
function errorLog(url = "http://localhost:8081/index.bundle?platform=ios") {
	return parseRnLog(
		{
			method: "Runtime.exceptionThrown",
			params: {
				exceptionDetails: {
					text: "Uncaught",
					stackTrace: {
						callFrames: [
							{
								functionName: "generated",
								url,
								lineNumber: 99,
								columnNumber: 3,
							},
						],
					},
				},
			},
		},
		{
			device: "one",
			platform: "ios",
			app: "com.example",
			projectId: project.projectKey,
			receivedAt: 20,
		},
	)!;
}

describe("bounded inspector HTTP", () => {
	test("rejects a large body while streaming, cancels it, and disables redirects", async () => {
		let cancelled = false;
		let options: RequestInit | undefined;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(5));
				controller.enqueue(new Uint8Array(5));
			},
			cancel() {
				cancelled = true;
			},
		});
		await expect(
			inspectorJson(
				async (_url, init) => {
					options = init;
					return new Response(body);
				},
				metro,
				{ signal: signal(), timeoutMs: 100, bytes: 8 },
			),
		).rejects.toThrow("byte limit");
		expect(cancelled).toBe(true);
		expect(options?.redirect).toBe("error");
		expect(options?.signal).toBeInstanceOf(AbortSignal);
	});
	test("a deadline cancels a stalled response reader", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			},
		});
		await expect(
			inspectorJson(async () => new Response(body), metro, {
				signal: signal(),
				timeoutMs: 5,
				bytes: 100,
			}),
		).rejects.toThrow("cancelled");
		expect(cancelled).toBe(true);
	});
	test("caller cancellation and Content-Length limits release the response", async () => {
		for (const length of ["1000", null]) {
			let cancelled = false;
			const body = new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true;
				},
			});
			const abort = new AbortController();
			const pending = inspectorJson(
				async () =>
					new Response(body, {
						headers: length ? { "Content-Length": length } : undefined,
					}),
				metro,
				{ signal: abort.signal, timeoutMs: 100, bytes: 100 },
			);
			if (!length) setTimeout(() => abort.abort(), 2);
			await expect(pending).rejects.toThrow();
			expect(cancelled).toBe(true);
		}
	});
});

describe("project-bound RN symbolication", () => {
	test("posts Metro's line and column convention and freezes accepted source frames", async () => {
		let request: { url: string; init: RequestInit } | undefined;
		const raw = errorLog();
		const result = await symbolicateRnLog(
			raw,
			project,
			metro,
			async (url, init) => {
				request = { url, init };
				return Response.json({
					stack: [
						{
							file: "src/App.tsx",
							lineNumber: 12,
							column: 4,
							methodName: "render",
						},
					],
					codeFrame: { content: "ignored" },
				});
			},
			signal(),
		);
		expect(request?.url).toBe("http://localhost:8081/symbolicate");
		expect(request?.init.method).toBe("POST");
		expect(JSON.parse(request?.init.body as string).stack[0]).toMatchObject({
			lineNumber: 100,
			column: 3,
		});
		expect(result.record.stack).toBe(
			`render (${project.projectRoot}/src/App.tsx:12:5)`,
		);
		expect(Object.isFrozen(result.record)).toBe(true);
		expect(Object.isFrozen(result.frames[0])).toBe(true);
		expect(raw.record.stack).toContain("index.bundle");
		expect(result.record.receivedAt).toBe(raw.record.receivedAt);
	});
	test("foreign bundles, external paths, malformed frames and missing maps preserve the raw event", async () => {
		let calls = 0;
		const foreign = errorLog("http://other.example/index.bundle");
		expect(
			await symbolicateRnLog(
				foreign,
				project,
				metro,
				async () => {
					calls++;
					return Response.json({});
				},
				signal(),
			),
		).toBe(foreign);
		expect(calls).toBe(0);
		const raw = errorLog();
		for (const stack of [
			[],
			[{ file: "../../outside.tsx", lineNumber: 1, column: 0 }],
			[
				{
					file: "http://localhost:8081/index.bundle",
					lineNumber: 1,
					column: 0,
				},
			],
			[{ file: "src/App.tsx", lineNumber: 0, column: 0 }],
			[{ file: "src/App.tsx", lineNumber: 1, column: -1 }],
		])
			expect(
				await symbolicateRnLog(
					raw,
					project,
					metro,
					async () => Response.json({ stack }),
					signal(),
				),
			).toBe(raw);
		expect(
			await symbolicateRnLog(
				raw,
				project,
				metro,
				async () => {
					throw new Error("No map");
				},
				signal(),
			),
		).toBe(raw);
	});
	test("symlinks outside the selected canonical project cannot become source frames", async () => {
		const temp = await mkdtemp(join(tmpdir(), "agentsims-rn-logs-"));
		try {
			const root = join(temp, "project");
			await mkdir(root);
			await writeFile(join(temp, "outside.tsx"), "private");
			await symlink(join(temp, "outside.tsx"), join(root, "escape.tsx"));
			await mkdir(join(temp, "outside-dir"));
			await symlink(join(temp, "outside-dir"), join(root, "escape-dir"));
			const bound = createRnProjectContext(root);
			const raw = errorLog();
			expect(
				await symbolicateRnLog(
					raw,
					bound,
					metro,
					async () =>
						Response.json({
							stack: [{ file: "escape.tsx", lineNumber: 1, column: 0 }],
						}),
					signal(),
				),
			).toBe(raw);
			expect(
				await symbolicateRnLog(
					raw,
					bound,
					metro,
					async () =>
						Response.json({
							stack: [
								{ file: "escape-dir/missing.tsx", lineNumber: 1, column: 0 },
							],
						}),
					signal(),
				),
			).toBe(raw);
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
});
