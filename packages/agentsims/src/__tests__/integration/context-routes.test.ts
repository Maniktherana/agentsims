import { afterEach, expect, test } from "bun:test";
import { startTestServer } from "../helpers/server";
import {
	ApplicationCommandClient,
	CommandRequestError,
} from "../../cli/application-command-client";
import { Command } from "commander";
import { registerContextCommands } from "../../cli/commands/context";
import type { ContextInput } from "../../core/tools/context/contracts";
import { LogStore } from "../../core/tools/logs/store";

const servers: Awaited<ReturnType<typeof startTestServer>>[] = [];
afterEach(async () => {
	for (const { server } of servers.splice(0)) await server.stop();
});
async function fixture() {
	const server = await startTestServer();
	servers.push(server);
	return {
		...server,
		client: new ApplicationCommandClient({ origin: server.origin }),
	};
}
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZkAAAAASUVORK5CYII=";
function evidence(
	device = "ios-a",
	platform: "ios" | "android" = "ios",
): ContextInput {
	return {
		kind: "annotation",
		sessionId: "session-a",
		device,
		platform,
		capturedAt: 123456,
		note: "Improve the contrast.",
		logs: [],
		target: {
			kind: "region",
			reason: "missing-tree",
			rect: { x: 0, y: 0, width: 1, height: 1 },
		},
		image: { mimeType: "image/png", width: 1, height: 1, base64: png },
	};
}

test("HTTP keeps both device drafts, exports captured images, and never calls device operations", async () => {
	const { client, origin } = await fixture();
	const ios = (await client.createContext(
		"one",
		evidence(),
		"capture-ios",
	)) as { id: string; image: object };
	const android = (await client.createContext(
		"one",
		evidence("android:b", "android"),
		"capture-android",
	)) as { id: string };
	expect(ios.image).not.toHaveProperty("base64");
	expect((await client.listContext("one")) as object[]).toHaveLength(2);
	expect(
		((await client.listContext("one", "ios-a")) as { id: string }[]).map(
			(item) => item.id,
		),
	).toEqual([ios.id]);
	expect(await client.listContext("two")).toEqual([]);
	await client.updateContext("one", ios.id, "Make this easier to read.");
	await client.saveContext("one", ios.id);
	const exported = (await client.exportContext("one", [
		ios.id,
		android.id,
	])) as { prompt: string; images: { base64: string }[] };
	expect(exported.prompt).toContain("Make this easier to read.");
	expect(exported.prompt).toContain("Device: ios-a (ios)");
	expect(exported.prompt).toContain("Device: android:b (android)");
	expect(exported.images.map((image) => image.base64)).toEqual([png, png]);
	const response = await fetch(
		`${origin}/context/${ios.id}/image?workspace=one`,
	);
	expect(response.headers.get("content-type")).toBe("image/png");
	expect(Buffer.from(await response.arrayBuffer()).toString("base64")).toBe(
		png,
	);
});

test("capture retries return one item and preserve later note edits", async () => {
	const { client } = await fixture();
	const input = evidence();
	const first = (await client.createContext("one", input, "same-capture")) as {
		id: string;
	};
	await client.updateContext("one", first.id, "Edited note");
	const repeated = (await client.createContext(
		"one",
		input,
		"same-capture",
	)) as { id: string; note: string };
	expect(repeated.id).toBe(first.id);
	expect(repeated.note).toBe("Edited note");
	expect((await client.listContext("one")) as unknown[]).toHaveLength(1);
	await expect(
		client.createContext(
			"one",
			{ ...input, note: "Different capture" },
			"same-capture",
		),
	).rejects.toBeInstanceOf(CommandRequestError);
	expect(
		((await client.saveContext("one", first.id)) as { state: string }).state,
	).toBe("saved");
	expect(
		((await client.saveContext("one", first.id)) as { state: string }).state,
	).toBe("saved");
	expect(await client.removeContext("one", first.id)).toEqual({
		removed: true,
	});
	expect(await client.removeContext("one", first.id)).toEqual({
		removed: false,
	});
});

test("workspace identity prevents foreign image, note, and export reads", async () => {
	const { client, origin } = await fixture();
	const item = (await client.createContext("one", evidence())) as {
		id: string;
	};
	await expect(
		client.updateContext("two", item.id, "wrong"),
	).rejects.toBeInstanceOf(CommandRequestError);
	await expect(client.exportContext("two", [item.id])).rejects.toBeInstanceOf(
		CommandRequestError,
	);
	expect(
		(await fetch(`${origin}/context/${item.id}/image?workspace=two`)).status,
	).toBe(404);
	expect(await client.removeContext("two", item.id)).toEqual({
		removed: false,
	});
	expect((await client.listContext("one")) as unknown[]).toHaveLength(1);
});

test("two server scopes cannot share saved evidence", async () => {
	const a = await fixture(),
		b = await fixture();
	const item = (await a.client.createContext("one", evidence())) as {
		id: string;
	};
	expect(await b.client.listContext("one")).toEqual([]);
	await expect(b.client.exportContext("one", [item.id])).rejects.toBeInstanceOf(
		CommandRequestError,
	);
});

test("invalid and oversized requests fail before context retention", async () => {
	const { origin, client } = await fixture();
	for (const body of [
		"null",
		"{}",
		"{",
		JSON.stringify({ workspace: "one", input: { ...evidence(), device: "" } }),
	]) {
		expect(
			(await fetch(`${origin}/context`, { method: "POST", body })).status,
		).toBe(400);
	}
	expect(
		(
			await fetch(`${origin}/context`, {
				method: "POST",
				body: "x".repeat(12 * 1024 * 1024 + 1),
			})
		).status,
	).toBe(413);
	let remaining = 13;
	const streamed = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (remaining-- > 0) controller.enqueue(new Uint8Array(1024 * 1024));
			else controller.close();
		},
	});
	expect(
		(await fetch(`${origin}/context`, { method: "POST", body: streamed }))
			.status,
	).toBe(413);
	expect(await client.listContext("one")).toEqual([]);
});

test("CLI export uses selected IDs and the same HTTP evidence", async () => {
	const { client, origin } = await fixture();
	const item = (await client.createContext("one", evidence())) as {
		id: string;
	};
	let output = "";
	const program = registerContextCommands(new Command(), {
		client: () => client,
		write: (text) => {
			output += text;
		},
	});
	await program.parseAsync(
		["context", "export", item.id, "--workspace", "one", "--url", origin],
		{ from: "user" },
	);
	const exported = JSON.parse(output);
	expect(exported.prompt).toContain("Improve the contrast.");
	expect(exported.images[0].base64).toBe(png);
	expect((await client.listContext("one")) as unknown[]).toHaveLength(1);
});

test("context preserves normalized Unicode logs and long device cursors", async () => {
	const { client } = await fixture();
	const device = "📱".repeat(72);
	const logs = new LogStore();
	const record = logs.append({
		device,
		platform: "ios",
		source: "react-native",
		level: "error",
		message: "🔥".repeat(4096),
		sourceTime: { text: "t".repeat(512) },
	});
	const item = (await client.createContext("one", {
		kind: "logs",
		device,
		platform: "ios",
		capturedAt: Number.MAX_SAFE_INTEGER,
		note: "Inspect this error.",
		logs: [record],
	})) as { id: string };
	const exported = (await client.exportContext("one", [item.id])) as {
		prompt: string;
	};
	expect(exported.prompt).toContain(record.message);
	expect(exported.prompt).toContain(record.sourceTime!.text);
	expect(exported.prompt).toContain(String(Number.MAX_SAFE_INTEGER));
	logs.dispose();
});
