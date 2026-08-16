#!/usr/bin/env bun
import { execFile, execFileSync } from "node:child_process";
import {
	AvccDemuxer,
	type AvccChunkType,
} from "../src/web/simulator/stream/avcc-codec";

const base = (process.env.AGENTSIMS_URL || "http://127.0.0.1:3200").replace(
	/\/$/,
	"",
);
const serial = process.argv[2] || "emulator-5554";
const device = `android:${serial}`;
const helper = `${base}/helper/${encodeURIComponent(device)}`;
const wsBase = base.replace(/^http/, "ws");
const durationMs = Math.max(1_000, Number(process.argv[3] ?? 15_000));
const inputFps = Math.min(120, Math.max(1, Number(process.argv[4] ?? 60)));
const inputMode = process.argv[5] === "adb" ? "adb" : "native";

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function touch(
	type: "begin" | "move" | "end",
	x: number,
	y: number,
): Uint8Array {
	const json = new TextEncoder().encode(JSON.stringify({ type, x, y }));
	const message = new Uint8Array(1 + json.length);
	message[0] = 0x03;
	message.set(json, 1);
	return message;
}

function emulatorPid(): string | null {
	try {
		const output = execFileSync("ps", ["-axo", "pid=,command="], {
			encoding: "utf8",
		});
		const line = output
			.split("\n")
			.find(
				(entry) =>
					entry.includes(`qemu-system-aarch64 @`) && entry.includes("Pixel_10"),
			);
		return line?.trim().split(/\s+/, 1)[0] ?? null;
	} catch {
		return null;
	}
}

function startCpuSampler(pid: string | null, samples: number[]): () => void {
	if (!pid) return () => {};
	let running = false;
	const timer = setInterval(() => {
		if (running) return;
		running = true;
		execFile(
			"ps",
			["-p", pid, "-o", "%cpu="],
			{ encoding: "utf8" },
			(error, stdout) => {
				running = false;
				if (error) return;
				const value = Number(stdout.trim());
				if (Number.isFinite(value)) samples.push(value);
			},
		);
	}, 500);
	return () => clearInterval(timer);
}

async function swipe(ws: WebSocket, fromX: number, toX: number): Promise<void> {
	const y = 0.55;
	const swipeDurationMs = 1_000 / 3;
	const steps = Math.max(1, Math.round((inputFps * swipeDurationMs) / 1_000));
	ws.send(touch("begin", fromX, y));
	for (let step = 1; step <= steps; step += 1) {
		ws.send(touch("move", fromX + (toX - fromX) * (step / steps), y));
		await wait(swipeDurationMs / steps);
	}
	ws.send(touch("end", toX, y));
}

function adbSwipe(fromX: number, toX: number): Promise<void> {
	const width = 1080;
	const height = 2424;
	const y = Math.round(height * 0.55);
	return new Promise((resolve, reject) => {
		execFile(
			"adb",
			[
				"-s",
				serial,
				"shell",
				"input",
				"swipe",
				String(Math.round(width * fromX)),
				String(y),
				String(Math.round(width * toX)),
				String(y),
				"333",
			],
			{ timeout: 2_000 },
			(error) => (error ? reject(error) : resolve()),
		);
	});
}

async function openControl(): Promise<WebSocket> {
	const ws = new WebSocket(`${wsBase}/helper/${encodeURIComponent(device)}/ws`);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("WebSocket open timed out")),
			5_000,
		);
		ws.onopen = () => {
			clearTimeout(timer);
			resolve(ws);
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("WebSocket failed to open"));
		};
	});
}

const streamAbort = new AbortController();
const response = await fetch(`${helper}/stream.avcc`, {
	cache: "no-store",
	signal: streamAbort.signal,
});
if (!response.ok || !response.body)
	throw new Error(`AVCC request failed (${response.status})`);

const ws = inputMode === "native" ? await openControl() : null;
const reader = response.body.getReader();
const demuxer = new AvccDemuxer();
const counts: Record<AvccChunkType, number> = {
	description: 0,
	keyframe: 0,
	delta: 0,
	seed: 0,
	presentation: 0,
	"simulator-frame-timing": 0,
};
const mediaFrameTimes: number[] = [];
let bytes = 0;

const reading = (async () => {
	for (;;) {
		const next = await reader.read();
		if (next.done) return;
		bytes += next.value.length;
		for (const chunk of demuxer.push(next.value)) {
			counts[chunk.type]++;
			if (chunk.type === "keyframe" || chunk.type === "delta") {
				mediaFrameTimes.push(performance.now());
			}
		}
	}
})();

await wait(300);
const activeStart = performance.now();
const pid = emulatorPid();
const cpuSamples: number[] = [];
const stopCpuSampler = startCpuSampler(pid, cpuSamples);
let gestures = 0;
let direction = -1;
while (performance.now() - activeStart < durationMs) {
	const fromX = direction < 0 ? 0.72 : 0.28;
	const toX = direction < 0 ? 0.28 : 0.72;
	if (ws) await swipe(ws, fromX, toX);
	else await adbSwipe(fromX, toX);
	gestures += 1;
	direction *= -1;
	await wait(80);
}
const activeEnd = performance.now();
stopCpuSampler();
await wait(300);

const activeFrames = mediaFrameTimes.filter(
	(at) => at >= activeStart && at <= activeEnd,
).length;
const activeSeconds = (activeEnd - activeStart) / 1000;
const observedFps = Number((activeFrames / activeSeconds).toFixed(1));
const windowMs = Math.min(10_000, (activeEnd - activeStart) / 2);
const firstWindowFrames = mediaFrameTimes.filter(
	(at) => at >= activeStart && at < activeStart + windowMs,
).length;
const lastWindowFrames = mediaFrameTimes.filter(
	(at) => at > activeEnd - windowMs && at <= activeEnd,
).length;

console.log(
	JSON.stringify(
		{
			device,
			activeMs: Math.round(activeEnd - activeStart),
			activeFrames,
			observedFps,
			firstWindowFps: Number(
				(firstWindowFrames / (windowMs / 1000)).toFixed(1),
			),
			lastWindowFps: Number((lastWindowFrames / (windowMs / 1000)).toFixed(1)),
			gestures,
			inputFps,
			inputMode,
			emulatorCpuAverage: cpuSamples.length
				? Number(
						(
							cpuSamples.reduce((sum, value) => sum + value, 0) /
							cpuSamples.length
						).toFixed(1),
					)
				: null,
			emulatorCpuPeak: cpuSamples.length ? Math.max(...cpuSamples) : null,
			bytes,
			...counts,
		},
		null,
		2,
	),
);

ws?.close();
streamAbort.abort();
await Promise.race([reading.catch(() => {}), wait(250)]);

if (
	!counts.description ||
	!counts.keyframe ||
	gestures < 2 ||
	observedFps < 30
) {
	process.exitCode = 1;
}
