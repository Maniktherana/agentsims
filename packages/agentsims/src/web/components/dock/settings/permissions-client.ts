import type { PermissionMutation } from "../../../../core/tools/permissions";
import { simEndpoint } from "../../../preview/sim-endpoint";

export interface PermissionList {
	tcc: Record<string, number>;
	location: { Authorization: number } | null;
	notifications: { allowsNotifications: boolean; critical: boolean } | null;
}

function permissionsUrl(device: string, bundleId?: string): string {
	const url = `${simEndpoint(`device/${encodeURIComponent(device)}/permissions`)}`;
	return bundleId ? `${url}?bundleId=${encodeURIComponent(bundleId)}` : url;
}

async function responseJson<T>(response: Response): Promise<T> {
	const value: unknown = await response.json();
	if (!response.ok)
		throw new Error(
			value && typeof value === "object" && "error" in value
				? String(value.error)
				: `Permission request failed (${response.status})`,
		);
	return value as T;
}

export async function listAppPermissions(device: string, bundleId: string) {
	return responseJson<PermissionList>(
		await fetch(permissionsUrl(device, bundleId)),
	);
}

export async function mutateAppPermissions(
	device: string,
	input: PermissionMutation,
) {
	return responseJson<{ ok: true }>(
		await fetch(permissionsUrl(device), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}),
	);
}
