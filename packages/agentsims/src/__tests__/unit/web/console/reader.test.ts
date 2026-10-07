import { expect, test } from "bun:test";
import type { LogTarget } from "../../../../core/tools/logs/contracts";
import { ConsoleReader, ConsoleReaders } from "../../../../web/console/reader";
import { ConsoleStore } from "../../../../web/console/state";
import retainedHistory from "../../../fixtures/console/android-retained-history.json";
import emptyReconnect from "../../../fixtures/console/android-empty-reconnect.json";

const target: LogTarget = { device: "ios-1", app: { mode: "foreground" } };
const epoch = "ios-1~00000000-0000-0000-0000-000000000001";
const snapshot = { records: [], statuses: [], cursor: { epoch, sequence: 0 }, dropped: 0, hasMore: false };
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}

test("scope reader reentry does not restore cleared actual history after an empty reconnect", async () => {
	const device = retainedHistory.records[0]!.device;
	const selected: LogTarget = { device, app: { mode: "foreground" } };
	const store = new ConsoleStore();
	store.retainDevices([device]);
	const reconnected = deferred();
	const reopened = deferred();
	const snapshotCursors: (string | null)[] = [];
	let streams = 0;
	let cancellations = 0;
	const fetcher = (async (input: string | URL | Request) => {
		const url = new URL(String(input), "http://localhost");
		if (url.pathname.endsWith("snapshot")) {
			snapshotCursors.push(url.searchParams.get("cursor"));
			return new Response(JSON.stringify(streams ? { ...retainedHistory, cursor: {
				...retainedHistory.cursor, epoch: `${encodeURIComponent(device)}~00000000-0000-0000-0000-000000000006`,
			} } : retainedHistory));
		}
		const first = ++streams === 1;
		if (!first) reopened.resolve();
		return new Response(new ReadableStream({
			start(controller) { if (first) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(emptyReconnect)}\n\n`)); },
			cancel() { cancellations++; },
		}), { headers: { "Content-Type": "text/event-stream" } });
	}) as typeof fetch;
	const readers = new ConsoleReaders(store, () => {
		store.synchronizeAggregate();
		if (store.session(device).cursor?.epoch === emptyReconnect.cursor.epoch) reconnected.resolve();
	}, fetcher);
	readers.update({ targets: [selected], active: true, basePath: "" });
	await reconnected.promise;
	expect(store.aggregate().records.map(record => record.id)).toEqual(retainedHistory.records.map(record => record.id));
	store.options(null, { paused: true });
	store.clear(null);
	readers.update({ targets: [selected], active: false, basePath: "" });
	readers.update({ targets: [selected], active: true, basePath: "" });
	await reopened.promise;
	expect(snapshotCursors[1]).toBe(`${emptyReconnect.cursor.epoch}:${emptyReconnect.cursor.sequence}`);
	expect(store.session(device).records).toHaveLength(0);
	expect(store.aggregate().records).toHaveLength(0);
	expect(store.aggregate().frozen).toHaveLength(0);
	expect(store.aggregate().options.paused).toBe(true);
	await readers.dispose();
	expect(cancellations).toBe(2);
});

test("inactive readers cancel their UI connection while retaining device filters and cursor", async () => {
	const store = new ConsoleStore();
	const opened = deferred();
	let cancellations = 0;
	let requests = 0;
	const fetcher = (async (input: string | URL | Request) => {
		requests++;
		if (String(input).includes("snapshot")) return new Response(JSON.stringify(snapshot));
		opened.resolve();
		return new Response(new ReadableStream({ cancel() { cancellations++; } }), { headers: { "Content-Type": "text/event-stream" } });
	}) as typeof fetch;
	const reader = new ConsoleReader(store, () => {}, fetcher);
	store.filters(target.device, { query: "keep", level: "error" });
	reader.update({ target, active: true, basePath: "" });
	await opened.promise;
	reader.update({ target, active: false, basePath: "" });
	await reader.dispose();
	expect(cancellations).toBe(1);
	expect(store.session(target.device).connection).toBe("closed");
	expect(store.session(target.device).filters.query).toBe("keep");
	expect(store.session(target.device).cursor?.sequence).toBe(0);
	expect(requests).toBe(2);
});

test("target replacement waits for the old reader to release and does not reconnect for identical targets", async () => {
	const store = new ConsoleStore();
	const firstOpened = deferred();
	const secondOpened = deferred();
	const firstReleased = deferred();
	const calls: string[] = [];
	let streams = 0;
	const fetcher = (async (input: string | URL | Request) => {
		const url = new URL(String(input), "http://localhost");
		if (url.pathname.endsWith("snapshot")) { calls.push(url.searchParams.get("targetApp") ?? "foreground"); return new Response(JSON.stringify(snapshot)); }
		streams++;
		const first = streams === 1;
		(first ? firstOpened : secondOpened).resolve();
		return new Response(new ReadableStream({ cancel() { if (first) { calls.push("release foreground"); return firstReleased.promise; } } }), { headers: { "Content-Type": "text/event-stream" } });
	}) as typeof fetch;
	const reader = new ConsoleReader(store, () => {}, fetcher);
	reader.update({ target, active: true, basePath: "" });
	await firstOpened.promise;
	reader.update({ target: { ...target }, active: true, basePath: "" });
	expect(streams).toBe(1);
	reader.update({ target: { ...target, app: { mode: "fixed", id: "com.example.app" } }, active: true, basePath: "" });
	await Promise.resolve();
	expect(calls).not.toContain("com.example.app");
	firstReleased.resolve();
	await secondOpened.promise;
	expect(calls.indexOf("release foreground")).toBeLessThan(calls.indexOf("com.example.app"));
	await reader.dispose();
});

test("rapid target changes discard superseded requests before they acquire a reader", async () => {
	const store = new ConsoleStore();
	const opened = deferred();
	const apps: (string | null)[] = [];
	const fetcher = (async (input: string | URL | Request) => {
		const url = new URL(String(input), "http://localhost");
		apps.push(url.searchParams.get("targetApp"));
		if (url.pathname.endsWith("snapshot")) return new Response(JSON.stringify(snapshot));
		opened.resolve();
		return new Response(new ReadableStream(), { headers: { "Content-Type": "text/event-stream" } });
	}) as typeof fetch;
	const reader = new ConsoleReader(store, () => {}, fetcher);
	reader.update({ target, active: true, basePath: "" });
	reader.update({ target: { ...target, app: { mode: "fixed", id: "first" } }, active: true, basePath: "" });
	reader.update({ target: { ...target, app: { mode: "fixed", id: "last" } }, active: true, basePath: "" });
	await opened.promise;
	await reader.dispose();
	expect(apps).toEqual(["last", "last"]);
});

test("all scope opens one reader per real visible device and inactivity cancels every stream", async () => {
	const store = new ConsoleStore();
	const devices = ["ios-1", "android-1"];
	const targets: LogTarget[] = devices.map(device => ({ device, app: { mode: "foreground" } }));
	const opened = deferred();
	const streams: string[] = [];
	const canceled: string[] = [];
	const calls: string[] = [];
	store.retainDevices(devices);
	const fetcher = (async (input: string | URL | Request) => {
		const url = new URL(String(input), "http://localhost");
		const device = url.searchParams.get("device")!;
		calls.push(device);
		if (url.pathname.endsWith("snapshot")) return new Response(JSON.stringify({ ...snapshot, cursor: {
			epoch: `${device}~00000000-0000-0000-0000-000000000001`, sequence: 1,
		} }));
		streams.push(device);
		if (streams.length === devices.length) opened.resolve();
		return new Response(new ReadableStream({ cancel() { canceled.push(device); } }), { headers: { "Content-Type": "text/event-stream" } });
	}) as typeof fetch;
	const readers = new ConsoleReaders(store, () => {}, fetcher);
	readers.update({ targets, active: true, basePath: "" });
	await opened.promise;
	store.options(null, { paused: true });
	readers.update({ targets, active: true, basePath: "" });
	expect(streams.sort()).toEqual(devices.slice().sort());
	expect(calls.every(device => devices.includes(device))).toBe(true);
	expect(canceled).toHaveLength(0);
	readers.update({ targets, active: false, basePath: "" });
	await readers.dispose();
	expect(canceled.sort()).toEqual(devices.slice().sort());
	for (const device of devices) {
		expect(store.session(device).connection).toBe("closed");
		expect(store.session(device).cursor?.sequence).toBe(1);
	}
});

test("switching from all scope to one device closes only the other reader", async () => {
	const store = new ConsoleStore();
	const targets: LogTarget[] = [target, { device: "android-1", app: { mode: "foreground" } }];
	const opened = deferred();
	const otherClosed = deferred();
	const streams: string[] = [];
	const fetcher = (async (input: string | URL | Request) => {
		const url = new URL(String(input), "http://localhost");
		const device = url.searchParams.get("device")!;
		if (url.pathname.endsWith("snapshot")) return new Response(JSON.stringify({ ...snapshot, cursor: {
			epoch: `${device}~00000000-0000-0000-0000-000000000001`, sequence: 0,
		} }));
		streams.push(device);
		if (streams.length === 2) opened.resolve();
		return new Response(new ReadableStream({ cancel() { if (device === "android-1") otherClosed.resolve(); } }), { headers: { "Content-Type": "text/event-stream" } });
	}) as typeof fetch;
	const readers = new ConsoleReaders(store, () => {}, fetcher);
	readers.update({ targets, active: true, basePath: "" });
	await opened.promise;
	readers.update({ targets: [target], active: true, basePath: "" });
	await otherClosed.promise;
	expect(streams.filter(device => device === "ios-1")).toHaveLength(1);
	expect(store.session("android-1").connection).toBe("closed");
	await readers.dispose();
});

test("one device's permanent error does not stop another device's live reader", async () => {
	const store = new ConsoleStore();
	const ready = deferred();
	const targets: LogTarget[] = [target, { device: "android-1", app: { mode: "foreground" } }];
	store.retainDevices(targets.map(target => target.device));
	const fetcher = (async (input: string | URL | Request) => {
		const url = new URL(String(input), "http://localhost");
		if (url.searchParams.get("device") === "ios-1") return new Response('{"error":"Device disconnected"}', { status: 404 });
		if (url.pathname.endsWith("snapshot")) return new Response(JSON.stringify({ ...snapshot, cursor: {
			epoch: "android-1~00000000-0000-0000-0000-000000000001", sequence: 0,
		} }));
		return new Response(new ReadableStream(), { headers: { "Content-Type": "text/event-stream" } });
	}) as typeof fetch;
	const readers = new ConsoleReaders(store, () => {
		if (store.session("ios-1").connection === "error" && store.session("android-1").connection === "live") ready.resolve();
	}, fetcher);
	readers.update({ targets, active: true, basePath: "" });
	await ready.promise;
	store.synchronizeAggregate();
	expect(store.aggregate().error).toBe("ios-1: Device disconnected");
	expect(store.session("android-1").connection).toBe("live");
	await readers.dispose();
});
