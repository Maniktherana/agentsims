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
import {
	execOnHost,
	shellEscape,
	type ExecResult,
} from "../../../simulator/input/exec";
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

function commandValue(result: ExecResult, fallback: string): string {
	if (result.exitCode !== 0) {
		throw new Error(
			result.stderr.trim() || `adb exited with ${result.exitCode}`,
		);
	}
	return result.stdout.trim() || fallback;
}

function Icon({ children }: { children: ReactNode }) {
	return <span className="text-white/82">{children}</span>;
}

export function AndroidSimulatorSettingsTool({ udid }: { udid: string }) {
	const serial = udid.startsWith("android:")
		? udid.slice("android:".length)
		: udid;
	const escapedSerial = shellEscape(serial);
	const [open, setOpen] = useState(true);
	const [settings, setSettings] = useState<AndroidSimulatorSettings | null>(
		null,
	);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const adb = useCallback(
		(args: string, signal?: AbortSignal) =>
			execOnHost(`adb -s ${escapedSerial} ${args}`, { signal }),
		[escapedSerial],
	);

	const refresh = useCallback(
		async (signal?: AbortSignal) => {
			setError(null);
			try {
				const [
					nightMode,
					fontScale,
					animationScale,
					showTouches,
					pointerLocation,
				] = await Promise.all([
					adb("shell cmd uimode night", signal),
					adb("shell settings get system font_scale", signal),
					adb("shell settings get global animator_duration_scale", signal),
					adb("shell settings get system show_touches", signal),
					adb("shell settings get system pointer_location", signal),
				]);
				setSettings(
					parseAndroidSimulatorSettings({
						nightMode: commandValue(nightMode, "Night mode: no"),
						fontScale: commandValue(fontScale, "1"),
						animationScale: commandValue(animationScale, "1"),
						showTouches: commandValue(showTouches, "0"),
						pointerLocation: commandValue(pointerLocation, "0"),
					}),
				);
			} catch (reason) {
				if (reason instanceof DOMException && reason.name === "AbortError")
					return;
				setError(reason instanceof Error ? reason.message : String(reason));
			}
		},
		[adb],
	);

	useEffect(() => {
		const controller = new AbortController();
		setSettings(null);
		void refresh(controller.signal);
		return () => controller.abort();
	}, [refresh]);

	const run = useCallback(
		async (key: string, next: AndroidSimulatorSettings, commands: string[]) => {
			setPending(key);
			setError(null);
			setSettings(next);
			try {
				const results = await Promise.all(
					commands.map((command) => adb(command)),
				);
				for (const result of results) commandValue(result, "");
			} catch (reason) {
				setError(
					reason instanceof Error ? reason.message : `Could not update ${key}`,
				);
				void refresh();
			} finally {
				setPending(null);
			}
		},
		[adb, refresh],
	);

	const shown = settings ?? DEFAULT_SETTINGS;
	const ready = settings !== null;

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
			while (queue.next !== null) {
				const nextIndex = queue.next;
				queue.next = null;
				await runRef.current(
					"text-size",
					{ ...settingsRef.current, textSizeIndex: nextIndex },
					[
						`shell settings put system font_scale ${ANDROID_FONT_SCALES[nextIndex]!}`,
					],
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
				<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">
					Simulator
				</span>
			}
			bodyClassName="flex flex-col gap-1.5"
		>
			{error && (
				<div className="flex items-center justify-between gap-2 rounded-[8px] bg-danger/10 px-2.5 py-2 text-[11px] text-danger-soft">
					<span className="min-w-0">Android settings unavailable: {error}</span>
					<button
						type="button"
						onClick={() => void refresh()}
						className="min-h-8 shrink-0 cursor-pointer rounded-[8px] border border-danger/30 bg-transparent px-2 text-[11px] text-danger-soft"
					>
						Retry
					</button>
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
						void run("appearance", { ...shown, appearance }, [
							`shell cmd uimode night ${appearance === "dark" ? "yes" : "no"}`,
						]);
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
						const scale = reduceMotion ? 0 : 1;
						void run("reduce-motion", { ...shown, reduceMotion }, [
							`shell settings put global window_animation_scale ${scale}`,
							`shell settings put global transition_animation_scale ${scale}`,
							`shell settings put global animator_duration_scale ${scale}`,
						]);
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
						void run("show-touches", { ...shown, showTouches }, [
							`shell settings put system show_touches ${showTouches ? 1 : 0}`,
						])
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
						void run("pointer-location", { ...shown, pointerLocation }, [
							`shell settings put system pointer_location ${pointerLocation ? 1 : 0}`,
						])
					}
				/>
			</SettingRow>
		</CollapsibleSection>
	);
}
