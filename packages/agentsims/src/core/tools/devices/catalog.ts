import { listIosDevices, type IosSimulatorDevice } from "../../ios/devices";
import { readFile } from "node:fs/promises";
import { parseLinuxMemory } from "../../host";
import {
	androidAvdStateId,
	androidStateId,
} from "../../android/device/identifiers";
import { listAndroidDevices } from "../../android/device/discovery";
import { listAndroidAvds } from "../../android/device/emulator";
import {
	resolveDeviceFrame,
	resolveDevicePlaceholderAsset,
	type DeviceFrameDescriptor,
	type DevicePlaceholderAssetDescriptor,
} from "../../ios/device-assets";
import type { DeviceLifecycleServiceValue } from "./lifecycle";
import type { DeviceState } from "./state";
import { hostCommandText } from "../../host";

type SimctlDevice = IosSimulatorDevice & { runtime: string };

export type GridDevice = {
	/** Runtime command target. Android emulators use their current ADB serial. */
	device: string;
	/** Stable catalog identity. It stays `android-avd:*` across emulator boots. */
	catalogDevice: string;
	name: string;
	runtime: string;
	state: string;
	chrome: DeviceFrameDescriptor | null;
	placeholderAsset: DevicePlaceholderAssetDescriptor | null;
	helper: Pick<DeviceState, "port" | "url" | "streamUrl" | "wsUrl"> | null;
};

export type GridPage = {
	devices: GridDevice[];
	total: number;
	offset: number;
	limit: number;
};

export type MemoryReport = {
	totalBytes: number | null;
	availableBytes: number | null;
	runningSimulators: number;
	perSimAvgBytes: number;
	perSimSource: "measured" | "estimated";
	estimatedAdditional: number | null;
};

type PendingGridDevice = Omit<GridDevice, "chrome" | "placeholderAsset"> & {
	ios?: SimctlDevice;
	chrome: null;
	placeholderAsset: null;
};

const DEFAULT_PER_SIM_BYTES = 1.5 * 1024 * 1024 * 1024;

export function visibleAndroidCatalogDevices<T extends { serial: string; state: string }>(
	devices: readonly T[],
): T[] {
	return devices.filter(
		(device) =>
			!device.serial.startsWith("emulator-") || device.state === "device",
	);
}

export function parseGridPaging(rawUrl: string): {
	limit: number | null;
	offset: number;
} {
	const query = rawUrl.indexOf("?");
	if (query === -1) return { limit: null, offset: 0 };
	const params = new URLSearchParams(rawUrl.slice(query + 1));
	const rawLimit = params.get("limit");
	const rawOffset = params.get("offset");
	return {
		limit:
			rawLimit == null || !/^\d+$/.test(rawLimit)
				? null
				: Math.min(Math.max(Number(rawLimit), 1), 1_000),
		offset:
			rawOffset == null || !/^\d+$/.test(rawOffset)
				? 0
				: Math.max(Number(rawOffset), 0),
	};
}

export class DeviceCatalog {
	private preferredSnapshot: { at: number; udid: string | null } = {
		at: 0,
		udid: null,
	};

	constructor(
		private readonly lifecycle: DeviceLifecycleServiceValue,
		private readonly platform: NodeJS.Platform = process.platform,
	) {}

	async page(options: {
		selectedDevice: string | null;
		paging: { limit: number | null; offset: number };
		expose: (state: DeviceState) => DeviceState;
	}): Promise<GridPage> {
		const [states, simulators, androidDevices, androidAvds] = await Promise.all(
			[
				this.lifecycle.states(),
				this.listIosSimulators(),
				listAndroidDevices(),
				listAndroidAvds(),
			],
		);
		const helpers = new Map(
			states.map((state) => [state.device, state] as const),
		);
		const preferredUdid = await this.preferredIosDevice();

		// Reconcile lifecycle intent from the complete native catalog, before
		// paging or state-based ranking can omit the simulator from this response.
		this.lifecycle.reconcileCatalogState(
			simulators.map((device) => ({
				device: device.udid,
				state: device.state,
			})),
		);

		const stateRank = (device: SimctlDevice) => {
			if (helpers.has(device.udid)) return 0;
			if (options.selectedDevice === device.udid) return 1;
			if (device.state === "Booted") return 2;
			if (device.udid === preferredUdid) return 3;
			return 4;
		};
		simulators.sort(
			(left, right) =>
				stateRank(left) - stateRank(right) ||
				this.familyRank(left.name) - this.familyRank(right.name) ||
				left.name.localeCompare(right.name) ||
				this.runtimeRank(left.runtime) - this.runtimeRank(right.runtime),
		);

		const helperFor = (device: string) => {
			const state = helpers.get(device);
			if (!state) return null;
			const exposed = options.expose(state);
			return {
				port: exposed.port,
				url: exposed.url,
				streamUrl: exposed.streamUrl,
				wsUrl: exposed.wsUrl,
			};
		};

		const visibleAndroidDevices = visibleAndroidCatalogDevices(androidDevices);
		const runningAvdNames = new Set(
			visibleAndroidDevices
				.map((device) => device.avdName)
				.filter((name): name is string => !!name),
		);
		const androidAvdByName = new Map(
			androidAvds.map((avd) => [avd.name, avd] as const),
		);
		const androidRows: PendingGridDevice[] = visibleAndroidDevices.map((device) => {
			const id = androidStateId(device.serial);
			const release = device.release || device.sdk || "device";
			const avd = device.avdName
				? androidAvdByName.get(device.avdName)
				: undefined;
			return {
				device: id,
				catalogDevice: device.avdName
					? androidAvdStateId(device.avdName)
					: id,
				name: (
					avd?.displayName ||
					avd?.deviceName ||
					device.avdName ||
					device.model ||
					device.device ||
					device.serial
				).replace(/_/g, " "),
				runtime: `Android-${release.replace(/\./g, "-")}`,
				state: device.state === "device" ? "Booted" : device.state,
				chrome: null,
				placeholderAsset: null,
				helper: helperFor(id),
			};
		});
		const avdRows: PendingGridDevice[] = androidAvds
			.filter((avd) => !runningAvdNames.has(avd.name))
			.map((avd) => ({
				device: androidAvdStateId(avd.name),
				catalogDevice: androidAvdStateId(avd.name),
				name: (avd.displayName || avd.deviceName || avd.name).replace(
					/_/g,
					" ",
				),
				runtime: avd.release
					? `Android-${avd.release.replace(/\./g, "-")}`
					: "Android-AVD",
				state: "Shutdown",
				chrome: null,
				placeholderAsset: null,
				helper: null,
			}));
		const iosRows: PendingGridDevice[] = simulators.map((device) => ({
			device: device.udid,
			catalogDevice: device.udid,
			name: device.name,
			runtime: device.runtime,
			state: device.state,
			chrome: null,
			placeholderAsset: null,
			helper: helperFor(device.udid),
			ios: device,
		}));

		const rows = [...androidRows, ...avdRows, ...iosRows];
		const { limit, offset } = options.paging;
		const pageRows = limit == null ? rows : rows.slice(offset, offset + limit);
		const devices = await Promise.all(
			pageRows.map(async ({ ios, ...row }): Promise<GridDevice> =>
				ios
					? {
							...row,
							chrome: await resolveDeviceFrame(ios),
							placeholderAsset: await resolveDevicePlaceholderAsset(ios),
						}
					: row,
			),
		);
		return {
			devices,
			total: rows.length,
			offset: limit == null ? 0 : offset,
			limit: limit ?? rows.length,
		};
	}

	async memoryReport(): Promise<MemoryReport> {
		if (this.platform !== "darwin") {
			const text =
				this.platform === "linux"
					? await readFile("/proc/meminfo", "utf8").catch(() => "")
					: "";
			const memory = parseLinuxMemory(text);
			const states = await this.lifecycle.states();
			return {
				...memory,
				runningSimulators: states.filter((state) =>
					state.device.startsWith("android:emulator-"),
				).length,
				perSimAvgBytes: DEFAULT_PER_SIM_BYTES,
				perSimSource: "estimated",
				estimatedAdditional:
					memory.availableBytes === null
						? null
						: Math.floor(memory.availableBytes / DEFAULT_PER_SIM_BYTES),
			};
		}
		const [totalRaw, pageRaw, vmStat, processList] = await Promise.all([
			hostCommandText("sysctl", "-n", "hw.memsize").catch(() => "0"),
			hostCommandText("sysctl", "-n", "hw.pagesize").catch(() => "4096"),
			hostCommandText("vm_stat").catch(() => ""),
			hostCommandText("ps", "-axo", "rss=,args=").catch(() => ""),
		]);
		const pageSize = Number(pageRaw.trim()) || 4_096;
		const pages = (pattern: RegExp) => Number(vmStat.match(pattern)?.[1] ?? 0);
		const availableBytes = vmStat.trim()
			? (pages(/Pages free:\s+(\d+)/) +
					pages(/Pages inactive:\s+(\d+)/) +
					pages(/Pages speculative:\s+(\d+)/)) *
				pageSize
			: null;
		const perUdid: Record<string, number> = {};
		let simulatorBytes = 0;
		for (const line of processList.split("\n")) {
			const match = line.match(/^\s*(\d+)\s+.*\/Devices\/([0-9A-F-]{36})\//i);
			if (!match) continue;
			const bytes = Number(match[1]) * 1_024;
			const udid = match[2]!.toUpperCase();
			perUdid[udid] = (perUdid[udid] ?? 0) + bytes;
			simulatorBytes += bytes;
		}
		const runningSimulators = Object.keys(perUdid).length;
		const measuredAverage =
			runningSimulators > 0 ? simulatorBytes / runningSimulators : 0;
		const perSimSource: MemoryReport["perSimSource"] =
			measuredAverage >= 256 * 1024 * 1024 ? "measured" : "estimated";
		const perSimAvgBytes =
			perSimSource === "measured" ? measuredAverage : DEFAULT_PER_SIM_BYTES;
		return {
			totalBytes: Number(totalRaw.trim()) || null,
			availableBytes,
			runningSimulators,
			perSimAvgBytes,
			perSimSource,
			estimatedAdditional:
				availableBytes !== null && perSimAvgBytes > 0
					? Math.max(0, Math.floor(availableBytes / perSimAvgBytes))
					: null,
		};
	}

	private async listIosSimulators(): Promise<SimctlDevice[]> {
		const inventory = await listIosDevices({
			platform: this.platform,
			timeoutMs: 3000,
		});
		return Object.entries(inventory ?? {}).flatMap(([runtime, entries]) =>
			/SimRuntime\.(iOS|watchOS|visionOS|xrOS)-/i.test(runtime)
				? entries
						.filter((entry) => entry.isAvailable !== false)
						.map((entry) => ({
							...entry,
							runtime: runtime.replace(/^.*SimRuntime\./, ""),
						}))
				: [],
		);
	}

	private async preferredIosDevice(): Promise<string | null> {
		if (this.platform !== "darwin") return null;
		const now = Date.now();
		if (now - this.preferredSnapshot.at < 1_500)
			return this.preferredSnapshot.udid;
		const udid = await hostCommandText(
			"defaults",
			"read",
			"com.apple.iphonesimulator",
			"CurrentDeviceUDID",
		)
			.then((output) => output.trim() || null)
			.catch(() => null);
		this.preferredSnapshot = { at: now, udid };
		return udid;
	}

	private familyRank(name: string): number {
		if (/iphone/i.test(name)) return 0;
		if (/ipad/i.test(name)) return 1;
		if (/watch/i.test(name)) return 2;
		if (/(apple\s*tv|^tv\b)/i.test(name)) return 3;
		if (/vision|reality/i.test(name)) return 4;
		return 5;
	}

	private runtimeRank(runtime: string): number {
		const match = runtime.match(/-(\d+)-(\d+)/);
		const major = match ? Number(match[1]) : 0;
		const minor = match ? Number(match[2]) : 0;
		return -(major * 1_000 + minor);
	}
}
