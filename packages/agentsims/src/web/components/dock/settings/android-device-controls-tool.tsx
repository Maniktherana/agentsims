import { Button } from "@agentsims/ui/components/button";
import { useSettingsRefresh } from "./settings-refresh";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { notify } from "../../ui/toast";
import type {
	AndroidEnvironmentState,
	AndroidToolCapabilities,
} from "../../../../core/android/contracts";
import {
	androidToolsRequest,
	runAndroidTool,
} from "../../../android/tools-client";
import { simEndpoint } from "../../../preview/sim-endpoint";
import {
	AndroidControlsPanel,
	AndroidSimulatorControlRows,
	type AndroidControlAction,
} from "../../android/android-controls-panel";

export function androidControlFeedback(action: AndroidControlAction): {
	success: string;
	failure: string;
} {
	switch (action.type) {
		case "network": {
			for (const [field, label] of [
				["wifi", "Wi-Fi"],
				["data", "Mobile data"],
				["airplane", "Airplane mode"],
			] as const) {
				const enabled = action[field];
				if (enabled !== undefined)
					return {
						success: `${label} ${enabled ? "enabled" : "disabled"}`,
						failure: `Could not ${enabled ? "enable" : "disable"} ${label}`,
					};
			}
			if (action.speed && action.delay)
				return {
					success: "Network conditions reset",
					failure: "Could not reset network conditions",
				};
			if (action.speed)
				return {
					success: `Network speed set to ${action.speed === "full" ? "unlimited" : action.speed.toUpperCase()}`,
					failure: "Could not set network speed",
				};
			return {
				success: `Network latency set to ${action.delay === "none" ? "none" : action.delay?.toUpperCase()}`,
				failure: "Could not set network latency",
			};
		}
		case "battery":
			if (action.reset)
				return {
					success: "Battery simulation reset",
					failure: "Could not reset battery simulation",
				};
			if (action.level !== undefined)
				return {
					success: `Battery set to ${action.level}%`,
					failure: "Could not set battery level",
				};
			return {
				success: action.charging ? "Charging enabled" : "Charging disabled",
				failure: "Could not change charging state",
			};
		case "snapshot": {
			const verbs = {
				list: ["Loaded", "load"],
				save: ["Saved", "save"],
				load: ["Restored", "restore"],
				delete: ["Deleted", "delete"],
			} as const;
			const [past, verb] = verbs[action.operation];
			return {
				success: `${past} snapshot “${action.name}”`,
				failure: `Could not ${verb} snapshot “${action.name}”`,
			};
		}
		case "density":
			return {
				success:
					action.dpi === "reset"
						? "Display density reset"
						: `Display density set to ${action.dpi} DPI`,
				failure: "Could not change display density",
			};
		case "locale":
			return {
				success: action.locale
					? `App language set to ${action.locale}`
					: "App language reset",
				failure: `Could not change language for ${action.package}`,
			};
		case "talkback":
			return {
				success: `TalkBack ${action.enabled ? "enabled" : "disabled"}`,
				failure: "Could not change TalkBack",
			};
		case "call": {
			const messages = {
				call: "Incoming call sent",
				accept: "Call accepted",
				cancel: "Call ended",
				busy: "Busy signal sent",
				hold: "Call put on hold",
			};
			return {
				success: messages[action.operation],
				failure: "Could not send call event",
			};
		}
		case "sms":
			return {
				success: `SMS received from ${action.number}`,
				failure: "Could not send SMS",
			};
	}
}

type DeviceControlsProps = {
	udid: string;
	active?: boolean;
	children: (controls: {
		simulatorRows: ReactNode;
		deviceSections: ReactNode;
	}) => ReactNode;
};

export function AndroidDeviceControlsTool(props: DeviceControlsProps) {
	return <DeviceControls key={props.udid} {...props} />;
}

function DeviceControls({
	udid,
	active = true,
	children,
}: DeviceControlsProps) {
	const basePath = simEndpoint("");
	const [capabilities, setCapabilities] =
		useState<AndroidToolCapabilities | null>(null);
	const [state, setState] = useState<AndroidEnvironmentState | null>(null);
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const read = useRef<AbortController | null>(null);
	const write = useRef<AbortController | null>(null);
	const refresh = useCallback(
		async (includeCapabilities = false) => {
			read.current?.abort();
			const controller = new AbortController();
			read.current = controller;
			setLoading(true);
			setError(null);
			try {
				const [environment, available] = await Promise.all([
					androidToolsRequest<AndroidEnvironmentState>(
						basePath,
						udid,
						"state",
						{
							signal: controller.signal,
						},
					),
					includeCapabilities
						? androidToolsRequest<AndroidToolCapabilities>(
								basePath,
								udid,
								"capabilities",
								{ signal: controller.signal },
							)
						: null,
				]);
				if (!controller.signal.aborted) {
					setState(environment);
					if (available) setCapabilities(available);
				}
			} catch (cause) {
				if (!controller.signal.aborted) {
					setState(null);
					setError(
						cause instanceof Error
							? cause.message
							: "Could not read device state",
					);
				}
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		},
		[basePath, udid],
	);
	useSettingsRefresh(() => refresh(true));

	useEffect(() => {
		if (!active) return;
		void refresh(true);
		const onFocus = () => {
			if (!write.current) void refresh(true);
		};
		window.addEventListener("focus", onFocus);
		return () => {
			read.current?.abort();
			window.removeEventListener("focus", onFocus);
		};
	}, [active, refresh]);
	useEffect(
		() => () => {
			read.current?.abort();
			write.current?.abort();
		},
		[],
	);
	const run = useCallback(
		async (action: AndroidControlAction): Promise<boolean> => {
			if (
				write.current ||
				(action.type === "snapshot" && action.operation === "list")
			)
				return false;
			read.current?.abort();
			const controller = new AbortController();
			write.current = controller;
			setBusy(true);
			const feedback = androidControlFeedback(action);
			try {
				await runAndroidTool(basePath, udid, action, controller.signal);
				if (controller.signal.aborted) return false;
				notify("success", feedback.success);
				if (
					action.type === "network" ||
					action.type === "battery" ||
					action.type === "density" ||
					action.type === "talkback" ||
					(action.type === "snapshot" && action.operation === "load")
				)
					await refresh();
				return !controller.signal.aborted;
			} catch (cause) {
				if (!controller.signal.aborted)
					notify("error", feedback.failure, {
						description: cause instanceof Error ? cause.message : String(cause),
					});
				return false;
			} finally {
				if (write.current === controller) {
					write.current = null;
					if (!controller.signal.aborted) setBusy(false);
				}
			}
		},
		[basePath, udid, refresh],
	);
	const simulatorRows = (
		<>
			{error && (
				<div
					className="flex items-center justify-between gap-2 rounded-[8px] bg-danger/10 px-2.5 py-2 text-[12px] text-danger-soft"
					role="alert"
				>
					<span className="min-w-0">Could not read device state: {error}</span>
					<Button
						variant="raised"
						size="sm"
						type="button"
						className="text-danger-soft"
						disabled={loading}
						onClick={() => void refresh(true)}
					>
						Retry
					</Button>
				</div>
			)}
			<AndroidSimulatorControlRows
				capabilities={capabilities}
				state={state}
				busy={busy || loading}
				run={run}
			/>
		</>
	);
	return children({
		simulatorRows,
		deviceSections: (
			<AndroidControlsPanel
				deviceId={udid}
				basePath={basePath}
				active={active}
				capabilities={capabilities}
				state={state}
				busy={busy || loading}
				run={run}
			/>
		),
	});
}
