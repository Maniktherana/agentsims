import { TextMorph } from "torph/react";
import { Button } from "../../ui/button";
import { ButtonGroup } from "../../ui/button-group";
import { useSettingsRefresh } from "./settings-refresh";
import {
	useCallback,
	useEffect,
	useReducer,
	useState,
	type ReactNode,
} from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import type { PermissionName } from "../../../../core/tools/permissions";
import { ReloadIcon } from "../../icons/index";
import { CollapsibleSection } from "../../ui/collapsible-section";
import { listAppPermissions, mutateAppPermissions } from "./permissions-client";
import {
	PERMISSION_SERVICES,
	type PermAction,
	type PermState,
} from "../../../media/permissions";

export function permissionStateFromList(result: {
	tcc: Record<string, number>;
	location: { Authorization: number } | null;
	notifications: { allowsNotifications: boolean } | null;
}): PermState {
	const state: PermState = {};
	for (const [permission, value] of Object.entries(result.tcc))
		state[permission] = value > 0 ? "grant" : "revoke";
	if (result.notifications)
		state.notifications = result.notifications.allowsNotifications
			? "grant"
			: "revoke";
	if (result.location) {
		state.location = result.location.Authorization > 1 ? "grant" : "revoke";
		state["location-always"] =
			result.location.Authorization === 4 ? "grant" : "revoke";
	}
	return state;
}

export function AppPermissionsTool({
	udid,
	bundleId,
}: {
	udid: string;
	bundleId: string | null;
}) {
	const [refreshRevision, refreshPermissions] = useReducer(
		(value: number) => value + 1,
		0,
	);
	useSettingsRefresh(refreshPermissions);
	const [state, setState] = useState<PermState>({});
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		setState({});
	}, [udid, bundleId]);

	useEffect(() => {
		setError(null);
		if (!bundleId) return;
		let active = true;
		void listAppPermissions(udid, bundleId)
			.then((result) => {
				if (!active) return;
				setState(permissionStateFromList(result));
			})
			.catch((cause: unknown) => {
				if (active)
					setError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			active = false;
		};
	}, [udid, bundleId, refreshRevision]);

	const apply = useCallback(
		async (service: string, action: PermAction) => {
			if (!bundleId) return;
			const key = `${service}:${action}`;
			setPending(key);
			setError(null);
			try {
				const permission = (
					service === "location-always" ? "location" : service
				) as PermissionName;
				await mutateAppPermissions(
					udid,
					action === "reset"
						? { operation: action, bundleId, permission }
						: {
								operation: action,
								bundleId,
								permission,
								...(service === "location-always" && action === "grant"
									? { value: "always" as const }
									: {}),
							},
				);
				setState((s) => ({
					...s,
					[service]: action === "reset" ? undefined : action,
				}));
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				setPending(null);
			}
		},
		[udid, bundleId],
	);

	const resetAll = useCallback(async () => {
		if (!bundleId) return;
		setPending("__all__");
		setError(null);
		try {
			await mutateAppPermissions(udid, { operation: "reset", bundleId });
			setState({});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setPending(null);
		}
	}, [udid, bundleId]);

	if (!bundleId) {
		return <AppPermissionsLoading />;
	}

	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			summaryClassName="grid [grid-template-columns:auto_1fr_auto] items-center gap-2 text-left"
			summary={
				<>
					<div className="flex min-w-0 items-center gap-2">
						<ShieldCheck
							size={14}
							strokeWidth={2}
							className="shrink-0 text-white/45"
						/>
						<span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">
							Permissions
						</span>
					</div>
					<span />
				</>
			}
		>
			{error && (
				<div className="bg-danger/10 border border-danger/20 text-danger-soft text-[12px] px-2 py-1.5 rounded-md">
					{error}
				</div>
			)}

			<div className="relative">
				<div className="scroll-fade-y scroll-fade-6 max-h-[260px] overflow-y-auto flex flex-col gap-1 py-2 [scrollbar-width:thin]">
					{PERMISSION_SERVICES.map(({ key, label }) => {
						const current = state[key];
						return (
							<div
								key={key}
								className="flex items-center justify-between gap-2 px-0.5 py-1"
							>
								<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-white/90">
									{label}
								</span>
								<ButtonGroup className="shrink-0" aria-label={label}>
									<PermBtn
										active={current === "grant"}
										pending={pending === `${key}:grant`}
										onClick={() => apply(key, "grant")}
										variant="grant"
										title="Allow"
									>
										<Check size={14} strokeWidth={2.5} />
									</PermBtn>
									<PermBtn
										active={current === "revoke"}
										pending={pending === `${key}:revoke`}
										onClick={() => apply(key, "revoke")}
										variant="revoke"
										title="Deny"
									>
										<X size={14} strokeWidth={2.5} />
									</PermBtn>
									<PermBtn
										active={false}
										pending={pending === `${key}:reset`}
										onClick={() => apply(key, "reset")}
										variant="reset"
										title="Reset"
									>
										<ReloadIcon size={14} strokeWidth={2.2} />
									</PermBtn>
								</ButtonGroup>
							</div>
						);
					})}
				</div>
			</div>

			<div className="flex justify-end">
				<Button
					variant="raised"
					size="compact"
					onClick={resetAll}
					disabled={pending === "__all__"}
					className="uppercase tracking-[0.04em]"
					title="agentsims permissions reset all"
				>
					<TextMorph>
						{pending === "__all__" ? "Resetting" : "Reset all"}
					</TextMorph>
				</Button>
			</div>
		</CollapsibleSection>
	);
}

export function AppPermissionsLoading() {
	return (
		<div
			data-testid="app-permissions-loading"
			className="border-b border-white/[0.07] px-3 py-2"
			aria-disabled="true"
			aria-busy="true"
		>
			<div className="select-none text-white/55 min-h-[36px] leading-none py-2.5 px-1 -my-2 -mx-1 w-[calc(100%+8px)] grid [grid-template-columns:auto_1fr_auto] items-center gap-2 text-left cursor-default">
				<div className="flex min-w-0 items-center gap-2">
					<ShieldCheck
						size={14}
						strokeWidth={2}
						className="shrink-0 text-white/45"
					/>
					<span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">
						Permissions
					</span>
				</div>
				<span />
				<span
					data-testid="permissions-loading-indicator"
					role="status"
					aria-label="Loading permissions"
					className="size-2.5 rounded-full border border-[#5f6268] border-t-[#f4f4f5] animate-[grid-spin_0.7s_linear_infinite]"
				/>
			</div>
		</div>
	);
}

export function PermBtn({
	active,
	pending,
	onClick,
	variant,
	title,
	children,
}: {
	active: boolean;
	pending: boolean;
	onClick: () => void;
	variant: "grant" | "revoke" | "reset";
	title: string;
	children: ReactNode;
}) {
	const accent =
		variant === "grant"
			? "#4ade80"
			: variant === "revoke"
				? "#f87171"
				: "var(--agentsims-accent)";
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			onClick={onClick}
			disabled={pending}
			title={title}
			aria-label={title}
			style={{
				background: active ? "rgba(255,255,255,0.08)" : "transparent",
				color: active ? accent : "rgba(255,255,255,0.55)",
				opacity: pending ? 0.5 : 1,
			}}
		>
			{children}
		</Button>
	);
}
