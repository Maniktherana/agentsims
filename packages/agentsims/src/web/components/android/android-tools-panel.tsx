import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { TextMorph } from "torph/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@agentsims/ui/components/alert-dialog";
import { Button } from "@agentsims/ui/components/button";
import { Input } from "@agentsims/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@agentsims/ui/components/select";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { notify } from "../ui/toast";
import { useSettingsRefresh } from "../dock/settings/settings-refresh";
import { Package, ScrollText } from "lucide-react";
import type { AndroidInstalledApp } from "../../../core/android/contracts";
import {
	androidToolsRequest,
	runAndroidTool,
} from "../../android/tools-client";
import { CollapsibleSection } from "../ui/collapsible-section";
import { CompactDisclosure } from "../ui/compact-disclosure";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@agentsims/ui/components/dropdown-menu";
import { Switch } from "@agentsims/ui/components/switch";
import {
	AppIcon,
	fallbackAppDisplayName,
} from "../dock/settings/app-detection-tool";
import { fetchAppDetails, type AppDetails } from "../../media/app-icon";
import { AndroidLogsPanel } from "./android-logs-panel";
import { ToolField, ToolSection } from "./tool-fields";

const APP_ACTIONS = {
	launch: {
		label: "Launch",
		pending: "Launching",
		task: "Launch app",
		success: "App launched",
	},
	stop: {
		label: "Force stop",
		pending: "Stopping",
		task: "Force stop app",
		success: "App stopped",
	},
	clear: {
		label: "Clear data",
		pending: "Clearing",
		task: "Clear app data",
		success: "App data cleared",
	},
	uninstall: {
		label: "Uninstall",
		pending: "Uninstalling",
		task: "Uninstall app",
		success: "App uninstalled",
	},
} as const;

type AppOperation = keyof typeof APP_ACTIONS;

type Props = {
	deviceId: string;
	basePath: string;
	packageName?: string | null;
	active?: boolean;
};
export function AndroidToolsPanel(props: Props) {
	return (
		<>
			<AppTools key={`${props.deviceId}:apps`} {...props} />
			<LogSettings
				key={`${props.deviceId}:logs:${props.packageName ?? "device"}`}
				{...props}
			/>
		</>
	);
}

function AppTools({ deviceId, basePath, active = true }: Props) {
	const [open, setOpen] = useState(false);
	const [apps, setApps] = useState<AndroidInstalledApp[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [linkPackage, setLinkPackage] = useState("");
	const [query, setQuery] = useState("");
	const [system, setSystem] = useState(false);
	const [apk, setApk] = useState<File | null>(null);
	const [link, setLink] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [busyPackage, setBusyPackage] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<{
		operation: "clear" | "uninstall";
		packageName: string;
		displayName: string;
	} | null>(null);
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
				setLinkPackage((current) =>
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
				if (!controller.signal.aborted) {
					setBusy(null);
					setBusyPackage(null);
				}
			}
		}
	};
	const runApp = async (operation: AppOperation, packageName: string) => {
		if (pending.current) return;
		const copy = APP_ACTIONS[operation];
		setBusyPackage(packageName);
		return task(
			copy.task,
			copy.success,
			(signal) =>
				runAndroidTool(
					basePath,
					deviceId,
					{ type: "app", operation, package: packageName },
					signal,
				),
			operation === "uninstall",
			packageName,
		);
	};
	const visible = apps?.filter(
		(app) =>
			(system || !app.system) &&
			app.package.toLowerCase().includes(query.toLowerCase()),
	);
	const pendingAppLabel = Object.values(APP_ACTIONS).find(
		(action) => action.task === busy,
	)?.pending;
	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			bodyClassName="flex flex-col gap-0"
			summary={
				<span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">
					<Package size={14} />
					Install &amp; manage apps
				</span>
			}
		>
			<ToolSection title="Installed apps" divided={false}>
				<div className="flex gap-2">
					<Input
						aria-label="Search installed apps"
						placeholder="Search apps"
						className="flex-1"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<Button
						variant="flat"
						disabled={!!busy}
						onClick={() => void refresh()}
					>
						Refresh
					</Button>
				</div>
				<div className="flex h-8 items-center justify-between gap-3 px-0.5">
					<span className="min-w-0 text-[13px] text-white/75">
						Include system apps
					</span>
					<Switch
						aria-label="Include system apps"
						checked={system}
						onCheckedChange={setSystem}
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
						className="scroll-fade-y scroll-fade-6 max-h-[min(420px,50dvh)] space-y-1 overflow-y-auto"
					>
						{visible.map((app) => (
							<li key={app.package}>
								<InstalledAppRow
									deviceId={deviceId}
									app={app}
									disabled={!!busy}
									pendingLabel={
										busyPackage === app.package ? pendingAppLabel : undefined
									}
									onAction={(operation, displayName) => {
										if (operation === "clear" || operation === "uninstall") {
											setConfirm({
												operation,
												packageName: app.package,
												displayName,
											});
											return;
										}
										runApp(operation, app.package);
									}}
								/>
							</li>
						))}
					</ul>
				)}
			</ToolSection>
			<ToolDisclosure title="Install an APK">
				<input
					ref={fileInput}
					type="file"
					accept=".apk,application/vnd.android.package-archive"
					disabled={!!busy}
					className="sr-only"
					aria-label="APK file"
					onChange={(event) => setApk(event.target.files?.[0] ?? null)}
				/>
				<div className="flex items-center gap-2">
					<Button
						variant="raised"
						disabled={!!busy}
						onClick={() => fileInput.current?.click()}
					>
						Choose APK
					</Button>
					<span className="min-w-0 flex-1 truncate text-[12px] text-white/55">
						{apk?.name ?? "No file selected"}
					</span>
					<Button
						variant="raised"
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
						<TextMorph>
							{busy === "Install APK" ? "Installing" : "Install"}
						</TextMorph>
					</Button>
				</div>
			</ToolDisclosure>
			<ToolDisclosure title="Open a link">
				<ToolField label="Open with">
					<Select
						value={linkPackage}
						onValueChange={(next) => {
							if (next !== null) setLinkPackage(next);
						}}
					>
						<SelectTrigger aria-label="App for link" className="w-full">
							<SelectValue>{linkPackage || "System default"}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">System default</SelectItem>
							{(apps ?? []).map((app) => (
								<SelectItem key={app.package} value={app.package}>
									{app.package}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</ToolField>
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
									...(linkPackage ? { package: linkPackage } : {}),
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
					<Button variant="flat" type="submit" disabled={!!busy}>
						<TextMorph>
							{busy === "Open link" ? "Opening" : "Open link"}
						</TextMorph>
					</Button>
				</form>
				<p className="text-xs text-white/50">
					{linkPackage
						? `Android opens this link in ${linkPackage}.`
						: "Android chooses an app for this link."}
				</p>
			</ToolDisclosure>
			<AlertDialog
				open={confirm !== null}
				onOpenChange={(nextOpen) => {
					if (!nextOpen && !busy) setConfirm(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirm?.operation === "clear"
								? `Clear ${confirm.displayName} data?`
								: `Uninstall ${confirm?.displayName ?? "app"}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirm?.operation === "clear"
								? "This permanently removes the app’s saved data."
								: "This removes the app and its saved data from the device."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={!confirm || !!busy}
							onClick={() => {
								if (!confirm) return;
								const current = confirm;
								void runApp(current.operation, current.packageName).then(() =>
									setConfirm(null),
								);
							}}
						>
							{confirm?.operation === "clear" ? "Clear data" : "Uninstall"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</CollapsibleSection>
	);
}

function InstalledAppRow({
	deviceId,
	app,
	disabled,
	pendingLabel,
	onAction,
}: {
	deviceId: string;
	app: AndroidInstalledApp;
	disabled: boolean;
	pendingLabel?: string;
	onAction: (operation: AppOperation, displayName: string) => void;
}) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [details, setDetails] = useState<Partial<AppDetails> | null>(null);
	useEffect(() => {
		const host = hostRef.current;
		if (!host || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			void fetchAppDetails(deviceId, app.package).then(setDetails);
		});
		observer.observe(host);
		return () => observer.disconnect();
	}, [app.package, deviceId]);
	const name = details?.displayName || fallbackAppDisplayName(app.package);
	return (
		<div
			ref={hostRef}
			className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[8px] bg-[var(--agentsims-button-raised)] p-1.5 text-start shadow-[var(--agentsims-button-raised-shadow)]"
		>
			<div className="shrink-0 [&>img]:size-8 [&>[data-testid]]:size-8">
				<AppIcon
					bundleId={app.package}
					iconDataUrl={details?.iconDataUrl}
					platform="android"
				/>
			</div>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="block truncate text-[13px] leading-4 text-white/90">
					{name}
				</span>
				{(name !== app.package || app.system) && (
					<span className="block truncate text-[11px] leading-[14px] text-white/45">
						{name !== app.package ? app.package : "System app"}
					</span>
				)}
			</span>
			{pendingLabel ? (
				<span className="shrink-0 text-[12px] text-white/55">
					<TextMorph>{pendingLabel}</TextMorph>
				</span>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="quiet"
								size="icon-sm"
								aria-label={`Actions for ${name}`}
								disabled={disabled}
							/>
						}
					>
						<HugeiconsIcon
							icon={MoreVerticalIcon}
							strokeWidth={2}
							className="size-4"
						/>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem onClick={() => onAction("launch", name)}>
							Launch
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onAction("stop", name)}>
							Force stop
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => onAction("clear", name)}>
							Clear data
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							onClick={() => onAction("uninstall", name)}
						>
							Uninstall
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}

function ToolDisclosure({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<CompactDisclosure
			open={open}
			onOpenChange={setOpen}
			title={title}
			contentClassName="space-y-2"
		>
			{children}
		</CompactDisclosure>
	);
}

function LogSettings({
	deviceId,
	basePath,
	packageName,
	active = true,
}: Props) {
	const [open, setOpen] = useState(false);
	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			bodyClassName="-mx-3 -mb-3 flex min-h-0 flex-col"
			summary={
				<span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">
					<ScrollText size={14} />
					Logs
				</span>
			}
		>
			{open && active && (
				<div className="flex h-[min(520px,65dvh)] min-h-56 min-w-0">
					<AndroidLogsPanel
						deviceId={deviceId}
						basePath={basePath}
						packageName={packageName}
					/>
				</div>
			)}
		</CollapsibleSection>
	);
}
