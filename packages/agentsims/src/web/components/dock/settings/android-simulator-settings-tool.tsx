import { Button } from "../../ui/button";
import { useSettingsRefresh } from "./settings-refresh";
import { Smartphone } from "lucide-react";
import {
	CircleDot,
	Gauge,
	MoonStar,
	MousePointerClick,
	Type,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { AndroidToolAction } from "../../../../core/android/contracts";
import { runAndroidTool } from "../../../android/tools-client";
import { simEndpoint } from "../../../preview/sim-endpoint";
import { CollapsibleSection } from "../../ui/collapsible-section";
import {
	SettingRow,
	SettingSelect,
	TextSizeSlider,
} from "./simulator-settings-tool";
import { SettingSwitch } from "../../ui/setting-switch";

export const ANDROID_FONT_SCALES = [0.85, 0.9, 1, 1.1, 1.2, 1.3, 1.5] as const;

export interface AndroidSimulatorSettings {
	appearance: "light" | "dark";
	textSizeIndex: number;
	reduceMotion: boolean;
	showTouches: boolean;
	pointerLocation: boolean;
}

const DEFAULT_SETTINGS: AndroidSimulatorSettings = {
	appearance: "light",
	textSizeIndex: 2,
	reduceMotion: false,
	showTouches: false,
	pointerLocation: false,
};

function numberOr(value: string, fallback: number): number {
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanSetting(value: string): boolean {
	return value.trim() === "1";
}

export function nearestAndroidFontScaleIndex(value: string): number {
	const scale = numberOr(value, 1);
	let nearest = 0;
	let distance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < ANDROID_FONT_SCALES.length; index++) {
		const nextDistance = Math.abs(ANDROID_FONT_SCALES[index]! - scale);
		if (nextDistance < distance) {
			nearest = index;
			distance = nextDistance;
		}
	}
	return nearest;
}

export function parseAndroidSimulatorSettings(input: {
	nightMode: string;
	fontScale: string;
	animationScale: string;
	showTouches: string;
	pointerLocation: string;
}): AndroidSimulatorSettings {
	return {
		appearance: /\bNight mode:\s*yes\b/i.test(input.nightMode)
			? "dark"
			: "light",
		textSizeIndex: nearestAndroidFontScaleIndex(input.fontScale),
		reduceMotion: numberOr(input.animationScale, 1) === 0,
		showTouches: booleanSetting(input.showTouches),
		pointerLocation: booleanSetting(input.pointerLocation),
	};
}

function Icon({ children }: { children: ReactNode }) {
	return <span className="text-white/82">{children}</span>;
}

type AndroidSettingsProps = {
	udid: string;
	children?: ReactNode;
};
export function AndroidSimulatorSettingsTool(props: AndroidSettingsProps) {
	return <AndroidDeviceSettings key={props.udid} {...props} />;
}

function AndroidDeviceSettings({ udid, children }: AndroidSettingsProps) {
	const lifetime = useRef<AbortController | null>(null);
	if (lifetime.current === null) lifetime.current = new AbortController();
	useEffect(() => {
		if (lifetime.current!.signal.aborted)
			lifetime.current = new AbortController();
		const controller = lifetime.current!;
		return () => controller.abort();
	}, []);
	const basePath = simEndpoint("");
	const [open, setOpen] = useState(true);
	const [settings, setSettings] = useState<AndroidSimulatorSettings | null>(
		null,
	);
	const [pending, setPending] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const refreshId = useRef(0);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(
		async (signal = lifetime.current!.signal) => {
			const requestId = ++refreshId.current;
			setLoading(true);
			setError(null);
			try {
				const value = await runAndroidTool<{
					theme: string;
					fontScale: string;
					animationScale: string;
					showTouches: string;
					pointerLocation: string;
				}>(basePath, udid, { type: "settings" }, signal);
				if (signal.aborted || requestId !== refreshId.current) return;
				setSettings(
					parseAndroidSimulatorSettings({ ...value, nightMode: value.theme }),
				);
			} catch (reason) {
				if (
					signal.aborted ||
					requestId !== refreshId.current ||
					(reason instanceof DOMException && reason.name === "AbortError")
				)
					return;
				setError(reason instanceof Error ? reason.message : String(reason));
			} finally {
				if (!signal.aborted && requestId === refreshId.current)
					setLoading(false);
			}
		},
		[basePath, udid],
	);

	useSettingsRefresh(() => refresh());

	useEffect(() => {
		const controller = new AbortController();
		setSettings(null);
		void refresh(controller.signal);
		return () => controller.abort();
	}, [refresh]);

	const run = useCallback(
		async (
			key: string,
			next: AndroidSimulatorSettings,
			action: Extract<AndroidToolAction, { type: "settings" }>,
		) => {
			setPending(key);
			setError(null);
			setSettings(next);
			try {
				const value = await runAndroidTool<{
					theme: string;
					fontScale: string;
					animationScale: string;
					showTouches: string;
					pointerLocation: string;
				}>(basePath, udid, action, lifetime.current!.signal);
				if (!lifetime.current!.signal.aborted)
					setSettings(
						parseAndroidSimulatorSettings({ ...value, nightMode: value.theme }),
					);
			} catch (reason) {
				if (lifetime.current!.signal.aborted) return;
				setError(
					reason instanceof Error ? reason.message : `Could not update ${key}`,
				);
				void refresh();
			} finally {
				if (!lifetime.current!.signal.aborted) setPending(null);
			}
		},
		[basePath, udid, refresh],
	);

	const shown = settings ?? DEFAULT_SETTINGS;
	const ready = settings !== null && !loading;

	// Slider changes are latest-wins, matching the iOS control. This prevents a
	// slow adb response from applying an older font scale after a newer one.
	const fontScaleQueue = useRef<{ running: boolean; next: number | null }>({
		running: false,
		next: null,
	});
	const settingsRef = useRef(shown);
	settingsRef.current = shown;
	const runRef = useRef(run);
	runRef.current = run;
	const applyFontScale = useCallback((index: number) => {
		const queue = fontScaleQueue.current;
		queue.next = index;
		if (queue.running) return;
		queue.running = true;
		void (async () => {
			while (queue.next !== null && !lifetime.current!.signal.aborted) {
				const nextIndex = queue.next;
				queue.next = null;
				await runRef.current(
					"text-size",
					{ ...settingsRef.current, textSizeIndex: nextIndex },
					{ type: "settings", fontScale: ANDROID_FONT_SCALES[nextIndex]! },
				);
			}
			queue.running = false;
		})();
	}, []);

	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			data-android-simulator-settings=""
			summary={
				<div className="flex min-w-0 items-center gap-2">
					<Smartphone
						size={14}
						strokeWidth={2}
						className="shrink-0 text-white/45"
					/>
					<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
						Simulator
					</span>
				</div>
			}
			bodyClassName="flex flex-col gap-1.5"
		>
			{error && (
				<div className="flex items-center justify-between gap-2 rounded-[8px] bg-danger/10 px-2.5 py-2 text-[11px] text-danger-soft">
					<span className="min-w-0">Android settings unavailable: {error}</span>
					<Button
						variant="plain"
						size="custom"
						type="button"
						onClick={() => void refresh()}
						className="h-8 shrink-0 cursor-pointer rounded-[8px] border border-danger/30 bg-transparent px-2 text-[11px] text-danger-soft"
					>
						Retry
					</Button>
				</div>
			)}

			<SettingRow
				icon={
					<Icon>
						<MoonStar size={14} />
					</Icon>
				}
				label="Appearance"
			>
				<SettingSelect
					label="Appearance"
					value={shown.appearance}
					options={[
						{ value: "light", label: "Light" },
						{ value: "dark", label: "Dark" },
					]}
					disabled={!ready || pending === "appearance"}
					onChange={(value) => {
						const appearance = value === "dark" ? "dark" : "light";
						void run(
							"appearance",
							{ ...shown, appearance },
							{ type: "settings", theme: appearance },
						);
					}}
				/>
			</SettingRow>

			<SettingRow
				icon={
					<Icon>
						<Type size={14} />
					</Icon>
				}
				label="Text Size"
			>
				<TextSizeSlider
					value={shown.textSizeIndex}
					disabled={!ready}
					onChange={applyFontScale}
				/>
			</SettingRow>

			<SettingRow
				icon={
					<Icon>
						<Gauge size={14} />
					</Icon>
				}
				label="Reduce Motion"
			>
				<SettingSwitch
					label="Reduce Motion"
					checked={shown.reduceMotion}
					disabled={!ready || pending === "reduce-motion"}
					onChange={(reduceMotion) => {
						void run(
							"reduce-motion",
							{ ...shown, reduceMotion },
							{ type: "settings", reducedMotion: reduceMotion },
						);
					}}
				/>
			</SettingRow>

			<SettingRow
				icon={
					<Icon>
						<CircleDot size={14} />
					</Icon>
				}
				label="Show Touches"
			>
				<SettingSwitch
					label="Show Touches"
					checked={shown.showTouches}
					disabled={!ready || pending === "show-touches"}
					onChange={(showTouches) =>
						void run(
							"show-touches",
							{ ...shown, showTouches },
							{ type: "settings", showTouches },
						)
					}
				/>
			</SettingRow>

			<SettingRow
				icon={
					<Icon>
						<MousePointerClick size={14} />
					</Icon>
				}
				label="Pointer Location"
			>
				<SettingSwitch
					label="Pointer Location"
					checked={shown.pointerLocation}
					disabled={!ready || pending === "pointer-location"}
					onChange={(pointerLocation) =>
						void run(
							"pointer-location",
							{ ...shown, pointerLocation },
							{ type: "settings", pointerLocation },
						)
					}
				/>
			</SettingRow>
			{children}
		</CollapsibleSection>
	);
}
