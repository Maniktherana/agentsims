import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	IosSlimming,
	SLIM_LABELS,
	SLIM_REQUIRED_LABELS,
	encodeDisabledStore,
	parseDisabledStore,
} from "../../../../core/ios/slim";

const UDID = "8FE6B424-95B9-4AF7-B579-00B8E21FF5AE";
const IOS_27 = "com.apple.CoreSimulator.SimRuntime.iOS-27-2";
const shutdown = { state: "Shutdown", runtime: IOS_27 };
const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup(
	execute: ConstructorParameters<typeof IosSlimming>[0] = async () => ({
		error: new Error("no device"),
		stdout: "",
		stderr: "",
	}),
) {
	const root = await mkdtemp(join(tmpdir(), "agentsims-slim-"));
	roots.push(root);
	const storeRoot = join(root, "store");
	const store = join(storeRoot, `com.apple.CoreSimulator.SimDevice.${UDID}`, "disabled.plist");
	const slimming = new IosSlimming(execute, {
		storeRoot,
		recordRoot: () => join(root, "records"),
	});
	return {
		slimming,
		store,
		read: async () => parseDisabledStore(await readFile(store, "utf8")),
		write: async (entries: Map<string, boolean>) => {
			await mkdir(join(store, ".."), { recursive: true });
			await writeFile(store, encodeDisabledStore(entries));
		},
	};
}

test("slim never disables services that tools and share sheets need", () => {
	for (const label of SLIM_REQUIRED_LABELS) expect(SLIM_LABELS).not.toContain(label);
});

test("a slim boot keeps other entries and a revert restores only its own", async () => {
	const { slimming, read, write } = await setup();
	const [userDisabled, explicitlyEnabled] = SLIM_LABELS;
	await write(
		new Map([
			["com.example.other", false],
			[userDisabled!, true],
			[explicitlyEnabled!, false],
		]),
	);

	expect(await slimming.prepare(UDID, shutdown)).toBe(true);
	const slim = await read();
	for (const label of SLIM_LABELS) expect(slim.get(label)).toBe(true);
	expect(slim.get("com.example.other")).toBe(false);

	const status = await slimming.setEnabled(UDID, shutdown, false);
	expect(status).toMatchObject({ enabled: false, managed: 0 });
	const stock = await read();
	expect(stock.get(userDisabled!)).toBe(true);
	expect(stock.get(explicitlyEnabled!)).toBe(false);
	expect(stock.get("com.example.other")).toBe(false);
	expect(stock.has(SLIM_LABELS[2]!)).toBe(false);
});

test("an opted-out device stays stock on later boots", async () => {
	const { slimming, store } = await setup();
	expect(await slimming.prepare(UDID, shutdown, false)).toBe(false);
	expect(await slimming.prepare(UDID, shutdown)).toBe(false);
	await expect(readFile(store, "utf8")).rejects.toThrow();
	expect(await slimming.prepare(UDID, shutdown, true)).toBe(true);
});

test("runtimes before iOS 18.5 and booted devices are not changed", async () => {
	const { slimming, store } = await setup();
	expect(
		await slimming.prepare(UDID, {
			state: "Shutdown",
			runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-4",
		}),
	).toBe(false);
	expect(await slimming.prepare(UDID, { state: "Booted", runtime: IOS_27 })).toBe(false);
	await expect(readFile(store, "utf8")).rejects.toThrow();
});

test("overrides that did not hold are disabled and stopped in the running device", async () => {
	const calls: string[] = [];
	const { slimming } = await setup(async (_command, args) => {
		calls.push(args.slice(4).join(" "));
		return { error: null, stdout: "disabled services = {\n}\n", stderr: "" };
	});
	await slimming.prepare(UDID, shutdown);
	await slimming.verify(UDID);

	expect(calls[0]).toBe("print-disabled system");
	for (const label of SLIM_LABELS) {
		expect(calls).toContain(`disable system/${label}`);
		expect(calls).toContain(`bootout system/${label}`);
	}
});

test("overrides that held start no launchctl work", async () => {
	const calls: string[] = [];
	const { slimming } = await setup(async (_command, args) => {
		calls.push(args.slice(4).join(" "));
		return {
			error: null,
			stdout: SLIM_LABELS.map((label) => `\t"${label}" => disabled`).join("\n"),
			stderr: "",
		};
	});
	await slimming.prepare(UDID, shutdown);
	await slimming.verify(UDID);
	expect(calls).toEqual(["print-disabled system"]);
});
