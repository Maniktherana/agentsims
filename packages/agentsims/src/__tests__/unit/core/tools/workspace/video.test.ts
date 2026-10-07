import { describe, expect, test } from "bun:test";
import {
	AVCC_TAG_DELTA,
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	AVCC_TAG_PRESENTATION,
	AVCC_TAG_SEED,
	AVCC_TAG_SIMULATOR_FRAME_TIMING,
	AvccDemuxer,
	avccEnvelope,
} from "../../../../../core/stream/avcc-wire";
import {
	WORKSPACE_LIMITS,
	createBridgeByteBudget,
	type WorkspaceVideoDelivery,
} from "../../../../../core/tools/workspace/contracts";
import { createVideoHandoff } from "../../../../../core/tools/workspace/video";

const description = avccEnvelope(AVCC_TAG_DESCRIPTION, new Uint8Array([1, 100, 0, 40]));
const keyframe = (id = 1) => avccEnvelope(AVCC_TAG_KEYFRAME, new Uint8Array([id]));
const delta = (id = 2) => avccEnvelope(AVCC_TAG_DELTA, new Uint8Array([id]));
const timing = (id: bigint) => {
	const payload = new Uint8Array(16);
	const view = new DataView(payload.buffer);
	view.setBigUint64(0, id);
	view.setBigUint64(8, id + 1000n);
	return avccEnvelope(AVCC_TAG_SIMULATOR_FRAME_TIMING, payload);
};
const chunks = (delivery: WorkspaceVideoDelivery) => new AvccDemuxer().push(delivery.bytes);
const turn = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function fixture(codec: "avcc" | "jpeg" = "avcc", limit?: number) {
	const budget = createBridgeByteBudget(limit);
	let time = 0;
	let requests = 0;
	const video = createVideoHandoff({
		codec,
		budget,
		now: () => time,
		requestKeyframe: async () => { requests++; },
	});
	return { video, budget, requests: () => requests, setTime: (next: number) => { time = next; } };
}

describe("bounded AVCC workspace handoff", () => {
	test("fragmented envelopes retain exact presentation and native timing for each frame", async () => {
		const { video, budget } = fixture();
		const firstRead = video.read();
		const presentation = avccEnvelope(AVCC_TAG_PRESENTATION, new TextEncoder().encode('{"generation":7}'));
		for (const envelope of [description, presentation, timing(9007199254740993n), keyframe(10)]) {
			for (let index = 0; index < envelope.length; index++) video.sink.write(envelope.subarray(index, index + 1));
		}
		const first = await firstRead;
		expect(first).toMatchObject({ cursor: 1, epoch: 1, reset: true, mimeType: "application/x-agentsims-avcc" });
		expect(chunks(first)).toEqual([
			{ type: "description", payload: description.slice(5) },
			{ type: "presentation", payload: presentation.slice(5) },
			{ type: "simulator-frame-timing", payload: timing(9007199254740993n).slice(5) },
			{ type: "keyframe", payload: new Uint8Array([10]) },
		]);
		first.release();
		const secondRead = video.read({ cursor: 1, epoch: 1 });
		video.sink.write(timing(12n));
		video.sink.write(delta(20));
		const second = await secondRead;
		expect(second.reset).toBe(false);
		expect(chunks(second)).toEqual([
			{ type: "presentation", payload: presentation.slice(5) },
			{ type: "simulator-frame-timing", payload: timing(12n).slice(5) },
			{ type: "delta", payload: new Uint8Array([20]) },
		]);
		video.close();
		expect(second.bytes).toHaveLength(0);
		expect(budget.used).toBe(0);
	});

	test("copies source bytes and retains one delivery plus one pending access unit", async () => {
		const { video, budget } = fixture();
		video.sink.write(description);
		const firstRead = video.read();
		const source = keyframe(10);
		video.sink.write(source);
		source.fill(0);
		const first = await firstRead;
		expect(chunks(first).at(-1)?.payload).toEqual(new Uint8Array([10]));
		video.sink.write(delta(20));
		expect(budget.used).toBe(5 + description.length + first.bytes.length + delta().length);
		expect(video.sink.bufferedBytes).toBe(0);
		await expect(video.read({ cursor: 1, epoch: 1 })).rejects.toMatchObject({ code: "busy" });
		first.release();
		first.release();
		const second = await video.read({ cursor: 1, epoch: 1 });
		expect(chunks(second).at(-1)?.payload).toEqual(new Uint8Array([20]));
		expect(video.cursor).toBe(2);
		second.release();
		video.close();
		expect(budget.used).toBe(0);
	});

	test("lost pending references advance the epoch and discard the dependent chain", async () => {
		const { video, budget, requests } = fixture();
		video.sink.write(description);
		const firstRead = video.read();
		video.sink.write(keyframe());
		const first = await firstRead;
		first.release();
		video.sink.write(timing(2n));
		video.sink.write(delta(2));
		video.sink.write(timing(3n));
		video.sink.write(delta(3));
		expect(video.epoch).toBe(2);
		const read = video.read({ cursor: 1, epoch: 1 });
		let completed = false;
		void read.then(() => { completed = true; });
		for (let index = 4; index < 100; index++) video.sink.write(delta(index));
		await turn();
		expect(completed).toBe(false);
		expect(video.epoch).toBe(2);
		expect(requests()).toBe(1);
		expect(budget.used).toBe(5 + description.length);
		video.sink.write(timing(100n));
		video.sink.write(keyframe(100));
		const recovered = await read;
		expect(recovered).toMatchObject({ epoch: 2, cursor: 2, reset: true });
		expect(chunks(recovered).map((chunk) => chunk.type)).toEqual(["description", "simulator-frame-timing", "keyframe"]);
		expect(chunks(recovered)[1]?.payload).toEqual(timing(100n).slice(5));
		video.close();
		expect(budget.used).toBe(0);
	});

	test("ten seconds without reader credit keeps one slot and lets another device read", async () => {
		const budget = createBridgeByteBudget();
		let time = 0;
		let requests = 0;
		const slow = createVideoHandoff({ codec: "avcc", budget, now: () => time, requestKeyframe: async () => { requests++; } });
		const other = createVideoHandoff({ codec: "avcc", budget, requestKeyframe: async () => undefined });
		slow.sink.write(description);
		other.sink.write(description);
		slow.sink.write(keyframe());
		for (let tick = 0; tick <= 40; tick++) {
			time = tick * 250;
			slow.sink.write(delta(tick));
			await turn();
			expect(budget.used).toBe(2 * (5 + description.length));
		}
		expect(requests).toBe(11);
		expect(slow.epoch).toBe(2);
		const readable = other.read();
		other.sink.write(keyframe(90));
		const delivered = await readable;
		expect(chunks(delivered).at(-1)?.payload[0]).toBe(90);
		delivered.release();
		const recovery = slow.read();
		slow.sink.write(keyframe(91));
		expect((await recovery).reset).toBe(true);
		slow.close();
		other.close();
		expect(budget.used).toBe(0);
	});

	test("a new keyframe replaces an unread chain without retaining old timing", async () => {
		const { video } = fixture();
		video.sink.write(description);
		video.sink.write(timing(1n));
		video.sink.write(keyframe(1));
		video.sink.write(timing(2n));
		video.sink.write(keyframe(2));
		const latest = await video.read();
		expect(latest).toMatchObject({ epoch: 2, reset: true });
		expect(chunks(latest)[1]?.payload).toEqual(timing(2n).slice(5));
		expect(chunks(latest).at(-1)?.payload).toEqual(new Uint8Array([2]));
		latest.release();
		video.close();
	});

	test("older epochs obtain a reset keyframe and never a dependent delta", async () => {
		const { video } = fixture();
		video.sink.write(description);
		const firstRead = video.read();
		video.sink.write(keyframe());
		const first = await firstRead;
		first.release();
		video.sink.write(delta());
		video.sink.write(delta(3));
		const secondRead = video.read({ cursor: 1, epoch: 1 });
		video.sink.write(keyframe(4));
		const second = await secondRead;
		second.release();
		video.sink.write(delta(5));
		const thirdRead = video.read({ cursor: 2, epoch: 1 });
		expect(video.epoch).toBe(3);
		video.sink.write(keyframe(6));
		const third = await thirdRead;
		expect(third).toMatchObject({ cursor: 3, epoch: 3, reset: true });
		expect(chunks(third).at(-1)?.type).toBe("keyframe");
		video.close();
	});

	test("stale and duplicate cursors, future epochs and overlapping reads reject without consuming a slot", async () => {
		const { video } = fixture();
		const waiting = video.read();
		await expect(video.read()).rejects.toMatchObject({ code: "busy" });
		video.sink.write(description);
		video.sink.write(keyframe());
		const first = await waiting;
		first.release();
		for (const request of [{ cursor: 0, epoch: 1 }, { cursor: 2, epoch: 1 }, { cursor: 1, epoch: 2 }, { cursor: 1, epoch: 0 }, {}, { cursor: 1 }, { cursor: NaN, epoch: 1 }])
			await expect(video.read(request)).rejects.toMatchObject({ code: "stale" });
		video.sink.write(delta(9));
		const second = await video.read({ cursor: 1, epoch: 1 });
		expect(chunks(second).at(-1)?.payload[0]).toBe(9);
		second.release();
		await expect(video.read({ cursor: 1, epoch: 1 })).rejects.toMatchObject({ code: "stale" });
		video.close();
	});

	test("recovery requests have an interval and one asynchronous request in flight", async () => {
		let time = 0;
		let count = 0;
		let finish: (() => void) | undefined;
		const video = createVideoHandoff({ codec: "avcc", budget: createBridgeByteBudget(), now: () => time, requestKeyframe: () => {
			count++;
			return new Promise<void>((resolve) => { finish = resolve; });
		} });
		video.sink.write(delta());
		await turn();
		time = 10000;
		video.sink.write(delta());
		expect(count).toBe(1);
		finish!();
		await turn();
		video.sink.write(delta());
		await turn();
		expect(count).toBe(2);
		finish!();
		await turn();
		time = 10999;
		video.sink.write(delta());
		expect(count).toBe(2);
		time = 11000;
		video.sink.write(delta());
		await turn();
		expect(count).toBe(3);
		finish!();
		video.close();
	});

	test("changed description or presentation invalidates the previous dependency epoch", async () => {
		const { video } = fixture();
		video.sink.write(description);
		const originalPresentation = avccEnvelope(AVCC_TAG_PRESENTATION, new Uint8Array([1]));
		video.sink.write(originalPresentation);
		video.sink.write(keyframe());
		const first = await video.read();
		first.release();
		video.sink.write(description);
		video.sink.write(originalPresentation);
		expect(video.epoch).toBe(1);
		video.sink.write(avccEnvelope(AVCC_TAG_PRESENTATION, new Uint8Array([2])));
		expect(video.epoch).toBe(2);
		const nextRead = video.read({ cursor: 1, epoch: 1 });
		video.sink.write(delta());
		video.sink.write(avccEnvelope(AVCC_TAG_DESCRIPTION, new Uint8Array([1, 77, 0, 40])));
		video.sink.write(keyframe());
		const next = await nextRead;
		expect(chunks(next)[0]?.payload).toEqual(new Uint8Array([1, 77, 0, 40]));
		expect(chunks(next)[1]?.payload).toEqual(new Uint8Array([2]));
		video.close();
	});

	test("an optional AVCC seed is skipped without an allocation or a new capture", async () => {
		const { video, budget } = fixture();
		const seed = avccEnvelope(AVCC_TAG_SEED, new Uint8Array(1024));
		video.sink.write(seed.subarray(0, 10));
		expect(budget.used).toBe(5);
		video.sink.write(seed.subarray(10));
		video.sink.write(description);
		video.sink.write(keyframe());
		const read = await video.read();
		expect(chunks(read).map((chunk) => chunk.type)).toEqual(["description", "keyframe"]);
		video.close();
	});
});

describe("video bounds and scoped disposal", () => {
	test("checks each envelope bound before allocating its declared body", async () => {
		for (const [tag, size] of [[AVCC_TAG_KEYFRAME, WORKSPACE_LIMITS.accessUnitBytes + 1], [AVCC_TAG_DELTA, WORKSPACE_LIMITS.accessUnitBytes + 1], [AVCC_TAG_DESCRIPTION, WORKSPACE_LIMITS.descriptionBytes + 1], [AVCC_TAG_PRESENTATION, WORKSPACE_LIMITS.metadataBytes + 1]]) {
			const { video, budget } = fixture();
			const read = video.read().catch((error) => error);
			const header = new Uint8Array(5);
			new DataView(header.buffer).setUint32(0, size! + 1);
			header[4] = tag!;
			video.sink.write(header);
			expect(await read).toMatchObject({ code: "bounds" });
			expect(video.sink.closed).toBe(true);
			expect(budget.used).toBe(0);
		}
	});

	test("accepts the maximum access unit and charges a separately retained adapter copy", async () => {
		const { video, budget } = fixture();
		video.sink.write(description);
		const pending = video.read();
		video.sink.write(avccEnvelope(AVCC_TAG_KEYFRAME, new Uint8Array(WORKSPACE_LIMITS.accessUnitBytes)));
		const delivered = await pending;
		expect(delivered.bytes.length).toBe(description.length + WORKSPACE_LIMITS.accessUnitBytes + 5);
		const releaseCopy = budget.reserve(4 * Math.ceil(delivered.bytes.length / 3));
		expect(budget.used).toBe(5 + description.length + delivered.bytes.length + 4 * Math.ceil(delivered.bytes.length / 3));
		delivered.release();
		video.close();
		expect(budget.used).toBe(4 * Math.ceil((description.length + WORKSPACE_LIMITS.accessUnitBytes + 5) / 3));
		releaseCopy();
		releaseCopy();
		expect(budget.used).toBe(0);
	});

	test("rejects malformed lengths, unknown tags and nonnative timing sizes", async () => {
		for (const wire of [new Uint8Array([0, 0, 0, 0, 2]), new Uint8Array([0, 0, 0, 1, 2]), avccEnvelope(99, new Uint8Array([1])), avccEnvelope(AVCC_TAG_SIMULATOR_FRAME_TIMING, new Uint8Array(15))]) {
			const { video, budget } = fixture();
			video.sink.write(wire);
			await expect(video.read()).rejects.toMatchObject({ code: "invalid" });
			expect(budget.used).toBe(0);
		}
	});

	test("the combined presentation and timing cache stays within the metadata bound", async () => {
		const { video, budget } = fixture();
		video.sink.write(avccEnvelope(AVCC_TAG_PRESENTATION, new Uint8Array(WORKSPACE_LIMITS.metadataBytes - 15)));
		video.sink.write(timing(1n).subarray(0, 5));
		await expect(video.read()).rejects.toMatchObject({ code: "bounds" });
		expect(budget.used).toBe(0);
	});

	test("partial body reservations include the full backing allocation and release on close", async () => {
		const { video, budget } = fixture();
		const wire = avccEnvelope(AVCC_TAG_KEYFRAME, new Uint8Array(WORKSPACE_LIMITS.accessUnitBytes));
		video.sink.write(wire.subarray(0, 7));
		expect(budget.used).toBe(5 + wire.length);
		expect(video.sink.bufferedBytes).toBe(0);
		video.close();
		video.close();
		expect(budget.used).toBe(0);
		await expect(video.read()).rejects.toMatchObject({ code: "closed" });
	});

	test("a shared budget rejects one handoff without releasing another handoff's buffers", async () => {
		const budget = createBridgeByteBudget(32);
		const options = { codec: "avcc" as const, budget, requestKeyframe: async () => undefined };
		const first = createVideoHandoff(options);
		const second = createVideoHandoff(options);
		first.sink.write(description);
		second.sink.write(description);
		expect(budget.used).toBe(28);
		first.sink.write(keyframe());
		await expect(first.read()).rejects.toMatchObject({ code: "bounds" });
		expect(first.sink.closed).toBe(true);
		expect(second.sink.closed).toBe(false);
		expect(budget.used).toBe(14);
		second.close();
		expect(budget.used).toBe(0);
	});

	test("cancellation discards a partial frame and resumes at the next envelope boundary", async () => {
		const { video, budget } = fixture();
		video.sink.write(description);
		video.sink.write(keyframe());
		const first = await video.read();
		first.release();
		const controller = new AbortController();
		const pending = video.read({ cursor: 1, epoch: 1, signal: controller.signal }).catch((error) => error);
		const interrupted = avccEnvelope(AVCC_TAG_DELTA, new Uint8Array(100));
		video.sink.write(interrupted.subarray(0, 10));
		controller.abort(new Error("read cancelled"));
		expect((await pending).message).toBe("read cancelled");
		expect(budget.used).toBe(5 + description.length);
		expect(video.epoch).toBe(2);
		video.sink.write(interrupted.subarray(10));
		video.sink.write(timing(3n));
		video.sink.write(delta(3));
		const next = video.read({ cursor: 1, epoch: 1 });
		video.sink.write(keyframe(4));
		const recovered = await next;
		expect(chunks(recovered).map((chunk) => chunk.type)).toEqual(["description", "keyframe"]);
		video.close();
		expect(budget.used).toBe(0);
	});

	test("cancellation during a split header skips that envelope without losing alignment", async () => {
		const { video } = fixture();
		const controller = new AbortController();
		const pending = video.read({ signal: controller.signal }).catch((error) => error);
		const interrupted = keyframe(1);
		video.sink.write(interrupted.subarray(0, 2));
		controller.abort();
		expect((await pending).name).toBe("AbortError");
		video.sink.write(interrupted.subarray(2));
		video.sink.write(description);
		const next = video.read();
		video.sink.write(keyframe(2));
		const delivered = await next;
		expect(chunks(delivered).at(-1)?.payload[0]).toBe(2);
		video.close();
	});

	test("aborting a delivered read releases its bytes and any pending reference exactly once", async () => {
		const { video, budget } = fixture();
		video.sink.write(description);
		const controller = new AbortController();
		const pending = video.read({ signal: controller.signal });
		video.sink.write(keyframe());
		const delivered = await pending;
		video.sink.write(delta());
		controller.abort();
		delivered.release();
		expect(delivered.bytes).toHaveLength(0);
		expect(budget.used).toBe(5 + description.length);
		expect(video.epoch).toBe(2);
		video.close();
		expect(budget.used).toBe(0);
	});

	test("close rejects a waiting read and callbacks cannot throw through the native source", async () => {
		const { video, budget } = fixture();
		let closes = 0;
		let drains = 0;
		video.sink.onClose(() => { closes++; throw new Error("subscriber failure"); });
		video.sink.onDrain(() => { drains++; throw new Error("subscriber failure"); });
		const pending = video.read().catch((error) => error);
		video.sink.write(description);
		video.sink.write(delta());
		await turn();
		expect(drains).toBe(1);
		video.sink.close();
		video.close();
		expect(await pending).toMatchObject({ code: "closed" });
		expect(closes).toBe(1);
		expect(budget.used).toBe(0);
		video.sink.onClose(() => { closes++; });
		expect(closes).toBe(2);
		video.sink.write(keyframe());
		expect(budget.used).toBe(0);
	});
});

describe("existing JPEG subscription handoff", () => {
	test("retains the latest pending JPEG independently of an outstanding delivery", async () => {
		const { video, budget, requests } = fixture("jpeg");
		video.acceptJpeg(new Uint8Array([1, 2, 3]));
		const first = await video.read();
		video.acceptJpeg(new Uint8Array([4, 5]));
		const latest = new Uint8Array([6, 7, 8, 9]);
		video.acceptJpeg(latest);
		latest.fill(0);
		expect(budget.used).toBe(7);
		expect(video.epoch).toBe(1);
		first.release();
		const second = await video.read({ cursor: 1, epoch: 1 });
		expect(second).toMatchObject({ reset: false, mimeType: "image/jpeg" });
		expect(second.bytes).toEqual(new Uint8Array([6, 7, 8, 9]));
		expect(requests()).toBe(0);
		second.release();
		video.close();
		expect(budget.used).toBe(0);
	});

	test("rejects oversized JPEGs and wrong subscription kinds without leaking bytes", async () => {
		const oversized = fixture("jpeg");
		oversized.video.acceptJpeg(new Uint8Array(WORKSPACE_LIMITS.accessUnitBytes + 1));
		await expect(oversized.video.read()).rejects.toMatchObject({ code: "bounds" });
		expect(oversized.budget.used).toBe(0);
		const jpeg = fixture("jpeg");
		jpeg.video.sink.write(keyframe());
		await expect(jpeg.video.read()).rejects.toMatchObject({ code: "invalid" });
		const avcc = fixture();
		avcc.video.acceptJpeg(new Uint8Array([1]));
		await expect(avcc.video.read()).rejects.toMatchObject({ code: "invalid" });
		expect(avcc.budget.used).toBe(0);
	});
});
