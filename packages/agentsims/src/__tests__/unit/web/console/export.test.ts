import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

type Result = {
	request: {
		url: string;
		method: string;
		contentType: string;
		body: { name: string; text: string };
		cancellable: boolean;
	};
	path?: string;
	error?: string;
};

async function run(source: string, failure: "none" | "http" | "receipt") {
	const { downloadLogs } = await import(source);
	const records = [
		{
			device: "ios-1",
			platform: "ios",
			source: "ios-native",
			level: "error",
			receivedAt: 1,
			message: "First log 🌍\nwith a stack",
		},
		{
			device: "android:emulator-5556",
			platform: "android",
			source: "android-native",
			level: "debug",
			receivedAt: 2,
			message: "Last debug log",
		},
	];
	let request: Result["request"] | undefined;
	globalThis.fetch = (async (url: string, options: RequestInit) => {
		request = {
			url,
			method: options.method!,
			contentType: (options.headers as Record<string, string>)["Content-Type"]!,
			body: JSON.parse(options.body as string),
			cancellable: options.signal instanceof AbortSignal,
		};
		return new Response(
			JSON.stringify(
				failure === "receipt" ? {} : { path: "/test/Downloads/logs.txt" },
			),
			{ status: failure === "http" ? 500 : 200 },
		);
	}) as typeof fetch;
	let path: string | undefined, error: string | undefined;
	try {
		path = await downloadLogs(records, "All devices", "/preview/");
	} catch (value) {
		error = (value as Error).message;
	}
	console.log(JSON.stringify({ request, path, error }));
}

function fixture(failure: "none" | "http" | "receipt"): Result {
	const source = new URL("../../../../web/console/export.ts", import.meta.url)
		.href;
	const invocation =
		"(" +
		run.toString() +
		")(" +
		JSON.stringify(source) +
		"," +
		JSON.stringify(failure) +
		")";
	const child = spawnSync(
		process.execPath,
		["--no-install", "--eval", invocation],
		{ encoding: "utf8", timeout: 5000 },
	);
	if (child.error || child.status !== 0)
		throw child.error ?? new Error(child.stderr);
	return JSON.parse(child.stdout) as Result;
}

describe("log file download", () => {
	test("saves all supplied history through the configured runtime and returns the confirmed file", () => {
		const result = fixture("none");
		expect(result.request.url).toBe("/preview/logs/export");
		expect(result.request.method).toBe("POST");
		expect(result.request.contentType).toBe("application/json");
		expect(result.request.body.name).toBe("All devices");
		expect(result.request.body.text).toContain("First log 🌍\nwith a stack");
		expect(result.request.body.text).toContain("Last debug log");
		expect(result.request.cancellable).toBe(true);
		expect(result.path).toBe("/test/Downloads/logs.txt");
		expect(result.error).toBeUndefined();
	});
	test("a failed save cannot report a downloaded file", () => {
		const result = fixture("http");
		expect(result.error).toBe("Could not save logs.");
		expect(result.path).toBeUndefined();
	});
	test("a success response without a file cannot report a downloaded file", () => {
		const result = fixture("receipt");
		expect(result.error).toBe("The runtime did not return a log file.");
		expect(result.path).toBeUndefined();
	});
});
