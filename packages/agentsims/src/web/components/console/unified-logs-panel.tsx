import { Button, type ButtonProps } from "@agentsims/ui/components/button";
import { Input } from "@agentsims/ui/components/input";
import { PanelToolbar } from "@agentsims/ui/components/panel-toolbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agentsims/ui/components/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@agentsims/ui/components/dropdown-menu";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@agentsims/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@agentsims/ui/components/tooltip";
import { ArrowDown01Icon, Copy01Icon, Delete02Icon, Download01Icon, FilterHorizontalIcon, Layers01Icon, PauseIcon, PlayIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { TextMorph } from "torph/react";
import type { LogRecord, LogSource } from "../../../core/tools/logs/contracts";
import { CONSOLE_LEVELS, CONSOLE_SOURCES, copyRecords, type ConsoleDevice, type ConsoleSession, type ConsoleScope } from "../../console/state";
import { consoleEmptyMessage, consoleHistoryNote } from "../../console/availability";
import { consoleKindSources, consoleSetKind, type ConsoleLogKind } from "../../console/kinds";
import { downloadLogs } from "../../console/export";
import { useUnifiedLogs } from "../../hooks/console/use-unified-logs";
import { useConsoleViewport } from "../../hooks/console/use-console-viewport";
import { CompactDisclosure } from "../ui/compact-disclosure";
import { notify } from "../ui/toast";
import { consoleStyles } from "./console-variants";
import { LogRow } from "./log-row";

export type { ConsoleDevice, ConsoleScope } from "../../console/state";
export type UnifiedLogsPanelProps = {
	selectedDevice: ConsoleDevice | null;
	devices: readonly ConsoleDevice[];
	onDeviceChange: (deviceId: string) => void;
	active?: boolean;
	basePath?: string;
	onSelectionChange?: (records: readonly LogRecord[]) => void;
	scope?: ConsoleScope;
	onScopeChange?: (scope: ConsoleScope) => void;
};
const EMPTY_RECORDS: readonly LogRecord[] = [];
type ScopeChoice = { kind: "all" } | { kind: "device"; id: string };
const ALL_CHOICE: ScopeChoice = { kind: "all" };

function LogControl({ label, icon, ...props }: ButtonProps & { label: string; icon: ComponentProps<typeof HugeiconsIcon>["icon"] }) {
	return <Tooltip>
		<TooltipTrigger render={<Button variant="toolbar" size="icon" className={consoleStyles.iconControl} aria-label={label} {...props} />}>
			<HugeiconsIcon icon={icon} size={16} strokeWidth={1.8} aria-hidden="true" />
		</TooltipTrigger>
		<TooltipContent><TextMorph>{label}</TextMorph></TooltipContent>
	</Tooltip>;
}

export function UnifiedLogsPanel({ selectedDevice, devices, onDeviceChange, active = true, basePath = "", onSelectionChange, scope: controlledScope, onScopeChange }: UnifiedLogsPanelProps) {
	const [localScope, setLocalScope] = useState<ConsoleScope>("device");
	const scope = controlledScope ?? localScope;
	const setScope = (next: ConsoleScope) => { setLocalScope(next); onScopeChange?.(next); };
	const logs = useUnifiedLogs({ selectedDevice, devices, active, basePath, scope });
	const selection = logs.session?.selected ?? EMPTY_RECORDS;
	const selectionChanged = useRef(onSelectionChange);
	selectionChanged.current = onSelectionChange;
	useEffect(() => { selectionChanged.current?.(selection); }, [selection, selectedDevice?.id, scope]);
	const device = selectedDevice ?? devices[0] ?? null;
	return device && logs.session ? <DeviceLogs key={scope === "all" ? "scope:all" : `device:${device.id}`} device={device}
		devices={devices} onDeviceChange={onDeviceChange} logs={logs} session={logs.session} scope={scope} onScopeChange={setScope} basePath={basePath} />
		: <div className={consoleStyles.root}><p className="px-3 py-4">Select a device to view logs.</p></div>;
}

function DeviceLogs({ device, devices, onDeviceChange, logs, session, scope, onScopeChange, basePath }: {
	device: ConsoleDevice; devices: readonly ConsoleDevice[]; onDeviceChange: (deviceId: string) => void;
	logs: ReturnType<typeof useUnifiedLogs>; session: ConsoleSession;
	scope: ConsoleScope; onScopeChange: (scope: ConsoleScope) => void;
	basePath: string;
}) {
	const [fixedApp, setFixedApp] = useState(session.filters.fixedApp || device.currentApp?.id || "");
	const [statusOpen, setStatusOpen] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const scroll = useConsoleViewport(logs.records, session, follow => logs.setOptions({ follow }));
	const copy = async (records: readonly LogRecord[]) => {
		try {
			await navigator.clipboard.writeText(copyRecords(records));
			notify("success", "Logs copied");
		} catch { notify("error", "Could not copy logs", { description: "Select the log text, then copy it with your keyboard." }); }
	};
	const nativeSource: LogSource = device.platform === "ios" ? "ios-native" : "android-native";
	const sources: readonly LogSource[] = scope === "all" ? CONSOLE_SOURCES : [nativeSource, "react-native"];
	const download = async () => {
		if (downloading) return;
		setDownloading(true);
		try {
			const path = await downloadLogs(logs.getHistory(), scope === "all" ? "all-devices" : device.name, basePath);
			notify("success", "Logs saved to Downloads", { description: path });
		} catch { notify("error", "Could not save logs"); }
		finally { setDownloading(false); }
	};
	const enabledSources = sources.filter(source => session.filters.sources.includes(source));
	const filterActive = session.filters.level !== "trace" || session.filters.appMode === "fixed" || sources.some(source => !session.filters.sources.includes(source));
	return <div className={consoleStyles.root}>
		<PanelToolbar className="gap-1 pe-12">
			<div className={consoleStyles.search}>
				<HugeiconsIcon icon={Search01Icon} className={consoleStyles.searchIcon} aria-hidden="true" />
				<Input type="search" aria-label="Search logs" name="log-search" autoComplete="off" placeholder="Search logs"
					value={session.filters.query} maxLength={4096} className={consoleStyles.searchInput} onChange={event => logs.setFilters({ query: event.target.value })} />
			</div>
			<Popover>
				<Tooltip><TooltipTrigger render={<PopoverTrigger render={<Button variant="toolbar" size="icon" className={consoleStyles.iconControl} aria-label="Log device, app, and type filters" aria-pressed={filterActive} />} />}>
					<HugeiconsIcon icon={Layers01Icon} size={17} strokeWidth={1.8} aria-hidden="true" />
				</TooltipTrigger><TooltipContent>Device, app, log types and levels</TooltipContent></Tooltip>
				<PopoverContent><PopoverTitle className={consoleStyles.menuTitle}>Log filters</PopoverTitle>
					<div className="flex flex-col gap-3">
						<label className={consoleStyles.menuLabel}>Device<Select<ScopeChoice> value={scope === "all" ? ALL_CHOICE : { kind: "device", id: device.id }}
							isItemEqualToValue={(a, b) => a.kind === b.kind && (a.kind === "all" || b.kind === "device" && a.id === b.id)}
							onValueChange={choice => { if (!choice) return; if (choice.kind === "all") onScopeChange("all"); else { onScopeChange("device"); onDeviceChange(choice.id); } }}>
							<SelectTrigger aria-label="Log device" className="w-full"><SelectValue>{scope === "all" ? "All visible devices" : device.name}</SelectValue></SelectTrigger>
							<SelectContent><SelectItem value={ALL_CHOICE}>All visible devices</SelectItem>{devices.map(choice => <SelectItem key={choice.id} value={{ kind: "device", id: choice.id }}>{choice.name} · {choice.platform === "ios" ? "iOS" : "Android"}</SelectItem>)}</SelectContent>
						</Select></label>
						<label className={consoleStyles.menuLabel}>Application<Select value={session.filters.appMode} onValueChange={mode => {
							if (mode === "foreground" || mode === "fixed") logs.setFilters({ appMode: mode, ...(mode === "fixed" ? { fixedApp: fixedApp.trim() } : {}) });
						}}><SelectTrigger aria-label="Log application" className="w-full"><SelectValue>{session.filters.appMode === "foreground" ? "Foreground app" : "Fixed app"}</SelectValue></SelectTrigger>
							<SelectContent><SelectItem value="foreground">Foreground app</SelectItem><SelectItem value="fixed">Fixed app</SelectItem></SelectContent>
						</Select></label>
						<p className={consoleStyles.availability}>{session.filters.appMode === "foreground"
							? `Uses the app in front ${scope === "all" ? "on each device" : "on this device"}. An idle app may not write logs.`
							: "Uses only the application ID below. An idle app may not write logs."}</p>
						{session.filters.appMode === "fixed" && <form className="flex min-w-0 items-end gap-1" onSubmit={event => {
							event.preventDefault(); logs.setFilters({ fixedApp }); setFixedApp(fixedApp.trim());
						}}><label className={`${consoleStyles.menuLabel} min-w-0 flex-1`}>Application ID
							<Input name="log-app" autoComplete="off" value={fixedApp} placeholder="com.example.app" maxLength={512} onChange={event => setFixedApp(event.target.value)} />
						</label><Button variant="quiet" type="submit">Apply</Button></form>}
						{session.filters.appMode === "fixed" && !session.filters.fixedApp && <p className={consoleStyles.availability}>Enter an application ID, then select Apply.</p>}
						<label className={consoleStyles.menuLabel}>Minimum severity<Select value={session.filters.level} onValueChange={level => { if (level) logs.setFilters({ level }); }}>
							<SelectTrigger aria-label="Minimum log severity" className="w-full"><SelectValue>{session.filters.level === "trace" ? "All levels" : `${session.filters.level} and up`}</SelectValue></SelectTrigger>
							<SelectContent>{CONSOLE_LEVELS.map(level => <SelectItem key={level} value={level}>{level === "trace" ? "All levels" : `${level} and up`}</SelectItem>)}</SelectContent>
						</Select></label>
					</div>
					<fieldset className={consoleStyles.menuSection}><legend className={consoleStyles.menuLabel}>Log type</legend>
						{(["native", "react-native"] as const).map((kind: ConsoleLogKind) => <label key={kind} className={consoleStyles.checkboxLabel}><input type="checkbox" className={consoleStyles.checkbox}
							checked={consoleKindSources(kind, device.platform, scope).some(source => session.filters.sources.includes(source))}
							onChange={event => logs.setFilters({ sources: consoleSetKind(session.filters.sources, kind, device.platform, scope, event.currentTarget.checked) })} />{kind === "native" ? "Native" : "React Native"}</label>)}
					</fieldset>
				</PopoverContent>
			</Popover>
			<DropdownMenu><Tooltip><TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="toolbar" size="icon" className={consoleStyles.iconControl} aria-label="Copy or download logs" disabled={!logs.historyCount || downloading} />} />}>
				<HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} aria-hidden="true" />
			</TooltipTrigger><TooltipContent>Copy or download logs</TooltipContent></Tooltip>
				<DropdownMenuContent><DropdownMenuItem onClick={() => void copy(logs.getHistory())}><HugeiconsIcon icon={Copy01Icon} size={14} className="me-2" aria-hidden="true" />Copy logs</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void download()}><HugeiconsIcon icon={Download01Icon} size={14} className="me-2" aria-hidden="true" />Download logs</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<LogControl label={session.options.paused ? "Resume display" : "Pause display"} icon={session.options.paused ? PlayIcon : PauseIcon}
				aria-pressed={session.options.paused} onClick={() => logs.setOptions({ paused: !session.options.paused })} />
			<LogControl label="Clear log view" icon={Delete02Icon} onClick={logs.clear} />
			<Popover onOpenChange={open => { if (open) setStatusOpen(false); }}>
					<Tooltip><TooltipTrigger render={<PopoverTrigger render={<Button variant="toolbar" size="icon" className={consoleStyles.iconControl} aria-label="Log display options and connection details" />} />}>
					<HugeiconsIcon icon={FilterHorizontalIcon} size={17} strokeWidth={1.8} aria-hidden="true" />
				</TooltipTrigger><TooltipContent>Display options and connection details</TooltipContent></Tooltip>
				<PopoverContent><PopoverTitle className={consoleStyles.menuTitle}>Display options</PopoverTitle>
					<div className="flex flex-col gap-2">{([ ["timestamps", "Timestamps"], ["wrap", "Wrap lines"], ["follow", "Follow latest"] ] as const).map(([option, label]) =>
						<label key={option} className={consoleStyles.checkboxLabel}><input type="checkbox" className={consoleStyles.checkbox} checked={session.options[option]}
							onChange={() => logs.setOptions({ [option]: !session.options[option] })} />{label}</label>)}</div>
					<CompactDisclosure title="Source connection details" open={statusOpen} onOpenChange={setStatusOpen} className="mt-3">
					<div className="flex flex-col gap-3">
						{logs.sourceSessions.map(({ device: sourceDevice, session: sourceSession }) => <div key={sourceDevice.id} className="flex flex-col gap-2">
							<p className={consoleStyles.availability}>{sourceDevice.name} · {sourceSession.connection}</p>
							{sourceSession.error && <p role="status" className={consoleStyles.availability}>{sourceSession.error}</p>}
							{([sourceDevice.platform === "ios" ? "ios-native" : "android-native", "react-native"] as const).map(source => {
								const status = sourceSession.statuses.find(status => status.source === source);
								return <div key={source} className={consoleStyles.availability}><span>{source === "react-native" ? "React Native" : "Native"}: {status?.state === "unavailable" ? "Not connected" : status?.state === "debugger-conflict" ? "Another debugger is connected" : status?.state ?? "Waiting for source status"}</span>
									{status?.app && <span>{status.app}{status.pid ? ` · PID ${status.pid}` : ""}</span>}{status?.reason && <span>{status.reason}</span>}</div>;
							})}
							{(sourceSession.gap || sourceSession.localDropped > 0) && <p className={consoleStyles.availability}>{consoleHistoryNote(sourceSession.gap, sourceSession.localDropped > 0)?.description}</p>}
						</div>)}
						{scope === "all" && session.localDropped > 0 && <p className={consoleStyles.availability}>Older logs are outside this combined view's history limit.</p>}
					</div>
					</CompactDisclosure>
				</PopoverContent>
			</Popover>
		</PanelToolbar>
		<div className={consoleStyles.content}>
		<div ref={scroll.viewport} role="region" aria-label={scope === "all" ? "Logs for all visible devices" : `Logs for ${device.name}`}
			tabIndex={0} className={consoleStyles.viewport} onScroll={scroll.onScroll}
			onWheel={event => scroll.onWheel(event.deltaY)}>
			<div className="relative min-w-0" style={{ height: scroll.height }}>{scroll.shown.map(row => <div key={row.record.id}
				className="absolute inset-x-0" style={{ top: row.top }}>
				<LogRow record={row.record} deviceName={devices.find(device => device.id === row.record.device)?.name ?? row.record.device}
					showIdentity={scope === "all"} wrap={session.options.wrap} timestamps={session.options.timestamps} />
			</div>)}</div>
			{!logs.records.length && <p className="px-3 py-4">{consoleEmptyMessage(session, enabledSources)}</p>}
		</div>
		{logs.records.length > 0 && scroll.canJump && <LogControl label="Jump to latest logs" icon={ArrowDown01Icon}
			variant="raised" className={consoleStyles.jump} onClick={scroll.jumpToLatest} />}
		</div>
	</div>;
}
