import { Context, Effect, Layer } from "effect";
import type { AxSnapshot } from "../tools/observe/accessibility-model";
import { ForegroundApps } from "../tools/devices/foreground-apps";
import {
	enrichAxSnapshotWithRnSource,
	readRnSourceFile,
} from "./enrich-accessibility";
import {
	rnProjectContextFromEnvironment,
	rnSourceContextForDevice,
	type RnProjectContext,
} from "./source-context";

export interface RnSourceIdentity {
	testID: string;
	file: string;
	line: number;
}

export function makeRnSources(
	project: RnProjectContext | null,
	appId: (device: string) => Effect.Effect<string | undefined>,
) {
	const context = (device?: string) =>
		Effect.gen(function* () {
			if (!project) return null;
			if (!device) return { project, allowStaticIds: false };
			const app =
				project.appIds.length > 0 && !project.devices.includes(device)
					? yield* appId(device)
					: undefined;
			return rnSourceContextForDevice(project, device, app);
		});
	return {
		enrich: (device: string, snapshot: AxSnapshot) =>
			Effect.map(context(device), (value) =>
				enrichAxSnapshotWithRnSource(snapshot, value),
			),
		read: (identity: RnSourceIdentity, device?: string) =>
			Effect.map(context(device), (value) => readRnSourceFile(identity, value)),
	};
}

export class RnSources extends Context.Tag("@agentsims/RnSources")<
	RnSources,
	ReturnType<typeof makeRnSources>
>() {}

export const rnSourcesLayer = (project = rnProjectContextFromEnvironment()) =>
	Layer.effect(
		RnSources,
		Effect.gen(function* () {
			const foreground = yield* ForegroundApps;
			return makeRnSources(project, (device) =>
				foreground.read(device).pipe(Effect.map((app) => app?.bundleId)),
			);
		}),
	);
