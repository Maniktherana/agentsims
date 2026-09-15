import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "../ui/toast";
import { useSettingsRefresh } from "../dock/settings/settings-refresh";
import { Package, ScrollText } from "lucide-react";
import type { AndroidInstalledApp } from "../../../core/android/contracts";
import {
	androidToolsRequest,
	runAndroidTool,
} from "../../android/tools-client";
import { CollapsibleSection } from "../ui/collapsible-section";
import { SettingSwitch } from "../ui/setting-switch";
import { AndroidLogsPanel } from "./android-logs-panel";
import { ToolField, ToolSection } from "./tool-fields";

type Props = { deviceId: string; basePath: string; active?: boolean };
export function AndroidToolsPanel(props: Props) {
	return (
		<>
			<AppTools key={`${props.deviceId}:apps`} {...props} />
			<LogSettings key={`${props.deviceId}:logs`} {...props} />
		</>
	);
}

function AppTools({ deviceId, basePath, active = true }: Props) {
	const [open, setOpen] = useState(false);
	const [apps, setApps] = useState<AndroidInstalledApp[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState("");
	const [query, setQuery] = useState("");
	const [system, setSystem] = useState(false);
	const [apk, setApk] = useState<File | null>(null);
	const [link, setLink] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<"clear" | "uninstall" | null>(null);
	const pending = useRef<AbortController | null>(null);
	const listing = useRef<AbortController | null>(null);
	const fileInput = useRef<HTMLInputElement | null>(null);
	const refresh = useCallback(async () => {
		listing.current?.abort();
		const controller = new AbortController();
		listing.current = controller;
		setError(null);
		try {
			const result = await runAndroidTool<{ apps: AndroidInstalledApp[] }>(
				basePath,
				deviceId,
				{ type: "apps" },
				controller.signal,
			);
			if (!controller.signal.aborted) {
				setApps(result.apps);
				setSelected((current) =>
					result.apps.some((app) => app.package === current) ? current : "",
				);
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [basePath, deviceId]);
	useSettingsRefresh(() => (active && open ? refresh() : undefined));
	useEffect(() => {
		if (!active || !open) return;
		void refresh();
		const focus = () => {
			if (!pending.current) void refresh();
		};
		window.addEventListener("focus", focus);
		return () => {
			listing.current?.abort();
			window.removeEventListener("focus", focus);
		};
	}, [active, open, refresh]);
	useEffect(
		() => () => {
			listing.current?.abort();
			pending.current?.abort();
		},
		[],
	);
	const task = async (
		label: string,
		success: string,
		operation: (signal: AbortSignal) => Promise<unknown>,
		reload = false,
		description?: string,
	) => {
		if (pending.current) return;
		listing.current?.abort();
		const controller = new AbortController();
		pending.current = controller;
		setBusy(label);
		setConfirm(null);
		try {
			await operation(controller.signal);
			if (controller.signal.aborted) return;
			notify("success", success, { description });
			if (reload) await refresh();
		} catch (cause) {
			if (!controller.signal.aborted)
				notify("error", `${label} failed`, {
					description: cause instanceof Error ? cause.message : String(cause),
				});
		} finally {
			if (pending.current === controller) {
				pending.current = null;
				if (!controller.signal.aborted) setBusy(null);
			}
		}
	};
	const runApp = (operation: "launch" | "stop" | "clear" | "uninstall") => {
		const labels = {
			launch: ["Launch app", "App launched"],
			stop: ["Force stop app", "App stopped"],
			clear: ["Clear app data", "App data cleared"],
			uninstall: ["Uninstall app", "App uninstalled"],
		} as const;
		const [label, success] = labels[operation];
		void task(
			label,
			success,
			(signal) =>
				runAndroidTool(
					basePath,
					deviceId,
					{ type: "app", operation, package: selected },
					signal,
				),
			operation === "uninstall",
			selected,
		);
	};
	const visible = apps?.filter(
		(app) =>
			(system || !app.system) &&
			app.package.toLowerCase().includes(query.toLowerCase()),
	);
	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			summary={
				<span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
					<Package size={14} />
					Install &amp; manage apps
				</span>
			}
		>
			<ToolSection title="Installed apps">
				<div className="flex gap-2">
					<Input
						aria-label="Search installed apps"
						placeholder="Search apps"
						className="flex-1"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<Button
						disabled={!!busy}
						onClick={() => void refresh()}
					>
						Refresh
					</Button>
				</div>
				<div className="flex items-center justify-between text-xs text-white/65">
					<span>Include system apps</span>
					<SettingSwitch
						label="Include system apps"
						checked={system}
						onChange={setSystem}
					/>
				</div>
				{error ? (
					<p role="alert" className="text-xs text-danger-soft">
						Could not load apps. {error}
					</p>
				) : !apps ? (
					<p role="status" className="text-xs text-white/55">
						Loading installed apps
					</p>
				) : !visible?.length ? (
					<p className="text-xs text-white/55">
						{query
							? "No apps match your search."
							: "No user apps installed. Install an APK or include system apps."}
					</p>
				) : (
					<ul
						aria-label="Installed apps"
						className="max-h-44 space-y-1 overflow-y-auto"
					>
						{visible.map((app) => (
							<li key={app.package}>
								<button
									className={`w-full cursor-pointer rounded-[8px] border px-2.5 py-2 text-left text-xs ${selected === app.package ? "border-accent/50 bg-accent/10 text-accent" : "border-white/8 text-white/75 hover:bg-white/5"}`}
									aria-pressed={selected === app.package}
									disabled={!!busy}
									onClick={() => {
										setSelected(app.package);
										setConfirm(null);
									}}
								>
									<span className="block truncate">{app.package}</span>
									{app.system && (
										<span className="text-[10px] text-white/45">
											System app
										</span>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
				{selected && (
					<div className="space-y-2 border-t border-white/8 pt-2">
						<div className="flex items-start justify-between gap-2">
							<p className="break-all text-xs text-white/75">{selected}</p>
							<Button
								disabled={!!busy}
								onClick={() => {
									setSelected("");
									setConfirm(null);
								}}
							>
								Deselect
							</Button>
						</div>
						<div className="flex flex-wrap gap-2">
							{(
								[
									["launch", "Launch"],
									["stop", "Force stop"],
									["clear", "Clear data"],
									["uninstall", "Uninstall"],
								] as const
							).map(([operation, label]) => (
								<Button
									key={operation}
									disabled={!!busy}
									onClick={() =>
										operation === "clear" || operation === "uninstall"
											? setConfirm(operation)
											: runApp(operation)
									}
								>
									{label}
								</Button>
							))}
						</div>
						{confirm && (
							<div
								role="group"
								aria-label="Confirm app action"
								className="space-y-2 rounded-[8px] border border-danger/25 p-2 text-xs"
							>
								<p>
									{confirm === "clear"
										? "This removes the selected app’s saved data."
										: "This removes the selected app and its saved data."}
								</p>
								<div className="flex gap-2">
									<Button
										onClick={() => runApp(confirm)}
									>
										{confirm === "clear" ? "Clear app data" : "Uninstall app"}
									</Button>
									<Button
										onClick={() => setConfirm(null)}
									>
										Cancel
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
			</ToolSection>
			<ToolSection title="Install an APK">
				<ToolField label="APK file">
					<Input
						ref={fileInput}
						type="file"
						accept=".apk,application/vnd.android.package-archive"
						disabled={!!busy}
						onChange={(event) => setApk(event.target.files?.[0] ?? null)}
					/>
				</ToolField>
				<Button
					disabled={!apk || !!busy}
					onClick={() => {
						if (!apk) return;
						void task(
							"Install APK",
							`${apk.name} installed`,
							async (signal) => {
								await androidToolsRequest(basePath, deviceId, "install", {
									method: "POST",
									body: apk,
									headers: {
										"Content-Type": "application/vnd.android.package-archive",
									},
									signal,
								});
								if (!signal.aborted) {
									setApk(null);
									if (fileInput.current) fileInput.current.value = "";
								}
							},
							true,
						);
					}}
				>
					Install APK
				</Button>
			</ToolSection>
			<ToolSection title="Open a link">
				<form
					className="flex items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void task("Open link", "Link opened", (signal) =>
							runAndroidTool(
								basePath,
								deviceId,
								{
									type: "link",
									url: link,
									...(selected ? { package: selected } : {}),
								},
								signal,
							),
						);
					}}
				>
					<ToolField label="Link">
						<Input
							value={link}
							onChange={(event) => setLink(event.target.value)}
							placeholder="myapp://screen"
							required
						/>
					</ToolField>
					<Button type="submit" disabled={!!busy}>
						Open link
					</Button>
				</form>
				<p className="text-xs text-white/50">
					{selected
						? `Opens in ${selected}.`
						: "Android chooses an app for this link."}
				</p>
			</ToolSection>
			{busy && (
				<div
					role="status"
					className="flex items-center gap-2 text-xs text-white/60"
				>
					{busy}
					<Button
						onClick={() => {
							pending.current?.abort();
							pending.current = null;
							setBusy(null);
						}}
					>
						Cancel
					</Button>
				</div>
			)}
		</CollapsibleSection>
	);
}

function LogSettings({
	deviceId,
	basePath,
	active = true,
}: {
	deviceId: string;
	basePath: string;
	active?: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			summary={
				<span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
					<ScrollText size={14} />
					Logs
				</span>
			}
		>
			{open && active && (
				<div className="flex h-[min(420px,55dvh)] min-h-40 min-w-0">
					<AndroidLogsPanel deviceId={deviceId} basePath={basePath} />
				</div>
			)}
		</CollapsibleSection>
	);
}
