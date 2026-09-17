import { describe, expect, test } from "bun:test";
import { startTestServer } from "../helpers/server";

const TOKEN = "test-token-abc123";

async function withServer<T>(fn: (origin: string) => Promise<T>): Promise<T> {
	const { origin, server } = await startTestServer({ execToken: TOKEN });
	try {
		return await fn(origin);
	} finally {
		await server.stop();
	}
}

describe("/exec auth", () => {
	test("returns a command failure with its actual stderr and exit status", async () => {
		await withServer(async (origin) => {
			const response = await fetch(`${origin}/exec`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TOKEN}`,
				},
				body: JSON.stringify({
					command: "printf partial; printf failed >&2; exit 7",
				}),
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				stdout: "partial",
				stderr: "failed",
				exitCode: 7,
			});
		});
	});

	test("rejects unauthenticated POST", async () => {
		await withServer(async (origin) => {
			const r = await fetch(`${origin}/exec`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ command: "echo hi" }),
			});
			expect(r.status).toBe(401);
		});
	});

	test("rejects non-JSON Content-Type (CSRF-simple-POST path)", async () => {
		await withServer(async (origin) => {
			const r = await fetch(`${origin}/exec`, {
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
					Authorization: `Bearer ${TOKEN}`,
				},
				body: JSON.stringify({ command: "echo hi" }),
			});
			expect(r.status).toBe(415);
		});
	});

	test("rejects cross-origin POST", async () => {
		await withServer(async (origin) => {
			const r = await fetch(`${origin}/exec`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TOKEN}`,
					Origin: "http://evil.example",
				},
				body: JSON.stringify({ command: "echo hi" }),
			});
			expect(r.status).toBe(403);
		});
	});

	test("rejects wrong bearer token", async () => {
		await withServer(async (origin) => {
			const r = await fetch(`${origin}/exec`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer not-the-token",
				},
				body: JSON.stringify({ command: "echo hi" }),
			});
			expect(r.status).toBe(401);
		});
	});

	test("accepts same-origin POST with bearer token", async () => {
		await withServer(async (origin) => {
			const r = await fetch(`${origin}/exec`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TOKEN}`,
					Origin: origin,
				},
				body: JSON.stringify({ command: "echo serve-sim-test" }),
			});
			expect(r.status).toBe(200);
			const body = (await r.json()) as { stdout: string; exitCode: number };
			expect(body.stdout.trim()).toBe("serve-sim-test");
			expect(body.exitCode).toBe(0);
		});
	});
});
