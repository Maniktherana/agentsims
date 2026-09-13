import {
	createParser,
	parseAsString,
	parseAsStringEnum,
	throttle,
	useQueryStates,
} from "nuqs";
import { useEffect } from "react";

export type WorkspacePanel = "devices" | "tools" | "devtools";
export type CanvasPan = { x: number; y: number };
export type WorkspaceDeviceOffset = { x: number; y: number };
export type WorkspaceDeviceOffsets = Record<string, WorkspaceDeviceOffset>;

export function nextWorkspacePanel(
	current: WorkspacePanel | null,
	panel: WorkspacePanel,
	open: boolean,
): WorkspacePanel | null {
	if (open) return panel;
	return current === panel ? null : current;
}

function decodeDeviceId(value: string): string | null {
	try {
		return decodeURIComponent(value) || null;
	} catch {
		return null;
	}
}

/** An empty value is significant: `devices=` is an explicitly empty canvas. */
export const devicesParser = createParser<string[]>({
	parse(value) {
		if (value === "") return [];
		return [
			...new Set(
				value
					.split(",")
					.map(decodeDeviceId)
					.filter((id): id is string => id !== null),
			),
		];
	},
	serialize(value) {
		return value.map((id) => encodeURIComponent(id)).join(",");
	},
	eq(a, b) {
		return a.length === b.length && a.every((id, index) => id === b[index]);
	},
});

export const finiteFloatParser = createParser<number>({
	parse(value) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	},
	serialize(value) {
		return Number.isFinite(value) ? String(value) : "0";
	},
});

export const deviceOffsetsParser = createParser<WorkspaceDeviceOffsets>({
	parse(value) {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return null;
			}
			return Object.fromEntries(
				Object.entries(parsed).flatMap(([deviceId, offset]) => {
					if (
						!offset ||
						typeof offset !== "object" ||
						typeof (offset as WorkspaceDeviceOffset).x !== "number" ||
						typeof (offset as WorkspaceDeviceOffset).y !== "number" ||
						!Number.isFinite((offset as WorkspaceDeviceOffset).x) ||
						!Number.isFinite((offset as WorkspaceDeviceOffset).y)
					) {
						return [];
					}
					return [[deviceId, offset as WorkspaceDeviceOffset]];
				}),
			);
		} catch {
			return null;
		}
	},
	serialize(value) {
		return JSON.stringify(value);
	},
	eq(a, b) {
		return JSON.stringify(a) === JSON.stringify(b);
	},
});

export function useWorkspaceUrlState() {
	const [state, setState] = useQueryStates(
		{
			devices: devicesParser,
			focus: parseAsString,
			panel: parseAsStringEnum<WorkspacePanel>([
				"devices",
				"tools",
				"devtools",
			]),
			settings: parseAsString,
			target: parseAsString,
			panX: finiteFloatParser,
			panY: finiteFloatParser,
			positions: deviceOffsetsParser,
			legacyDevice: parseAsString,
		},
		{
			history: "replace",
			shallow: true,
			limitUrlUpdates: throttle(150),
			urlKeys: { legacyDevice: "device" },
		},
	);

	useEffect(() => {
		if (!state.legacyDevice) return;
		void setState({
			focus: state.focus ?? state.legacyDevice,
			legacyDevice: null,
		});
	}, [setState, state.focus, state.legacyDevice]);

	return {
		...state,
		pan: { x: state.panX ?? 0, y: state.panY ?? 0 },
		setDevices: (devices: string[] | null) => setState({ devices }),
		setFocus: (focus: string | null) => setState({ focus }),
		setDevicesAndFocus: (devices: string[], focus: string | null) =>
			setState({ devices, focus }),
		setPanel: (panel: WorkspacePanel | null) => setState({ panel }),
		setSettings: (settings: string | null) => setState({ settings }),
		setTarget: (target: string | null) => setState({ target }),
		setPan: ({ x, y }: CanvasPan) =>
			setState({
				panX: Math.abs(x) < 0.01 ? null : Math.round(x * 100) / 100,
				panY: Math.abs(y) < 0.01 ? null : Math.round(y * 100) / 100,
			}),
		setPositions: (positions: WorkspaceDeviceOffsets) =>
			setState({ positions: Object.keys(positions).length ? positions : null }),
	};
}
