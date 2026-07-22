import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Globe,
  MonitorSmartphone,
  PanelRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import { type GridDevice, runtimeLabel } from "../utils/grid";
import { AgentsimsBrandLink } from "./agentsims-brand-link";
import { DeviceRow } from "./device-row";

const DEVICE_SKELETON_ROWS = 8;

export function WorkspaceHeader({
  pickerOpen,
  onPickerOpenChange,
  devices,
  total,
  hasMore,
  onLoadMore,
  onLoadAll,
  onResetPage,
  selectedUdid,
  visibleUdids,
  onSelect,
  onToggleVisible,
  onStart,
  starting,
  shuttingDown,
  onShutdown,
  toolsOpen,
  onToggleTools,
  devtoolsOpen,
  onToggleDevtools,
  devtoolsAvailable,
}: {
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  devices: GridDevice[] | null;
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onLoadAll: () => void;
  onResetPage: () => void;
  selectedUdid: string | null;
  visibleUdids: Set<string>;
  onSelect: (udid: string) => void;
  onToggleVisible: (udid: string, visible: boolean) => void;
  onStart: (udid: string) => void;
  starting: Record<string, boolean>;
  shuttingDown: Record<string, boolean>;
  onShutdown: (udid: string) => void;
  toolsOpen: boolean;
  onToggleTools: () => void;
  devtoolsOpen: boolean;
  onToggleDevtools: () => void;
  devtoolsAvailable: boolean;
}) {
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const wasSearchingRef = useRef(false);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized || !devices) return devices;
    return devices.filter((device) =>
      device.name.toLowerCase().includes(normalized) ||
      runtimeLabel(device.runtime).toLowerCase().includes(normalized)
    );
  }, [devices, query]);
  const runningDevices = useMemo(
    () => filtered?.filter((device) => !!device.helper) ?? null,
    [filtered],
  );
  const availableDevices = useMemo(
    () => filtered?.filter((device) => !device.helper) ?? null,
    [filtered],
  );
  const selectedDevice = devices?.find((device) => device.device === selectedUdid) ?? null;
  const visibleCount = devices?.filter(
    (device) => !!device.helper && visibleUdids.has(device.device),
  ).length ?? 0;

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) onPickerOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onPickerOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onPickerOpenChange, pickerOpen]);

  useEffect(() => {
    const searching = !!query.trim();
    if (searching && hasMore) onLoadAll();
    else if (!searching && wasSearchingRef.current) onResetPage();
    wasSearchingRef.current = searching;
  }, [hasMore, onLoadAll, onResetPage, query]);

  const openPicker = () => {
    onPickerOpenChange(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  return (
    <header className="pointer-events-none fixed inset-x-3 top-3 z-50 flex items-start justify-between gap-3 font-system">
      <div
        ref={pickerRef}
        className="pointer-events-auto relative flex h-10 min-w-0 items-center rounded-lg bg-[#181818]/96 px-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.42),0_0_0_1px_rgba(255,255,255,0.1)] backdrop-blur-xl"
      >
        <AgentsimsBrandLink />
        <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
        <button
          type="button"
          onClick={() => pickerOpen ? onPickerOpenChange(false) : openPicker()}
          className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-white/75 [transition-property:background,color,scale] duration-150 hover:bg-white/[0.08] hover:text-white active:scale-[0.96]"
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          title="Devices"
        >
          <MonitorSmartphone size={16} strokeWidth={1.9} className="shrink-0" />
          <span className="max-w-[180px] truncate text-[12px] font-medium">
            {selectedDevice?.name ?? "Devices"}
          </span>
          <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] tabular-nums text-white/55">
            {visibleCount}
          </span>
          <ChevronDown
            size={13}
            strokeWidth={2}
            className={`shrink-0 text-white/35 [transition:transform_0.15s_ease] ${pickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={openPicker}
          className="grid size-8 shrink-0 place-items-center rounded-md text-white/55 [transition-property:background,color,scale] duration-150 hover:bg-white/[0.08] hover:text-white active:scale-[0.96]"
          aria-label="Add simulator"
          title="Add simulator"
        >
          <Plus size={17} strokeWidth={2} />
        </button>

        {pickerOpen && (
          <div
            role="dialog"
            aria-label="Devices"
            className="absolute left-0 top-[calc(100%+8px)] flex max-h-[calc(100vh-72px)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg bg-[#181818]/98 text-white/90 shadow-[0_18px_60px_rgba(0,0,0,0.58),0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-xl"
          >
            <div className="flex shrink-0 items-center gap-2 p-2">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md bg-white/[0.06] px-2.5 focus-within:bg-white/[0.09]">
                <Search size={14} strokeWidth={2} className="shrink-0 text-white/35" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search devices"
                  className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-white/90 outline-none placeholder:text-white/35"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="grid size-6 place-items-center rounded-md text-white/35 hover:bg-white/[0.08] hover:text-white/75"
                    aria-label="Clear search"
                    title="Clear"
                  >
                    <X size={12} strokeWidth={2.2} />
                  </button>
                )}
              </label>
              <button
                type="button"
                onClick={() => onPickerOpenChange(false)}
                className="grid size-9 shrink-0 place-items-center rounded-md text-white/40 hover:bg-white/[0.08] hover:text-white/80"
                aria-label="Close device picker"
                title="Close"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]"
              onScroll={(event) => {
                if (query.trim() || !hasMore) return;
                const target = event.currentTarget;
                if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) onLoadMore();
              }}
            >
              {filtered === null || runningDevices === null || availableDevices === null ? (
                <DeviceListSkeleton />
              ) : (
                <>
                  <DeviceSectionTitle count={runningDevices.length}>Running</DeviceSectionTitle>
                  {runningDevices.length === 0 ? (
                    <EmptyDevices>{query ? "No running devices match." : "No devices are running."}</EmptyDevices>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {runningDevices.map((device) => (
                        <DeviceRow
                          key={device.device}
                          device={device}
                          active={device.device === selectedUdid}
                          checked={visibleUdids.has(device.device)}
                          showCheckbox
                          starting={!!starting[device.device]}
                          shuttingDown={!!shuttingDown[device.device]}
                          onSelect={() => onSelect(device.device)}
                          onCheckedChange={(checked) => onToggleVisible(device.device, checked)}
                          onShutdown={() => onShutdown(device.device)}
                        />
                      ))}
                    </div>
                  )}

                  <div className="my-2 h-px bg-white/[0.07]" />
                  <DeviceSectionTitle count={availableDevices.length}>Available</DeviceSectionTitle>
                  {availableDevices.length === 0 ? (
                    <EmptyDevices>{query ? "No available devices match." : "No available devices found."}</EmptyDevices>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {availableDevices.map((device) => (
                        <DeviceRow
                          key={device.device}
                          device={device}
                          active={device.device === selectedUdid}
                          starting={!!starting[device.device]}
                          shuttingDown={!!shuttingDown[device.device]}
                          onSelect={() => {
                            onSelect(device.device);
                            onStart(device.device);
                          }}
                          onShutdown={() => onShutdown(device.device)}
                        />
                      ))}
                    </div>
                  )}
                  {!query && hasMore && (
                    <div className="px-2 py-2 text-center text-[10px] tabular-nums text-white/30">
                      {devices?.length ?? 0} of {total}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-auto flex h-10 shrink-0 items-center gap-1 rounded-lg bg-[#181818]/96 p-1 shadow-[0_8px_28px_rgba(0,0,0,0.42),0_0_0_1px_rgba(255,255,255,0.1)] backdrop-blur-xl">
        {devtoolsAvailable && (
          <button
            type="button"
            onClick={onToggleDevtools}
            className={`grid size-8 place-items-center rounded-md [transition-property:background,color,scale] duration-150 hover:bg-white/[0.08] active:scale-[0.96] ${devtoolsOpen ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white"}`}
            aria-label="WebKit DevTools"
            aria-pressed={devtoolsOpen}
            title="WebKit DevTools"
          >
            <Globe size={17} strokeWidth={1.9} />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleTools}
          className={`grid size-8 place-items-center rounded-md [transition-property:background,color,scale] duration-150 hover:bg-white/[0.08] active:scale-[0.96] ${toolsOpen ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white"}`}
          aria-label="Simulator tools"
          aria-pressed={toolsOpen}
          title="Simulator tools"
        >
          <PanelRight size={17} strokeWidth={1.9} />
        </button>
      </div>
    </header>
  );
}

function DeviceSectionTitle({ children, count }: { children: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase text-white/35">
      <span>{children}</span>
      <span className="tabular-nums text-white/25">{count}</span>
    </div>
  );
}

function EmptyDevices({ children }: { children: string }) {
  return <div className="px-2 py-4 text-center text-[11px] text-white/35">{children}</div>;
}

function DeviceListSkeleton() {
  return (
    <div data-testid="device-list-skeleton" className="py-1" aria-label="Loading devices" aria-busy="true">
      {Array.from({ length: DEVICE_SKELETON_ROWS }, (_, index) => (
        <div
          key={index}
          data-testid="device-row-skeleton"
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
          aria-hidden
        >
          <span className="size-9 shrink-0 rounded-lg bg-white/[0.07]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-3 w-2/3 rounded-full bg-white/[0.1]" />
            <span className="h-2.5 w-2/5 rounded-full bg-white/[0.06]" />
          </span>
        </div>
      ))}
    </div>
  );
}
