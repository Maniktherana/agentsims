import { afterEach, expect, test } from "bun:test";
import {
	clearDeviceFailure,
	logDeviceFailure,
} from "../../../../../server/http/routes/helpers";

const original = process.stderr.write.bind(process.stderr);
let lines: string[] = [];

function capture() {
	lines = [];
	process.stderr.write = ((chunk: string) => {
		lines.push(String(chunk).trim());
		return true;
	}) as typeof process.stderr.write;
}

afterEach(() => {
	process.stderr.write = original;
});

test("an unchanged failure logs once no matter how often it repeats", () => {
	capture();
	const error = new Error("device 'emulator-5556' not found");
	for (let i = 0; i < 50; i++)
		logDeviceFailure("android:emulator-5556", "stream.avcc", error);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain(
		"[android:emulator-5556] stream.avcc failed: device 'emulator-5556' not found",
	);
	clearDeviceFailure("android:emulator-5556", "stream.avcc");
});

test("a changed message logs again", () => {
	capture();
	logDeviceFailure("android:emulator-5556", "stream.avcc", new Error("gone"));
	logDeviceFailure("android:emulator-5556", "stream.avcc", new Error("gone"));
	logDeviceFailure("android:emulator-5556", "stream.avcc", new Error("offline"));
	expect(lines).toHaveLength(2);
	expect(lines[1]).toContain("stream.avcc failed: offline");
	clearDeviceFailure("android:emulator-5556", "stream.avcc");
});

test("endpoints and devices are latched independently", () => {
	capture();
	const error = new Error("boom");
	logDeviceFailure("android:emulator-5556", "stream.avcc", error);
	logDeviceFailure("android:emulator-5556", "screenshot.png", error);
	logDeviceFailure("android:emulator-5554", "stream.avcc", error);
	expect(lines).toHaveLength(3);
	clearDeviceFailure("android:emulator-5556", "stream.avcc");
	clearDeviceFailure("android:emulator-5556", "screenshot.png");
	clearDeviceFailure("android:emulator-5554", "stream.avcc");
});

test("recovery reports the true failure count", () => {
	capture();
	const error = new Error("still down");
	for (let i = 0; i < 12; i++)
		logDeviceFailure("android:emulator-5556", "config", error);
	clearDeviceFailure("android:emulator-5556", "config");
	expect(lines).toHaveLength(2);
	expect(lines[1]).toContain("config recovered after 12 failures");
});

test("a single failure still reports its recovery", () => {
	capture();
	logDeviceFailure("android:emulator-5556", "ax", new Error("blip"));
	clearDeviceFailure("android:emulator-5556", "ax");
	expect(lines).toHaveLength(2);
	expect(lines[1]).toContain("ax recovered after 1 failures");
});

test("a device that never failed logs nothing on success", () => {
	capture();
	clearDeviceFailure("android:emulator-5554", "stream.avcc");
	expect(lines).toHaveLength(0);
});

test("a DOMException reports its name and message, not its constants", () => {
	capture();
	logDeviceFailure(
		"server",
		"stream.avcc",
		new DOMException("The operation timed out.", "TimeoutError"),
	);
	expect(lines[0]).toContain(
		"stream.avcc failed: TimeoutError: The operation timed out.",
	);
	expect(lines[0]).not.toContain("INDEX_SIZE_ERR");
	clearDeviceFailure("server", "stream.avcc");
});
