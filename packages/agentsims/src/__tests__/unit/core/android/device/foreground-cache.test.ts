import { expect, test } from "bun:test";
import {
	clearAndroidDeviceCaches,
	getAndroidForegroundApp,
} from "../../../../../core/android/device/device";

const activity =
	"mResumedActivity: ActivityRecord{123 u0 com.cache.example/.MainActivity t1}";
const read = (rn: boolean) => async (args: string[]) =>
	args.includes("activities")
		? activity
		: args.includes("pidof")
			? "42"
			: args.includes("logcat") && rn
				? "I/ReactNativeJS: ready"
				: "";

test("React Native positive cache belongs to a device, not just a package", async () => {
	const one = "cache-test-one";
	const two = "cache-test-two";
	clearAndroidDeviceCaches(one);
	clearAndroidDeviceCaches(two);
	expect((await getAndroidForegroundApp(one, read(true)))?.isReactNative).toBe(
		true,
	);
	expect((await getAndroidForegroundApp(two, read(false)))?.isReactNative).toBe(
		false,
	);
	clearAndroidDeviceCaches(one);
	clearAndroidDeviceCaches(two);
});

test("a foreground read started before reset cannot populate the new cache generation", async () => {
	const serial = "cache-reset-race";
	clearAndroidDeviceCaches(serial);
	const pending = Promise.withResolvers<string>();
	const old = getAndroidForegroundApp(serial, async (args) =>
		args.includes("activities") ? pending.promise : read(true)(args),
	);
	clearAndroidDeviceCaches(serial);
	pending.resolve(activity);
	expect(await old).toBeNull();
	expect(
		(await getAndroidForegroundApp(serial, read(false)))?.isReactNative,
	).toBe(false);
	clearAndroidDeviceCaches(serial);
});

test("resetting one serial does not clear a TCP device that starts with the same text", async () => {
	const one = "cache-host";
	const two = "cache-host:5555";
	clearAndroidDeviceCaches(one);
	clearAndroidDeviceCaches(two);
	await getAndroidForegroundApp(one, read(true));
	await getAndroidForegroundApp(two, read(true));
	clearAndroidDeviceCaches(one);
	expect((await getAndroidForegroundApp(two, read(false)))?.isReactNative).toBe(
		true,
	);
	clearAndroidDeviceCaches(one);
	clearAndroidDeviceCaches(two);
});
