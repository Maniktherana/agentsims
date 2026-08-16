#!/usr/bin/env bun
import {
	AvccDemuxer,
	type AvccChunkType,
} from "../src/web/simulator/stream/avcc-codec";

const base = (process.env.AGENTSIMS_URL || "http://127.0.0.1:3210").replace(
	/\/$/,
	"",
);
const serial = process.argv[2] || "emulator-5554";
const device = `android:${serial}`;
const helper = `${base}/helper/${encodeURIComponent(device)}`;
const wsBase = base.replace(/^http/, "ws");

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function tagged(tag: number, payload: object): Uint8Array {
	const json = new TextEncoder().encode(JSON.stringify(payload));
	const message = new Uint8Array(1 + json.length);
	message[0] = tag;
	message.set(json, 1);
	return message;
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

async function sendSwipe(ws: WebSocket): Promise<void> {
	const x = 0.5;
	const startY = 0.76;
	const endY = 0.3;
	ws.send(tagged(0x03, { type: "begin", x, y: startY }));
	for (let index = 1; index <= 18; index++) {
		const y = startY + (endY - startY) * (index / 18);
		ws.send(tagged(0x03, { type: "move", x, y }));
		await wait(16);
	}
	ws.send(tagged(0x03, { type: "end", x, y: endY }));
}

const response = await fetch(`${helper}/stream.avcc`, { cache: "no-store" });
if (!response.ok || !response.body) {
	throw new Error(`AVCC request failed (${response.status})`);
}

const ws = await openControl();
const reader = response.body.getReader();
const demuxer = new AvccDemuxer();
const counts: Record<AvccChunkType, number> = {
	description: 0,
	keyframe: 0,
	delta: 0,
	seed: 0,
};
let bytes = 0;
let sentGesture = false;
const startedAt = performance.now();
const deadline = startedAt + 4_000;

while (performance.now() < deadline) {
	const remaining = Math.max(1, deadline - performance.now());
	const timeout = new Promise<null>((resolve) =>
		setTimeout(() => resolve(null), remaining),
	);
	const next = await Promise.race([reader.read(), timeout]);
	if (!next || next.done) break;
	bytes += next.value.length;
	for (const chunk of demuxer.push(next.value)) counts[chunk.type]++;
	if (!sentGesture && performance.now() - startedAt >= 500) {
		sentGesture = true;
		await sendSwipe(ws);
	}
}

await reader.cancel().catch(() => {});
ws.close();

const mediaFrames = counts.keyframe + counts.delta;
const elapsedMs = Math.round(performance.now() - startedAt);
console.log(
	JSON.stringify(
		{
			device,
			elapsedMs,
			bytes,
			...counts,
			mediaFrames,
			observedFps: Number((mediaFrames / (elapsedMs / 1000)).toFixed(1)),
			gestureSent: sentGesture,
		},
		null,
		2,
	),
);

if (
	!counts.description ||
	!counts.keyframe ||
	!counts.delta ||
	!sentGesture ||
	mediaFrames < 3
) {
	process.exitCode = 1;
}
