import { execFile } from "child_process";
import {
	androidAvdStateId,
	androidStateId,
	listAndroidAvds,
	listAndroidDevices,
} from "../../android/device/device";
import {
	resolveDeviceKitChrome,
	resolveDevicePlaceholderAsset,
	type DeviceKitChromeDescriptor,
	type DevicePlaceholderAssetDescriptor,
} from "./devicekit-chrome";
import { deviceLifecycle, type DeviceLifecycle } from "./device-lifecycle";
import type { DeviceState } from "../../shared/state";
import { hostCommandText } from "../runtime/host-tools-runtime";

type SimctlDevice = {
	udid: string;
	name: string;
	state: string;
	isAvailable?: boolean;
	deviceTypeIdentifier?: string;
	runtime: string;
};

type SimctlAllList = {
	devices: Record<string, Array<Omit<SimctlDevice, "runtime">>>;
};

export type GridDevice = {
	device: string;
	name: string;
	runtime: string;
	state: string;
	chrome: DeviceKitChromeDescriptor | null;
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
	totalBytes: number;
	availableBytes: number;
	runningSimulators: number;
	perSimAvgBytes: number;
	perSimSource: "measured" | "estimated";
	estimatedAdditional: number;
};

type PendingGridDevice = Omit<GridDevice, "chrome" | "placeholderAsset"> & {
	ios?: SimctlDevice;
	chrome: null;
	placeholderAsset: null;
};

const DEFAULT_PER_SIM_BYTES = 1.5 * 1024 * 1024 * 1024;

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

	constructor(private readonly lifecycle: DeviceLifecycle = deviceLifecycle) {}

	async page(options: {
		selectedDevice: string | null;
		paging: { limit: number | null; offset: number };
		expose: (state: DeviceState) => DeviceState;
	}): Promise<GridPage> {
		const [states, simulators, discoveredAndroidDevices, androidAvds] =
			await Promise.all([
				this.lifecycle.states(),
				this.listIosSimulators(),
				listAndroidDevices(),
				listAndroidAvds(),
			]);
		const androidDevices = discoveredAndroidDevices.filter((device) =>
			/^emulator-\d+$/.test(device.serial),
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

		const runningAvdNames = new Set(
			androidDevices
				.map((device) => device.avdName)
				.filter((name): name is string => !!name),
		);
		const androidAvdByName = new Map(
			androidAvds.map((avd) => [avd.name, avd] as const),
		);
		const androidRows: PendingGridDevice[] = androidDevices.map((device) => {
			const id = androidStateId(device.serial);
			const release = device.release || device.sdk || "device";
			const avd = device.avdName
				? androidAvdByName.get(device.avdName)
				: undefined;
			return {
				device: id,
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
				name: (avd.displayName || avd.deviceName || avd.name).replace(
					/_/g,
					" ",
				),
				runtime: "Android-AVD",
				state: "Shutdown",
				chrome: null,
				placeholderAsset: null,
				helper: null,
			}));
		const iosRows: PendingGridDevice[] = simulators.map((device) => ({
			device: device.udid,
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
							chrome: await resolveDeviceKitChrome(ios),
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
		const [totalRaw, pageRaw, vmStat, processList] = await Promise.all([
			hostCommandText("sysctl", "-n", "hw.memsize").catch(() => "0"),
			hostCommandText("sysctl", "-n", "hw.pagesize").catch(() => "4096"),
			hostCommandText("vm_stat").catch(() => ""),
			hostCommandText("ps", "-axo", "rss=,args=").catch(() => ""),
		]);
		const pageSize = Number(pageRaw.trim()) || 4_096;
		const pages = (pattern: RegExp) => Number(vmStat.match(pattern)?.[1] ?? 0);
		const availableBytes =
			(pages(/Pages free:\s+(\d+)/) +
				pages(/Pages inactive:\s+(\d+)/) +
				pages(/Pages speculative:\s+(\d+)/)) *
			pageSize;
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
			totalBytes: Number(totalRaw.trim()) || 0,
			availableBytes,
			runningSimulators,
			perSimAvgBytes,
			perSimSource,
			estimatedAdditional:
				perSimAvgBytes > 0
					? Math.max(0, Math.floor(availableBytes / perSimAvgBytes))
					: 0,
		};
	}

	private listIosSimulators(): Promise<SimctlDevice[]> {
		return new Promise((resolve) => {
			execFile(
				"xcrun",
				["simctl", "list", "devices", "-j"],
				{ encoding: "utf-8", timeout: 3_000, maxBuffer: 8 * 1024 * 1024 },
				(error, stdout) => {
					if (error) return resolve([]);
					try {
						const data = JSON.parse(stdout) as SimctlAllList;
						const devices: SimctlDevice[] = [];
						for (const [runtime, entries] of Object.entries(data.devices)) {
							if (!/SimRuntime\.(iOS|watchOS|visionOS|xrOS)-/i.test(runtime))
								continue;
							for (const entry of entries) {
								if (entry.isAvailable === false) continue;
								devices.push({
									...entry,
									runtime: runtime.replace(/^.*SimRuntime\./, ""),
								});
							}
						}
						resolve(devices);
					} catch {
						resolve([]);
					}
				},
			);
		});
	}

	private async preferredIosDevice(): Promise<string | null> {
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

export const deviceCatalog = new DeviceCatalog();
