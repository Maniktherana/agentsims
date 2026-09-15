import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
	if (!network || (network.downloadBps == null && network.uploadBps == null))
		return "—";
	const rate = (value: number | null | undefined) => {
		if (value == null) return "—";
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
	if (network?.minLatencyMs == null || network.maxLatencyMs == null) return "—";
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
					<SettingRow key={field} icon={icon} label={label}>
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
			{(capabilities === null || capabilities.networkConditions) && (
				<>
					<SettingRow icon={<Gauge size={14} />} label="Network speed">
						<SettingSelect
							label="Network speed"
							className="max-w-[min(280px,55vw)]!"
							value="current"
							disabled={busy || !capabilities?.networkConditions || !state}
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
							disabled={busy || !capabilities?.networkConditions || !state}
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
				description={state?.battery.simulated ? "Simulated" : undefined}
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
					<Input
						aria-label="Battery percent"
						name="level"
						className="w-16!"
						type="number"
						min="0"
						max="100"
						required
						disabled={busy || state?.battery.level == null}
						value={batteryLevel ?? state?.battery.level ?? ""}
						placeholder="—"
						onChange={(event) => setBatteryLevel(event.target.value)}
					/>
					<Button
						type="submit"
						aria-label="Set battery"
						disabled={busy || state?.battery.level == null}
					>
						Set
					</Button>
				</form>
			</SettingRow>
			<SettingRow icon={<BatteryCharging size={14} />} label="Charging">
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
						<Input
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
					<Button type="submit" disabled={busy}>
						Set density
					</Button>
					<Button
						type="button"
						disabled={busy}
						onClick={() =>
							void run({ type: "density", dpi: "reset" }).then((ok) => {
								if (ok) setDensity(null);
							})
						}
					>
						Reset density
					</Button>
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
							<Input
								name="package"
								required
								placeholder="com.example.app"
							/>
						</ToolField>
						<ToolField label="App language">
							<Input
								name="locale"
								placeholder="fr-FR; blank to reset"
							/>
						</ToolField>
						<Button type="submit" disabled={busy}>
							Set language
						</Button>
					</form>
				)}
				<SettingRow
					icon={<Accessibility size={14} />}
					label="TalkBack"
					description={
						capabilities?.talkback === false ? "Not installed" : undefined
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
							<Input
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
						<Button type="submit" disabled={busy}>
							Send call event
						</Button>
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
							<Input
								name="number"
								defaultValue="5551234567"
								required
							/>
						</ToolField>
						<ToolField label="Message">
							<Input name="text" required />
						</ToolField>
						<Button type="submit" disabled={busy}>
							Send SMS
						</Button>
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
