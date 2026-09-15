import { Search } from "lucide-react";
import { DeviceRow } from "./device-row";
import type { DemoDevice, DemoDevices } from "./devices";

function DeviceSection({
	label,
	devices,
	selectedId,
}: {
	label: string;
	devices: DemoDevice[];
	selectedId: string;
}) {
	return (
		<>
			<div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase text-white/35">
				<span>{label}</span>
				<span className="tabular-nums text-white/25">{devices.length}</span>
			</div>
			<div className="flex flex-col gap-0.5">
				{devices.map((device) => (
					<DeviceRow
						key={device.id}
						device={device}
						active={device.id === selectedId}
					/>
				))}
			</div>
		</>
	);
}

export function DeviceList({ devices }: { devices: DemoDevices }) {
	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 [scrollbar-width:thin]">
				<DeviceSection
					label="Available"
					devices={devices.available}
					selectedId={devices.selectedId}
				/>
			</div>
			<div className="max-h-44 shrink-0 overflow-x-hidden overflow-y-auto border-t border-white/[0.08] px-2 py-1 [scrollbar-width:thin]">
				<DeviceSection
					label="Running"
					devices={devices.running}
					selectedId={devices.selectedId}
				/>
			</div>
			<div className="flex shrink-0 items-center gap-2 border-t border-white/[0.08] bg-[#181818] p-2">
				<label className="flex h-10 min-w-0 flex-1 items-center gap-2 bg-white/[0.06] px-2.5 [border-radius:8px] [transition:background-color_150ms_ease] focus-within:bg-white/[0.09]">
					<Search
						size={14}
						strokeWidth={2}
						className="shrink-0 text-white/35"
					/>
					<input
						readOnly
						value=""
						placeholder="Search devices"
						className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-white/90 outline-none placeholder:text-white/35"
					/>
				</label>
			</div>
		</>
	);
}
