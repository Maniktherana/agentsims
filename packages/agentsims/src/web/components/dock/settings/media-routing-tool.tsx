import { Camera, Mic, RefreshCw, Volume2 } from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import type {
	DeviceMediaState,
	MediaRouteAction,
	MediaSourceChoice,
} from "../../../../server/media/model";
import { uploadFileToTmp } from "../../../media/drop";
import { execOnHost } from "../../../simulator/input/exec";
import { simEndpoint } from "../../../preview/sim-endpoint";
import { CameraTool } from "./camera-tool";
import { CollapsibleSection } from "../../ui/collapsible-section";
import { SettingRow, SettingSelect } from "./simulator-settings-tool";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";

function mediaEndpoint(deviceId: string): string {
	return `${simEndpoint("media")}?device=${encodeURIComponent(deviceId)}`;
}

export function MediaRoutingTool({
	udid,
	bundleId,
}: {
	udid: string;
	bundleId: string | null;
}) {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<DeviceMediaState | null>(null);
	const [loading, setLoading] = useState(false);
	const [pending, setPending] = useState<string | null>(null);
	const [restartRequired, setRestartRequired] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const refreshIdRef = useRef(0);
	const endpoint = useMemo(() => mediaEndpoint(udid), [udid]);

	const refresh = useCallback(
		async (signal?: AbortSignal) => {
			const refreshId = ++refreshIdRef.current;
			setLoading(true);
			setError(null);
			try {
				const response = await fetch(endpoint, { cache: "no-store", signal });
				const body = (await response.json()) as
					| DeviceMediaState
					| { error?: string };
				if (!response.ok)
					throw new Error(
						"error" in body ? body.error : `Media status ${response.status}`,
					);
				if (refreshId === refreshIdRef.current)
					setState(body as DeviceMediaState);
			} catch (reason) {
				if (
					refreshId !== refreshIdRef.current ||
					(reason instanceof DOMException && reason.name === "AbortError")
				)
					return;
				setError(reason instanceof Error ? reason.message : String(reason));
			} finally {
				if (refreshId === refreshIdRef.current) setLoading(false);
			}
		},
		[endpoint],
	);

	useEffect(() => {
		const controller = new AbortController();
		setState(null);
		setRestartRequired(false);
		void refresh(controller.signal);
		return () => controller.abort();
	}, [refresh]);

	useEffect(() => {
		setOpen(false);
	}, [udid]);

	const apply = useCallback(
		async (action: MediaRouteAction, key: string) => {
			setPending(key);
			setError(null);
			try {
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(action),
				});
				const body = (await response.json()) as {
					error?: string;
					apply?: string;
				};
				if (!response.ok)
					throw new Error(body.error ?? `Media update ${response.status}`);
				if (
					body.apply === "device-restart" &&
					action.action !== "restart-device"
				) {
					setRestartRequired(true);
				}
				if (action.action === "restart-device") setRestartRequired(false);
				if (action.action !== "restart-device") await refresh();
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : String(reason));
			} finally {
				setPending(null);
			}
		},
		[endpoint, refresh],
	);

	return (
		<MediaRoutingSection
			udid={udid}
			open={open}
			onOpenChange={setOpen}
			bundleId={bundleId}
			state={state}
			loading={loading}
			pending={pending}
			restartRequired={restartRequired}
			error={error}
			onApply={(action, key) => void apply(action, key)}
		/>
	);
}

export function MediaRoutingSection({
	udid,
	open,
	onOpenChange,
	bundleId,
	state,
	loading,
	pending,
	restartRequired,
	error,
	onApply,
}: {
	udid: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bundleId?: string | null;
	state: DeviceMediaState | null;
	loading: boolean;
	pending: string | null;
	restartRequired: boolean;
	error: string | null;
	onApply: (action: MediaRouteAction, key: string) => void;
}) {
	const expectedAndroidEmulator = /^android:emulator-\d+$/.test(udid);
	const camera = state?.camera;
	const emulator = state?.deviceKind === "emulator";
	const ios =
		state?.platform === "ios" || (!state && !udid.startsWith("android:"));
	const physicalAndroid = state?.deviceKind === "physical";
	const frontChoices = cameraSelectChoices(camera?.frontChoices);
	const backChoices = cameraSelectChoices(camera?.backChoices);
	const inputChoices = actionableChoices(state?.audioInput.choices);
	const outputChoices = actionableChoices(state?.audioOutput.choices);
	const image360Capability =
		camera?.backChoices.find((choice) => choice.id === "image360:") ??
		camera?.frontChoices.find((choice) => choice.id === "image360:");
	const image360Supported = image360Capability
		? image360Capability.apply !== "unsupported"
		: false;
	const showFrontCamera =
		expectedAndroidEmulator &&
		(!state || (emulator && frontChoices.length > 0));
	const showBackCamera =
		expectedAndroidEmulator && (!state || (emulator && backChoices.length > 0));
	const imageInputRef = useRef<HTMLInputElement | null>(null);
	const videoInputRef = useRef<HTMLInputElement | null>(null);
	const image360InputRef = useRef<HTMLInputElement | null>(null);
	const [androidFileFace, setAndroidFileFace] = useState<"front" | "back">(
		"back",
	);
	const [draftFrontCamera, setDraftFrontCamera] = useState("");
	const [draftBackCamera, setDraftBackCamera] = useState("");
	const [audioOpen, setAudioOpen] = useState(false);

	useEffect(() => {
		setDraftFrontCamera(camera?.front ?? "");
		setDraftBackCamera(camera?.back ?? "");
	}, [state?.deviceId, camera?.front, camera?.back]);

	useEffect(() => {
		if (!showBackCamera && showFrontCamera) setAndroidFileFace("front");
		if (!showFrontCamera && showBackCamera) setAndroidFileFace("back");
	}, [showBackCamera, showFrontCamera]);

	const cameraDraftDirty =
		emulator &&
		draftFrontCamera.length > 0 &&
		draftBackCamera.length > 0 &&
		(draftFrontCamera !== (camera?.front ?? "") ||
			draftBackCamera !== (camera?.back ?? ""));

	const setAndroidFileCamera = useCallback(
		async (
			face: "front" | "back",
			kind: "imagefile" | "videofile" | "image360",
			file: File,
		) => {
			const path = await uploadFileToTmp(
				file,
				"agentsims-android-camera",
				file.name.split(".").pop() || "media",
				execOnHost,
			);
			const source = `${kind}:${path}`;
			if (face === "front") setDraftFrontCamera(source);
			else setDraftBackCamera(source);
		},
		[],
	);

	const showCameraSection =
		ios || showFrontCamera || showBackCamera || emulator;

	return (
		<>
			{showCameraSection && (
				<CollapsibleSection
					open={open}
					onOpenChange={onOpenChange}
					summary={
						<div className="flex min-w-0 items-center justify-between gap-3">
							<div className="flex min-w-0 items-center gap-2">
								<Camera
									size={14}
									strokeWidth={2}
									className="shrink-0 text-white/45"
								/>
								<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
									Camera
								</span>
							</div>
							{restartRequired && (
								<span className="shrink-0 text-[10px] font-medium text-amber-200/70">
									Restart required
								</span>
							)}
							{!restartRequired && cameraDraftDirty && (
								<span className="shrink-0 text-[10px] font-medium text-amber-200/70">
									Apply changes
								</span>
							)}
						</div>
					}
					bodyClassName="flex flex-col gap-2.5"
					data-media-routing-section={
						state?.deviceKind ?? (loading ? "loading" : "idle")
					}
					data-media-group="camera"
				>
					{ios && (
						<CameraTool udid={udid} bundleId={bundleId ?? null} embedded />
					)}

					{expectedAndroidEmulator && (
						<>
							<input
								ref={imageInputRef}
								type="file"
								accept="image/*"
								className="hidden"
								onChange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = "";
									if (file)
										void setAndroidFileCamera(
											androidFileFace,
											"imagefile",
											file,
										);
								}}
							/>
							<input
								ref={videoInputRef}
								type="file"
								accept="video/*"
								className="hidden"
								onChange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = "";
									if (file)
										void setAndroidFileCamera(
											androidFileFace,
											"videofile",
											file,
										);
								}}
							/>
							<input
								ref={image360InputRef}
								type="file"
								accept="image/*"
								className="hidden"
								onChange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = "";
									if (file)
										void setAndroidFileCamera(
											androidFileFace,
											"image360",
											file,
										);
								}}
							/>

							<Tabs
								value={androidFileFace}
								onValueChange={(value) =>
									setAndroidFileFace(value === "front" ? "front" : "back")
								}
								className="gap-1"
							>
								<TabsList variant="default" className="w-full">
									{showFrontCamera && (
										<TabsTrigger value="front" className="flex-1">
											Front
										</TabsTrigger>
									)}
									{showBackCamera && (
										<TabsTrigger value="back" className="flex-1">
											Back
										</TabsTrigger>
									)}
								</TabsList>
							</Tabs>

							<RouteSelect
								icon={<Camera size={13} strokeWidth={2} />}
								label="Startup route"
								hint={`${androidFileFace === "front" ? "Front" : "Back"} camera`}
								value={
									androidFileFace === "front"
										? draftFrontCamera
										: draftBackCamera
								}
								choices={
									androidFileFace === "front" ? frontChoices : backChoices
								}
								loading={!state}
								disabled={pending !== null}
								onChange={
									androidFileFace === "front"
										? setDraftFrontCamera
										: setDraftBackCamera
								}
							/>

							<SettingRow
								icon={
									<span className="text-white/82">
										<Camera size={13} />
									</span>
								}
								label="Media file"
								description={`Use for ${androidFileFace} camera`}
							>
								<div className="grid w-[150px] grid-cols-3 gap-1">
									<TinyAction
										label="Image"
										disabled={pending !== null || !emulator}
										onClick={() => imageInputRef.current?.click()}
									/>
									<TinyAction
										label="Video"
										disabled={pending !== null || !emulator}
										onClick={() => videoInputRef.current?.click()}
									/>
									<TinyAction
										label="360"
										disabled={pending !== null || !image360Supported}
										title={
											image360Supported ? undefined : image360Capability?.label
										}
										onClick={() => image360InputRef.current?.click()}
									/>
								</div>
							</SettingRow>

							{cameraDraftDirty && (
								<button
									type="button"
									disabled={pending !== null}
									onClick={() =>
										onApply(
											{
												action: "android-camera-sources",
												front: draftFrontCamera,
												back: draftBackCamera,
											},
											"android-camera",
										)
									}
									className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.09] px-2 text-[11px] font-semibold text-white/82 [transition:background,scale] duration-150 hover:bg-white/[0.13] active:scale-[0.98] disabled:opacity-50"
								>
									Apply camera changes
								</button>
							)}
						</>
					)}

					{restartRequired && (
						<button
							type="button"
							disabled={pending !== null}
							onClick={() => onApply({ action: "restart-device" }, "restart")}
							className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-accent px-2 text-[11px] font-semibold text-white [transition:filter,scale] duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
						>
							<RefreshCw
								size={13}
								strokeWidth={2.2}
								className={pending === "restart" ? "animate-spin" : undefined}
							/>
							Restart emulator
						</button>
					)}

					{error && <MediaError message={error} />}
				</CollapsibleSection>
			)}

			<CollapsibleSection
				open={audioOpen}
				onOpenChange={setAudioOpen}
				summary={
					<div className="flex min-w-0 items-center gap-2">
						<Volume2
							size={14}
							strokeWidth={2}
							className="shrink-0 text-white/45"
						/>
						<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
							Audio
						</span>
					</div>
				}
				bodyClassName="flex flex-col gap-1.5"
				data-media-group="audio"
			>
				<MediaRouteRow
					icon={<Mic size={13} strokeWidth={2} />}
					label="Microphone"
					value={audioInputLabel(state)}
					hint={audioPreferenceHint(state?.audioInput)}
					control={
						state && inputChoices.length > 0 ? (
							<SettingSelect
								label="Mac input"
								value={state.audioInput.currentDeviceId ?? ""}
								options={inputChoices.map((choice) => ({
									value: choice.id,
									label: choice.label,
								}))}
								disabled={pending !== null}
								onChange={(deviceId) =>
									onApply(
										{ action: "host-audio-input", deviceId },
										"microphone",
									)
								}
							/>
						) : expectedAndroidEmulator && !state ? (
							<ControlPlaceholder />
						) : undefined
					}
				/>
				{state?.audioInput.scope === "host-global" && (
					<MicrophoneTestRow
						active={audioOpen}
						deviceKey={`${state.deviceId}:${state.audioInput.currentDeviceId ?? "default"}`}
						disabled={
							pending !== null || state.audioInput.current === "disabled"
						}
					/>
				)}
				<MediaRouteRow
					icon={<Volume2 size={13} strokeWidth={2} />}
					label="Output"
					value={audioOutputLabel(state)}
					hint={audioPreferenceHint(state?.audioOutput)}
					control={
						state && outputChoices.length > 0 ? (
							<SettingSelect
								label="Mac output"
								value={state.audioOutput.currentDeviceId ?? ""}
								options={outputChoices.map((choice) => ({
									value: choice.id,
									label: choice.label,
								}))}
								disabled={pending !== null}
								onChange={(deviceId) =>
									onApply({ action: "host-audio-output", deviceId }, "output")
								}
							/>
						) : undefined
					}
				/>
				{state?.platform === "android" && state.audioOutput.volumeLevel ? (
					<OutputVolumeRow
						label="Simulator volume"
						ariaLabel="Simulator volume"
						value={state.audioOutput.volumeLevel.current}
						min={state.audioOutput.volumeLevel.min}
						max={state.audioOutput.volumeLevel.max}
						step={1}
						ticks
						formatValue={(value) =>
							`${Math.round(value)} / ${state.audioOutput.volumeLevel!.max}`
						}
						disabled={
							pending !== null || state.audioOutput.volumeSettable !== true
						}
						onChange={(level) =>
							onApply(
								{ action: "android-output-volume", level },
								"output-volume",
							)
						}
					/>
				) : null}
				{physicalAndroid && (
					<div className="rounded-[8px] bg-white/[0.035] px-2.5 py-2 text-[10px] leading-[1.4] text-white/42">
						Physical Android audio is device-owned. Agentsims mirrors the device
						but cannot replace its hardware route.
					</div>
				)}
				{error && !showCameraSection && <MediaError message={error} />}
			</CollapsibleSection>
		</>
	);
}

function MediaError({ message }: { message: string }) {
	return (
		<div
			role="alert"
			className="rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[11px] font-medium text-red-200/85"
		>
			Media controls unavailable: {message}
		</div>
	);
}

function actionableChoices(
	choices: MediaSourceChoice[] | undefined,
): MediaSourceChoice[] {
	return choices?.filter((choice) => choice.apply !== "unsupported") ?? [];
}

function cameraSelectChoices(
	choices: MediaSourceChoice[] | undefined,
): MediaSourceChoice[] {
	return actionableChoices(choices).filter(
		(choice) => !choice.id.endsWith(":"),
	);
}

function audioInputLabel(state: DeviceMediaState | null): string {
	if (!state) return "Loading";
	if (state.audioInput.currentDeviceLabel)
		return state.audioInput.currentDeviceLabel;
	if (state.audioInput.current === "host") return "Mac system input";
	if (state.audioInput.current === "disabled") return "Disabled";
	if (state.audioInput.current === "device") return "Android device";
	if (state.audioInput.current === "system-default") return "Mac system input";
	return "Not selected";
}

function audioOutputLabel(state: DeviceMediaState | null): string {
	if (!state) return "Loading";
	if (state.audioOutput.currentDeviceLabel)
		return state.audioOutput.currentDeviceLabel;
	return state.audioOutput.current === "device"
		? "Android device"
		: "Mac system output";
}

function audioPreferenceHint(
	route:
		| {
				scope?: "host-global" | "device";
				preferredDeviceId?: string;
				preferredDeviceLabel?: string;
		  }
		| undefined,
): string | undefined {
	if (!route) return undefined;
	const preference = route.preferredDeviceId
		? `Saved: ${route.preferredDeviceLabel}`
		: undefined;
	return preference;
}

function OutputVolumeRow({
	label,
	ariaLabel = "Output volume",
	value,
	min = 0,
	max = 1,
	step = 0.01,
	ticks = false,
	formatValue,
	disabled,
	onChange,
}: {
	label: string;
	ariaLabel?: string;
	value?: number;
	min?: number;
	max?: number;
	step?: number;
	ticks?: boolean;
	formatValue?: (value: number) => string;
	disabled: boolean;
	onChange: (value: number) => void;
}) {
	const clamp = useCallback(
		(next: number) => Math.max(min, Math.min(max, next)),
		[max, min],
	);
	const initial = clamp(value ?? max);
	const [draft, setDraft] = useState(initial);
	const draftRef = useRef(initial);
	const draggingRef = useRef(false);
	const lastSentRef = useRef(initial);

	useEffect(() => {
		if (draggingRef.current) return;
		const next = clamp(value ?? max);
		draftRef.current = next;
		lastSentRef.current = next;
		setDraft(next);
	}, [clamp, max, value]);

	const flush = useCallback(() => {
		draggingRef.current = false;
		if (disabled || Math.abs(draftRef.current - lastSentRef.current) < step / 2)
			return;
		lastSentRef.current = draftRef.current;
		onChange(draftRef.current);
	}, [disabled, onChange, step]);

	const fill = `${Math.round(((draft - min) / Math.max(1, max - min)) * 100)}%`;
	const sliderStyle = {
		"--slider-fill": fill,
		"--slider-fill-color": disabled
			? "rgba(255,255,255,0.3)"
			: "var(--agentsims-accent)",
	} as CSSProperties;

	return (
		<SettingRow
			icon={
				<span className="text-white/82">
					<Volume2 size={13} strokeWidth={2} />
				</span>
			}
			label={label}
			description={
				value === undefined ? "Unavailable" : (formatValue?.(draft) ?? fill)
			}
		>
			<span className="flex w-[120px] min-w-0 flex-col">
				<input
					type="range"
					aria-label={ariaLabel}
					min={min}
					max={max}
					step={step}
					value={draft}
					disabled={disabled}
					onPointerDown={() => {
						draggingRef.current = true;
					}}
					onChange={(event) => {
						const next = clamp(Number(event.currentTarget.value));
						draftRef.current = next;
						setDraft(next);
					}}
					onPointerUp={flush}
					onPointerCancel={flush}
					onKeyUp={flush}
					onBlur={flush}
					style={sliderStyle}
					className="h-[13px] w-full appearance-none rounded-full bg-transparent outline-none focus-visible:[outline:1.5px_solid_var(--agentsims-accent)] focus-visible:outline-offset-4 disabled:cursor-default [&::-webkit-slider-runnable-track]:h-[4px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:linear-gradient(to_right,var(--slider-fill-color)_var(--slider-fill),rgba(255,255,255,0.22)_var(--slider-fill))] [&::-webkit-slider-thumb]:-mt-[4.5px] [&::-webkit-slider-thumb]:size-[13px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.45)] [&:disabled::-webkit-slider-thumb]:bg-white/50 [&::-moz-range-progress]:h-[4px] [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-[var(--slider-fill-color)] [&::-moz-range-thumb]:size-[13px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-[4px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/20"
				/>
				{ticks && max - min <= 31 && (
					<span
						aria-hidden
						className="pointer-events-none mt-[3px] flex justify-between px-[5.5px]"
					>
						{Array.from({ length: max - min + 1 }, (_, index) => (
							<span
								key={index}
								className="size-[2px] rounded-full bg-white/40"
							/>
						))}
					</span>
				)}
			</span>
		</SettingRow>
	);
}

function MicrophoneTestRow({
	active,
	deviceKey,
	disabled,
}: {
	active: boolean;
	deviceKey: string;
	disabled: boolean;
}) {
	const [testing, setTesting] = useState(false);
	const [starting, setStarting] = useState(false);
	const [level, setLevel] = useState(0);
	const [testError, setTestError] = useState<string | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const contextRef = useRef<AudioContext | null>(null);
	const animationRef = useRef<number | null>(null);
	const requestRef = useRef(0);

	const release = useCallback(() => {
		requestRef.current += 1;
		if (animationRef.current !== null)
			cancelAnimationFrame(animationRef.current);
		animationRef.current = null;
		streamRef.current?.getTracks().forEach((track) => track.stop());
		streamRef.current = null;
		if (contextRef.current) void contextRef.current.close();
		contextRef.current = null;
	}, []);

	const stop = useCallback(() => {
		release();
		setTesting(false);
		setStarting(false);
		setLevel(0);
	}, [release]);

	useEffect(() => {
		if (!active || disabled) stop();
	}, [active, disabled, stop]);

	useEffect(() => stop(), [deviceKey, stop]);

	useEffect(() => release, [release]);

	const start = useCallback(async () => {
		stop();
		setTestError(null);
		if (!navigator.mediaDevices?.getUserMedia) {
			setTestError("Microphone testing is unavailable in this browser");
			return;
		}

		const request = requestRef.current;
		setStarting(true);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					autoGainControl: false,
					echoCancellation: false,
					noiseSuppression: false,
				},
				video: false,
			});
			if (request !== requestRef.current) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}

			const context = new AudioContext();
			const analyser = context.createAnalyser();
			analyser.fftSize = 512;
			analyser.smoothingTimeConstant = 0.6;
			context.createMediaStreamSource(stream).connect(analyser);
			await context.resume();
			streamRef.current = stream;
			contextRef.current = context;
			setStarting(false);
			setTesting(true);

			const samples = new Float32Array(analyser.fftSize);
			let smoothed = 0;
			let lastUpdate = 0;
			const sample = (timestamp: number) => {
				if (request !== requestRef.current) return;
				analyser.getFloatTimeDomainData(samples);
				let energy = 0;
				for (const value of samples) energy += value * value;
				const rms = Math.sqrt(energy / samples.length);
				smoothed = Math.max(rms * 4, smoothed * 0.72);
				if (timestamp - lastUpdate >= 50) {
					setLevel(Math.min(1, smoothed));
					lastUpdate = timestamp;
				}
				animationRef.current = requestAnimationFrame(sample);
			};
			animationRef.current = requestAnimationFrame(sample);
		} catch (reason) {
			if (request !== requestRef.current) return;
			setStarting(false);
			setTesting(false);
			setTestError(
				reason instanceof Error ? reason.message : "Microphone access failed",
			);
		}
	}, [stop]);

	return (
		<SettingRow
			icon={
				<span className="text-white/82">
					<Mic size={13} strokeWidth={2} />
				</span>
			}
			label="Test microphone"
			description={testError ?? (testing ? "Listening" : "Live input level")}
			descriptionTitle={testError ?? undefined}
		>
			<div className="flex w-[150px] items-center justify-end gap-2">
				<span
					role="meter"
					aria-label="Microphone input level"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(level * 100)}
					className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/12"
				>
					<span
						className="block h-full origin-left rounded-full bg-emerald-400 transition-transform duration-75 motion-reduce:transition-none"
						style={{ transform: `scaleX(${level})` }}
					/>
				</span>
				<button
					type="button"
					aria-pressed={testing}
					disabled={disabled || starting}
					onClick={
						testing
							? stop
							: () => {
									void start();
								}
					}
					className="h-8 shrink-0 rounded-[7px] bg-white/[0.07] px-2 text-[10px] font-semibold text-white/78 transition-[background-color,transform] duration-100 hover:bg-white/[0.11] active:scale-[0.96] disabled:opacity-45"
				>
					{starting ? "Starting" : testing ? "Stop" : "Test"}
				</button>
			</div>
		</SettingRow>
	);
}

function TinyAction({
	label,
	disabled,
	title,
	onClick,
}: {
	label: string;
	disabled: boolean;
	title?: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			title={title}
			onClick={onClick}
			className="flex h-6 items-center justify-center rounded-[6px] border-0 bg-white/[0.055] px-1 text-[10px] font-medium text-white/70 hover:bg-white/[0.09] hover:text-white/90 disabled:opacity-40"
		>
			{label}
		</button>
	);
}

function RouteSelect({
	icon,
	label,
	hint,
	value,
	choices,
	loading,
	disabled,
	onChange,
}: {
	icon: ReactNode;
	label: string;
	hint: string;
	value: string;
	choices: MediaSourceChoice[];
	loading: boolean;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const options = choices.map((choice) => ({
		value: choice.id,
		label: choice.label,
	}));

	return (
		<MediaRouteRow
			icon={icon}
			label={label}
			hint={hint}
			value={value}
			control={
				loading ? (
					<ControlPlaceholder />
				) : (
					<SettingSelect
						label={label}
						value={value}
						options={options}
						disabled={disabled}
						onChange={onChange}
					/>
				)
			}
		/>
	);
}

function ControlPlaceholder() {
	return (
		<span
			className="h-6 w-[150px] max-w-full animate-pulse rounded-[8px] bg-white/[0.055] motion-reduce:animate-none"
			aria-hidden="true"
		/>
	);
}

function MediaRouteRow({
	icon,
	label,
	value,
	hint,
	control,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	hint?: string;
	control?: ReactNode;
}) {
	const description = control ? hint : value;

	return (
		<SettingRow
			icon={<span className="text-white/82">{icon}</span>}
			label={label}
			labelClassName="font-medium"
			description={description}
			descriptionTitle={description}
			className="min-h-9"
		>
			{control}
		</SettingRow>
	);
}
