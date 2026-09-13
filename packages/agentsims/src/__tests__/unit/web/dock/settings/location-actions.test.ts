import { expect, test } from "bun:test";
import { setDeviceLocation } from "../../../../../web/dock/settings/location-actions";

test("Android route playback sends validated command fields and never uses the host shell adapter", async () => {
	const calls: unknown[] = [];
	await setDeviceLocation(
		"android:emulator-5554",
		{ lat: 12.9715987, lng: 77.5945627 },
		{
			exec: async () => {
				throw new Error("Android must not use host shell execution");
			},
			android: async (device, action) => {
				calls.push({ device, action });
			},
		},
	);
	expect(calls).toEqual([
		{
			device: "android:emulator-5554",
			action: { type: "location", latitude: 12.9715987, longitude: 77.5945627 },
		},
	]);
});

test("location command failures remain visible to route playback", async () => {
	await expect(
		setDeviceLocation(
			"android:physical",
			{ lat: 0, lng: 0 },
			{
				exec: async () => {
					throw new Error("Wrong adapter");
				},
				android: async () => {
					throw new Error("Location requires an emulator");
				},
			},
		),
	).rejects.toThrow("Location requires an emulator");
});

test("manual Android location includes altitude in the same command path", async () => {
	const actions: unknown[] = [];
	await setDeviceLocation(
		"android:emulator-5554",
		{ lat: 10, lng: 20, altitude: 250 },
		{
			exec: async () => {
				throw new Error("Unexpected shell command");
			},
			android: async (_device, action) => {
				actions.push(action);
			},
		},
	);
	expect(actions).toEqual([
		{ type: "location", latitude: 10, longitude: 20, altitude: 250 },
	]);
});
