import { Check, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useReducer, useState } from "react";
import { Button } from "../../ui/button";
import { CollapsibleSection } from "../../ui/collapsible-section";
import { PermBtn } from "./app-permissions-tool";
import {
	listAndroidAppPermissions,
	mutateAppPermissions,
	type AndroidPermissionList,
} from "./permissions-client";
import { useSettingsRefresh } from "./settings-refresh";

const PREFIX = "android.permission.";

/** `android.permission.ACCESS_FINE_LOCATION` reads as `Access fine location`. */
export function permissionLabel(permission: string): string {
	const bare = permission.startsWith(PREFIX)
		? permission.slice(PREFIX.length)
		: permission;
	const words = bare.toLowerCase().split("_").join(" ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function AndroidAppPermissionsTool({
	udid,
	packageName,
}: {
	udid: string;
	packageName: string | null;
}) {
	const [refreshRevision, refreshPermissions] = useReducer(
		(value: number) => value + 1,
		0,
	);
	useSettingsRefresh(refreshPermissions);
	const [runtime, setRuntime] = useState<AndroidPermissionList["runtime"]>([]);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	const load = useCallback(async () => {
		if (!packageName) {
			setRuntime([]);
			return;
		}
		try {
			const result = await listAndroidAppPermissions(udid, packageName);
			setRuntime(result.runtime);
			setError(null);
		} catch (cause) {
			setRuntime([]);
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [udid, packageName]);

	useEffect(() => {
		void load();
	}, [load, refreshRevision]);

	const apply = useCallback(
		async (permission: string, operation: "grant" | "revoke") => {
			if (!packageName) return;
			setPending(`${permission}:${operation}`);
			try {
				await mutateAppPermissions(udid, {
					operation,
					bundleId: packageName,
					permission,
				});
				setError(null);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				setPending(null);
				await load();
			}
		},
		[udid, packageName, load],
	);

	const resetAll = useCallback(async () => {
		if (!packageName) return;
		setPending("__all__");
		try {
			await mutateAppPermissions(udid, {
				operation: "reset",
				bundleId: packageName,
			});
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setPending(null);
			await load();
		}
	}, [udid, packageName, load]);

	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			data-testid="android-app-permissions"
			summaryClassName="grid [grid-template-columns:auto_1fr_auto] items-center gap-2 text-left"
			summary={
				<>
					<div className="flex min-w-0 items-center gap-2">
						<ShieldCheck
							size={14}
							strokeWidth={2}
							className="shrink-0 text-white/45"
						/>
						<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
							Permissions
						</span>
					</div>
					<span />
				</>
			}
		>
			{!packageName ? (
				<p className="px-1 py-2 text-[11px] text-white/45">
					Open an app to change its permissions.
				</p>
			) : runtime.length === 0 ? (
				<p className="px-1 py-2 text-[11px] text-white/45">
					{error ?? `${packageName} declares no runtime permissions.`}
				</p>
			) : (
				<>
					{error && (
						<p className="px-1 pb-2 text-[11px] text-[#f87171]">{error}</p>
					)}
					<div className="flex flex-col gap-1">
						{runtime.map((entry) => (
							<div
								key={entry.permission}
								className="grid [grid-template-columns:1fr_auto] items-center gap-2"
							>
								<span
									className="truncate text-[11px] text-white/70"
									title={entry.permission}
								>
									{permissionLabel(entry.permission)}
								</span>
								<div className="flex items-center gap-1">
									<PermBtn
										active={entry.granted}
										pending={pending === `${entry.permission}:grant`}
										onClick={() => apply(entry.permission, "grant")}
										variant="grant"
										title="Grant"
									>
										<Check size={11} strokeWidth={3} />
									</PermBtn>
									<PermBtn
										active={!entry.granted}
										pending={pending === `${entry.permission}:revoke`}
										onClick={() => apply(entry.permission, "revoke")}
										variant="revoke"
										title="Revoke"
									>
										<X size={11} strokeWidth={3} />
									</PermBtn>
								</div>
							</div>
						))}
					</div>
					<div className="flex justify-end pt-2">
						<Button
							variant="plain"
							size="custom"
							onClick={resetAll}
							disabled={pending === "__all__"}
							className="bg-transparent border border-white/12 text-white/70 h-6 text-[10px] px-2 rounded-[5px] cursor-pointer uppercase tracking-[0.04em]"
							title="agentsims permissions reset"
						>
							{pending === "__all__" ? "Resetting" : "Reset all"}
						</Button>
					</div>
				</>
			)}
		</CollapsibleSection>
	);
}
