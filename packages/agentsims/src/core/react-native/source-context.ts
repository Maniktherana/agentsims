import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	createRnProjectContext,
	type RnProjectContext,
} from "../../../../agentsims-react-native/src/project-context";
export {
	canonicalProjectRoot,
	createRnProjectContext,
	rnProjectKey,
	type RnProjectContext,
} from "../../../../agentsims-react-native/src/project-context";

export interface RnSourceReadContext {
	project: RnProjectContext;
	allowStaticIds: boolean;
}

function identifiers(value: string | undefined): string[] {
	if (!value) return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
			: [];
	} catch {
		return [];
	}
}

/** Read once when a runtime scope starts. No project means no source access. */
export function rnProjectContextFromEnvironment(): RnProjectContext | null {
	const root = process.env.AGENTSIMS_PROJECT_ROOT;
	return root
		? createRnProjectContext(root, {
				manifestPath: process.env.AGENTSIMS_RN_MANIFEST,
				appIds: identifiers(process.env.AGENTSIMS_RN_APP_IDS),
				devices: identifiers(process.env.AGENTSIMS_RN_DEVICES),
			})
		: null;
}

export function rnSourceContextForDevice(
	project: RnProjectContext,
	device: string,
	appId?: string,
): RnSourceReadContext {
	return {
		project,
		allowStaticIds:
			project.devices.includes(device) ||
			(appId !== undefined && project.appIds.includes(appId)),
	};
}

export function rnSourcePathIsWithinProject(
	file: string,
	root: string,
): boolean {
	try {
		const resolved = resolve(file);
		let ancestor = resolved;
		for (;;) {
			try {
				lstatSync(ancestor);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
				const parent = dirname(ancestor);
				if (parent === ancestor) return false;
				ancestor = parent;
			}
		}
		const path = resolve(realpathSync(ancestor), relative(ancestor, resolved));
		const rel = relative(root, path);
		return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
	} catch {
		return false;
	}
}
