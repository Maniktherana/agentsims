import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { TextMorph } from "torph/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import type { AndroidSavedState } from "../../../core/android/contracts";
import { runAndroidTool } from "../../android/tools-client";
import { CollapsibleSection } from "../ui/collapsible-section";
import type { AndroidControlAction } from "./android-controls-panel";

type Props = {
	deviceId: string;
	basePath: string;
	active: boolean;
	busy: boolean;
	run: (action: AndroidControlAction) => Promise<boolean>;
};

export function savedStateDate(value: string): string {
	if (!value.trim()) return "Date unavailable";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function AndroidSavedStates({
	deviceId,
	basePath,
	active,
	busy,
	run,
}: Props) {
	const [open, setOpen] = useState(false);
	const [states, setStates] = useState<AndroidSavedState[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const request = useRef<AbortController | null>(null);
	const refresh = useCallback(async () => {
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setLoading(true);
		setError(null);
		try {
			const value = await runAndroidTool<{ snapshots: AndroidSavedState[] }>(
				basePath,
				deviceId,
				{ type: "snapshot", operation: "list" },
				controller.signal,
			);
			if (!controller.signal.aborted) setStates(value.snapshots);
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(
					cause instanceof Error ? cause.message : "Could not load snapshots",
				);
		} finally {
			if (!controller.signal.aborted) setLoading(false);
		}
	}, [basePath, deviceId]);
	useEffect(() => {
		if (!active || !open) return;
		void refresh();
		const onFocus = () => void refresh();
		window.addEventListener("focus", onFocus);
		return () => {
			request.current?.abort();
			window.removeEventListener("focus", onFocus);
		};
	}, [active, open, refresh]);
	const mutate = async (
		operation: "save" | "load" | "delete",
		selectedName: string,
	) => {
		if (await run({ type: "snapshot", operation, name: selectedName })) {
			if (operation === "save") setName("");
			await refresh();
		}
	};
	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			summary={
				<div className="flex min-w-0 items-center gap-2">
					<Save size={14} strokeWidth={2} className="shrink-0 text-white/45" />
					<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
						Device snapshots
					</span>
				</div>
			}
		>
			<form
				className="flex flex-wrap items-end gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void mutate("save", name.trim());
				}}
			>
				<label className="flex min-w-32 flex-1 flex-col gap-1 text-[11px] text-white/60">
					Snapshot name
					<Input
						name="state-name"
						placeholder="signed-in"
						value={name}
						onChange={(event) => setName(event.target.value)}
						pattern="[A-Za-z0-9._\-]{1,64}"
						maxLength={64}
						required
					/>
				</label>
				<Button
					type="submit"
					disabled={busy || !name.trim()}
				>
					Save snapshot
				</Button>
			</form>
			<p className="text-[10px] text-white/45">
				Use letters, numbers, dots, dashes, or underscores. Restore replaces the
				current emulator state.
			</p>
			<div className="flex items-center justify-between gap-2">
				<span className="text-[11px] text-white/50" role="status">
					<TextMorph>
						{loading
							? "Loading snapshots"
							: states
								? `${states.length} ${states.length === 1 ? "snapshot" : "snapshots"}`
								: ""}
					</TextMorph>
				</span>
				<Button
					type="button"
					disabled={busy || loading}
					onClick={() => void refresh()}
				>
					Refresh
				</Button>
			</div>
			{error && (
				<p
					className="rounded-[8px] bg-danger/10 px-2.5 py-2 text-[11px] text-danger-soft"
					role="alert"
				>
					Could not load snapshots: {error}
				</p>
			)}
			{states && (
				<SavedStateList
					states={states}
					busy={busy || loading}
					onRestore={(value) => void mutate("load", value)}
					onDelete={(value) => void mutate("delete", value)}
				/>
			)}
		</CollapsibleSection>
	);
}

export function SavedStateList({
	states,
	busy,
	onRestore,
	onDelete,
}: {
	states: readonly AndroidSavedState[];
	busy: boolean;
	onRestore: (name: string) => void;
	onDelete: (name: string) => void;
}) {
	if (states.length === 0)
		return (
			<p className="py-2 text-[11px] text-white/50">
				No snapshots yet. Save the current device state to return to it later.
			</p>
		);
	return (
		<ul className="m-0 flex list-none flex-col p-0">
			{states.map((state) => (
				<li
					key={state.name}
					className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] py-2 first:border-t-0"
				>
					<div className="min-w-24 flex-1">
						<p className="m-0 break-words text-[12px] text-white/90">
							{state.name}
						</p>
						<p className="m-0 mt-0.5 text-[10px] text-white/45">
							{savedStateDate(state.savedAt)}
							{state.size ? ` · ${state.size}` : ""}
						</p>
					</div>
					<div className="flex shrink-0 gap-1.5">
						<Button
							type="button"
							disabled={busy}
							aria-label={`Restore ${state.name}`}
							onClick={() => onRestore(state.name)}
						>
							Restore
						</Button>
						<Button
							type="button"
							disabled={busy}
							aria-label={`Delete ${state.name}`}
							onClick={() => onDelete(state.name)}
						>
							Delete
						</Button>
					</div>
				</li>
			))}
		</ul>
	);
}
