import { afterEach, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { Effect } from "effect";
import { startTestServer } from "../helpers/server";
import {
	contextImageEvidence,
	contextPng,
	contextJpeg,
} from "../fixtures/context-image";
import type { ContextImageFile } from "../../core/tools/context/image-export";

const servers = new Set<Awaited<ReturnType<typeof startTestServer>>>();
const directories = new Set<string>();
afterEach(async () => {
	for (const { server } of servers) await server.stop();
	servers.clear();
	for (const directory of directories)
		await rm(directory, { recursive: true, force: true });
	directories.clear();
});

async function fixture() {
	let deviceCalls = 0;
	const server = await startTestServer({
		basePath: "/preview",
		readDeviceStates: async () => {
			deviceCalls++;
			return [];
		},
		readForegroundApp: async () => {
			deviceCalls++;
			return null;
		},
		saveScreenshot: () => {
			deviceCalls++;
			return Effect.die("Export must not capture a live screenshot.");
		},
	});
	servers.add(server);
	const post = (path: string, value: unknown) =>
		fetch(`${server.origin}/preview${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(value),
		});
	const capture = async (input = contextImageEvidence()) => {
		const response = await post("/context", { workspace: "one", input });
		expect(response.status).toBe(200);
		const receipt = (await response.json()) as { id: string };
		expect(
			(await post(`/context/${receipt.id}/save`, { workspace: "one" })).status,
		).toBe(200);
		return receipt;
	};
	const exportImages = async (ids: string[]) => {
		const response = await post("/context/export-images", {
			workspace: "one",
			ids,
			path: "/caller-must-not-control-this",
		});
		expect(response.status).toBe(200);
		const files = (await response.json()) as ContextImageFile[];
		for (const file of files) directories.add(dirname(file.path));
		return files;
	};
	return {
		...server,
		post,
		capture,
		exportImages,
		deviceCalls: () => deviceCalls,
	};
}

test("HTTP exports the captured image files for both platforms and they outlive receipt removal and server shutdown", async () => {
	const server = await fixture();
	const ios = await server.capture();
	const android = await server.capture(
		contextImageEvidence("android:b", "android", "image/jpeg"),
	);
	const files = await server.exportImages([android.id, ios.id, android.id]);
	expect(files.map((file) => file.id)).toEqual([android.id, ios.id]);
	expect(files.map((file) => file.mimeType)).toEqual([
		"image/jpeg",
		"image/png",
	]);
	expect(
		files.every(
			(file) => isAbsolute(file.path) && file.width === 1 && file.height === 1,
		),
	).toBe(true);
	const repeated = await server.exportImages([ios.id, android.id]);
	expect(repeated.map((file) => file.path)).toEqual([
		files[1]!.path,
		files[0]!.path,
	]);
	for (const id of [ios.id, android.id]) {
		const removed = await fetch(
			`${server.origin}/preview/context/${id}?workspace=one`,
			{ method: "DELETE" },
		);
		expect(await removed.json()).toEqual({ removed: true });
	}
	expect(server.deviceCalls()).toBe(0);
	await server.server.stop();
	servers.delete(server);
	expect((await readFile(files[0]!.path)).toString("base64")).toBe(contextJpeg);
	expect((await readFile(files[1]!.path)).toString("base64")).toBe(contextPng);
});

test("HTTP rejects invalid or foreign selections and preserves the original context export contract", async () => {
	const { post, capture, exportImages } = await fixture();
	const item = await capture();
	const invalid: unknown[] = [
		null,
		{},
		{ workspace: "one", ids: [] },
		{ workspace: "one", ids: Array(33).fill(item.id) },
	];
	for (const request of invalid) {
		const response = await post("/context/export-images", request);
		expect(response.status).toBe(400);
		expect(((await response.json()) as { code: string }).code).toBe("invalid");
	}
	const foreign = await post("/context/export-images", {
		workspace: "two",
		ids: [item.id],
	});
	expect(foreign.status).toBe(404);
	expect(((await foreign.json()) as { code: string }).code).toBe("missing");
	const original = await post("/context/export", {
		workspace: "one",
		ids: [item.id],
	});
	expect(original.status).toBe(200);
	const exported = (await original.json()) as {
		prompt: string;
		images: { id: string; base64: string }[];
	};
	expect(exported.prompt).toContain("Improve the contrast.");
	expect(exported.images[0]!.base64).toBe(contextPng);
	expect(await exportImages([item.id])).toHaveLength(1);
});
