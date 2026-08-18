import { Monitor, RefreshCw, Smartphone, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { simEndpoint } from "../../../preview/sim-endpoint";
import type { AndroidStatus } from "../../../../android/device/types";
import { SettingRow } from "./simulator-settings-tool";

const STATUS_VALUE =
	"min-w-0 max-w-[190px] truncate text-right text-[12px] font-medium tabular-nums text-white/72";

function androidSerial(udid: string) {
	return udid.startsWith("android:") ? udid.slice("android:".length) : udid;
}

function cleanValue(value: string | undefined): string {
	return value?.replace(/_/g, " ").trim() || "unknown";
}

export function formatAndroidDisplay(status: AndroidStatus | null): string {
	const screen = status?.screen;
	if (!screen) return "Loading";
	return `${screen.width} × ${screen.height}${screen.density ? ` @ ${screen.density} dpi` : ""}`;
}

export function formatAndroidStream(status: AndroidStatus | null): string {
	if (!status?.stream) return "Loading";
	if (status.stream.transport === "mmap-ffmpeg-h264") {
		return "H.264 · emulator framebuffer";
	}
	if (status.stream.transport === "scrcpy-h264") return "H.264 · scrcpy";
	return "Live stream unavailable";
}

function useAndroidStatus(udid: string) {
	const [status, setStatus] = useState<AndroidStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const refreshIdRef = useRef(0);
	const endpoint = useMemo(
		() => simEndpoint(`helper/${encodeURIComponent(udid)}/status`),
		[udid],
	);

	const refresh = useCallback(
		(signal?: AbortSignal) => {
			const refreshId = ++refreshIdRef.current;
			setLoading(true);
			setError(null);
			fetch(endpoint, { cache: "no-store", signal })
				.then(async (res) => {
					if (!res.ok) throw new Error(`status ${res.status}`);
					return res.json() as Promise<AndroidStatus>;
				})
				.then((nextStatus) => {
					if (refreshId === refreshIdRef.current) setStatus(nextStatus);
				})
				.catch((err) => {
					if (err?.name === "AbortError" || refreshId !== refreshIdRef.current)
						return;
					setError(err instanceof Error ? err.message : String(err));
				})
				.finally(() => {
					if (refreshId === refreshIdRef.current) setLoading(false);
				});
		},
		[endpoint],
	);

	useEffect(() => {
		const ac = new AbortController();
		setStatus(null);
		refresh(ac.signal);
		return () => {
			ac.abort();
		};
	}, [refresh]);

	return { status, loading, error, refresh };
}

export function AndroidDeviceDetailsTool({ udid }: { udid: string }) {
	const { status, loading, error, refresh } = useAndroidStatus(udid);

	return (
		<AndroidControlsStatus
			udid={udid}
			status={status}
			loading={loading}
			error={error}
			onRefresh={() => refresh()}
		/>
	);
}

export function AndroidControlsStatus({
	udid,
	status,
	loading,
	error,
	onRefresh,
}: {
	udid: string;
	status: AndroidStatus | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
}) {
	const displayName =
		status?.camera?.displayName || status?.avdName || status?.model;

	return (
		<div
			data-android-controls={loading ? "loading" : "ready"}
			className="flex flex-col gap-1.5"
		>
			<div data-android-metadata className="flex flex-col gap-1.5">
				<SettingRow
					icon={<Smartphone size={14} strokeWidth={2} />}
					label="Device"
				>
					<span
						data-android-device-subtitle
						className={STATUS_VALUE}
						title={status ? cleanValue(displayName) : undefined}
					>
						{status ? cleanValue(displayName) : "Loading"}
					</span>
				</SettingRow>
				<SettingRow
					icon={<span className="text-[10px] font-semibold">OS</span>}
					label="Version"
				>
					<span className={STATUS_VALUE}>
						{status?.release ? `Android ${status.release}` : "Loading"}
					</span>
				</SettingRow>
				<SettingRow
					icon={<Monitor size={14} strokeWidth={2} />}
					label="Display"
				>
					<span className={STATUS_VALUE} title={formatAndroidDisplay(status)}>
						{formatAndroidDisplay(status)}
					</span>
				</SettingRow>
				<SettingRow icon={<Video size={14} strokeWidth={2} />} label="Stream">
					<span className={STATUS_VALUE} title={formatAndroidStream(status)}>
						{formatAndroidStream(status)}
					</span>
				</SettingRow>
				<SettingRow
					icon={<span className="text-[10px] font-semibold">ID</span>}
					label="Device ID"
				>
					<code
						className="min-w-0 max-w-[150px] truncate rounded-[8px] bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/48"
						title={androidSerial(udid)}
					>
						{androidSerial(udid)}
					</code>
				</SettingRow>
			</div>
			{error && (
				<div
					className="flex items-center justify-between gap-2 rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[11px] font-medium text-red-200/80"
					role="alert"
				>
					<span className="min-w-0">
						Could not load Android details: {error}
					</span>
					<button
						type="button"
						onClick={onRefresh}
						className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] bg-white/[0.06] px-2 text-[10px] text-white/70 [transition:background,color,transform] duration-100 hover:bg-white/[0.1] hover:text-white active:scale-[0.97]"
						disabled={loading}
					>
						<RefreshCw
							size={13}
							strokeWidth={2}
							className={loading ? "animate-spin" : undefined}
						/>
						Retry
					</button>
				</div>
			)}
		</div>
	);
}
