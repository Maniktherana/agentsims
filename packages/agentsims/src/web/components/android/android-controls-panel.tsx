import { type ReactNode, useState } from "react";
import {
	Accessibility,
	Battery,
	BatteryCharging,
	Gauge,
	Monitor,
	Phone,
	Plane,
	Radio,
	Wifi,
} from "lucide-react";
import type {
	AndroidEnvironmentState,
	AndroidToolAction,
	AndroidToolCapabilities,
} from "../../../core/android/contracts";
import {
	SettingRow,
	SettingSelect,
} from "../dock/settings/simulator-settings-tool";
import { CollapsibleSection } from "../ui/collapsible-section";
import { SettingSwitch } from "../ui/setting-switch";
import { AndroidSavedStates } from "./android-saved-states";
import {
	formString,
	ToolField,
	toolButtonClass,
	toolInputClass,
} from "./tool-fields";

export type AndroidControlAction = Extract<
	AndroidToolAction,
	{
		type:
			| "network"
			| "battery"
			| "snapshot"
			| "density"
			| "locale"
			| "talkback"
			| "call"
			| "sms";
	}
>;

type Props = {
	deviceId: string;
	basePath: string;
	active: boolean;
	capabilities: AndroidToolCapabilities | null;
	state: AndroidEnvironmentState | null;
	busy: boolean;
	run: (action: AndroidControlAction) => Promise<boolean>;
};

export function networkSpeedLabel(
	network: AndroidEnvironmentState["network"] | undefined,
): string {
	const rate = (value: number | null | undefined) => {
		if (value == null) return "Unknown";
		if (value === 0) return "Unlimited";
		if (value >= 1_000_000)
			return `${Number((value / 1_000_000).toFixed(2))} Mbps`;
		if (value >= 1_000) return `${Number((value / 1_000).toFixed(2))} kbps`;
		return `${value} bps`;
	};
	if (network && network.downloadBps === network.uploadBps)
		return rate(network.downloadBps);
	return `↓ ${rate(network?.downloadBps)} · ↑ ${rate(network?.uploadBps)}`;
}

export function networkLatencyLabel(
	network: AndroidEnvironmentState["network"] | undefined,
): string {
	if (network?.minLatencyMs == null || network.maxLatencyMs == null)
		return "Current unavailable";
	return network.minLatencyMs === network.maxLatencyMs
		? `${network.minLatencyMs} ms`
		: `${network.minLatencyMs}–${network.maxLatencyMs} ms`;
}

const NETWORK_SPEEDS = [
	"full",
	"gsm",
	"hscsd",
	"gprs",
	"edge",
	"umts",
	"hsdpa",
	"lte",
] as const;
const NETWORK_DELAYS = ["none", "gprs", "edge", "umts"] as const;
const CALL_EVENTS = [
	{ value: "call", label: "Incoming call" },
	{ value: "accept", label: "Accept" },
	{ value: "cancel", label: "End call" },
	{ value: "busy", label: "Busy" },
	{ value: "hold", label: "Hold" },
] as const;

export function AndroidSimulatorControlRows({
	capabilities,
	state,
	busy,
	run,
}: Pick<Props, "capabilities" | "state" | "busy" | "run">) {
	const [batteryLevel, setBatteryLevel] = useState<string | null>(null);
	return (
		<>
			{(
				[
					["wifi", "Wi-Fi", capabilities?.wifi, <Wifi size={14} />],
					[
						"data",
						"Mobile data",
						capabilities?.mobileData,
						<Radio size={14} />,
					],
					[
						"airplane",
						"Airplane mode",
						capabilities?.airplaneMode,
						<Plane size={14} />,
					],
				] as const
			).map(([field, label, supported, icon]) => {
				const checked = state?.network[field];
				return (
					<SettingRow
						key={field}
						icon={icon}
						label={label}
						description={
							checked == null ? "Current state unavailable" : undefined
						}
					>
						<SettingSwitch
							label={label}
							checked={checked ?? false}
							disabled={busy || !supported || checked == null}
							onChange={(value) =>
								void run({ type: "network", [field]: value })
							}
						/>
					</SettingRow>
				);
			})}
			{capabilities?.networkConditions && (
				<>
					<SettingRow icon={<Gauge size={14} />} label="Network speed">
						<SettingSelect
							label="Network speed"
							className="max-w-[min(280px,55vw)]!"
							value="current"
							disabled={busy || !state}
							options={[
								{
									value: "current",
									label: networkSpeedLabel(state?.network),
								},
								...NETWORK_SPEEDS.map((value) => ({
									value,
									label: value === "full" ? "Unlimited" : value.toUpperCase(),
								})),
							]}
							onChange={(value) => {
								const speed = NETWORK_SPEEDS.find((speed) => speed === value);
								if (speed) void run({ type: "network", speed });
							}}
						/>
					</SettingRow>
					<SettingRow icon={<Gauge size={14} />} label="Network latency">
						<SettingSelect
							label="Network latency"
							value="current"
							disabled={busy || !state}
							options={[
								{
									value: "current",
									label: networkLatencyLabel(state?.network),
								},
								...NETWORK_DELAYS.map((value) => ({
									value,
									label:
										value === "none" ? "No added latency" : value.toUpperCase(),
								})),
							]}
							onChange={(value) => {
								const delay = NETWORK_DELAYS.find((delay) => delay === value);
								if (delay) void run({ type: "network", delay });
							}}
						/>
					</SettingRow>
				</>
			)}
			<SettingRow
				icon={<Battery size={14} />}
				label="Battery percent"
				description={
					state?.battery.level == null
						? "Current state unavailable"
						: state.battery.simulated
							? "Simulated"
							: undefined
				}
			>
				<form
					className="flex items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void run({
							type: "battery",
							level: Number(batteryLevel ?? state?.battery.level),
						}).then((ok) => {
							if (ok) setBatteryLevel(null);
						});
					}}
				>
					<input
						aria-label="Battery percent"
						name="level"
						className={`${toolInputClass} w-16!`}
						type="number"
						min="0"
						max="100"
						required
						value={batteryLevel ?? state?.battery.level ?? ""}
						placeholder="—"
						onChange={(event) => setBatteryLevel(event.target.value)}
					/>
					<button
						type="submit"
						aria-label="Set battery"
						className={toolButtonClass}
						disabled={busy}
					>
						Set
					</button>
				</form>
			</SettingRow>
			<SettingRow
				icon={<BatteryCharging size={14} />}
				label="Charging"
				description={
					state?.battery.charging == null
						? "Current state unavailable"
						: undefined
				}
			>
				<SettingSwitch
					label="Charging"
					checked={state?.battery.charging ?? false}
					disabled={busy || state?.battery.charging == null}
					onChange={(charging) => void run({ type: "battery", charging })}
				/>
			</SettingRow>
		</>
	);
}

export function AndroidControlsPanel({
	deviceId,
	basePath,
	active,
	capabilities,
	state,
	busy,
	run,
}: Props) {
	const [density, setDensity] = useState<string | null>(null);
	const [callEvent, setCallEvent] =
		useState<(typeof CALL_EVENTS)[number]["value"]>("call");
	return (
		<>
			{capabilities?.snapshots && (
				<AndroidSavedStates
					deviceId={deviceId}
					basePath={basePath}
					active={active}
					busy={busy}
					run={run}
				/>
			)}
			<ToolSection
				title="Display and accessibility"
				icon={<Monitor size={14} strokeWidth={2} />}
			>
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void run({
							type: "density",
							dpi: Number(density ?? state?.display.density),
						}).then((ok) => {
							if (ok) setDensity(null);
						});
					}}
				>
					<ToolField label="Display density (DPI)">
						<input
							className={toolInputClass}
							name="dpi"
							type="number"
							min="72"
							max="1200"
							required
							value={density ?? state?.display.density ?? ""}
							placeholder="Unknown"
							onChange={(event) => setDensity(event.target.value)}
						/>
					</ToolField>
					<button type="submit" className={toolButtonClass} disabled={busy}>
						Set density
					</button>
					<button
						type="button"
						className={toolButtonClass}
						disabled={busy}
						onClick={() =>
							void run({ type: "density", dpi: "reset" }).then((ok) => {
								if (ok) setDensity(null);
							})
						}
					>
						Reset density
					</button>
				</form>
				{capabilities?.appLocale && (
					<form
						className="flex flex-wrap items-end gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							void run({
								type: "locale",
								package: formString(data, "package"),
								locale: formString(data, "locale"),
							});
						}}
					>
						<ToolField label="App package">
							<input
								className={toolInputClass}
								name="package"
								required
								placeholder="com.example.app"
							/>
						</ToolField>
						<ToolField label="App language">
							<input
								className={toolInputClass}
								name="locale"
								placeholder="fr-FR; blank to reset"
							/>
						</ToolField>
						<button type="submit" className={toolButtonClass} disabled={busy}>
							Set language
						</button>
					</form>
				)}
				<SettingRow
					icon={<Accessibility size={14} />}
					label="TalkBack"
					description={
						!capabilities?.talkback
							? "Not installed"
							: state?.display.talkback == null
								? "Current state unavailable"
								: undefined
					}
				>
					<SettingSwitch
						label="TalkBack"
						checked={state?.display.talkback ?? false}
						disabled={
							busy || !capabilities?.talkback || state?.display.talkback == null
						}
						onChange={(enabled) => void run({ type: "talkback", enabled })}
					/>
				</SettingRow>
			</ToolSection>
			{capabilities?.telephony && (
				<ToolSection
					title="Calls and messages"
					icon={<Phone size={14} strokeWidth={2} />}
				>
					<form
						className="flex flex-wrap items-end gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void run({
								type: "call",
								number: formString(new FormData(event.currentTarget), "number"),
								operation: callEvent,
							});
						}}
					>
						<ToolField label="Phone number">
							<input
								className={toolInputClass}
								name="number"
								defaultValue="5551234567"
								required
							/>
						</ToolField>
						<ToolField label="Call event">
							<SettingSelect
								label="Call event"
								value={callEvent}
								options={[...CALL_EVENTS]}
								disabled={busy}
								onChange={(value) => {
									const event = CALL_EVENTS.find(
										(event) => event.value === value,
									);
									if (event) setCallEvent(event.value);
								}}
							/>
						</ToolField>
						<button type="submit" className={toolButtonClass} disabled={busy}>
							Send call event
						</button>
					</form>
					<form
						className="flex flex-wrap items-end gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							void run({
								type: "sms",
								number: formString(data, "number"),
								text: formString(data, "text"),
							});
						}}
					>
						<ToolField label="Sender">
							<input
								className={toolInputClass}
								name="number"
								defaultValue="5551234567"
								required
							/>
						</ToolField>
						<ToolField label="Message">
							<input className={toolInputClass} name="text" required />
						</ToolField>
						<button type="submit" className={toolButtonClass} disabled={busy}>
							Send SMS
						</button>
					</form>
				</ToolSection>
			)}
		</>
	);
}

function ToolSection({
	title,
	icon,
	children,
}: {
	title: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			summary={
				<div className="flex min-w-0 items-center gap-2">
					<span className="shrink-0 text-white/45">{icon}</span>
					<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
						{title}
					</span>
				</div>
			}
		>
			{children}
		</CollapsibleSection>
	);
}
