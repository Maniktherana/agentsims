import { Effect } from "effect";
import {
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../errors";
import type { AxSnapshot } from "./accessibility-model";
import {
	capturedImage,
	type CapturedImage,
	type SessionScreenshot,
} from "./capture";
import type { AxViewNode } from "./ax-view";
import { matchAxNodes } from "./targets";
import type { DeviceSnapshot, SnapshotStore } from "./snapshot-store";

export type CaptureChannel<T> =
	| { status: "ok"; capturedAt: number; value: T }
	| { status: "error"; capturedAt: number; error: string };

export type CaptureContext = {
	app: string | null;
	orientation: string | null;
	generation: number | null;
	changedDuringCapture: boolean;
	before: CaptureChannel<unknown>;
	after: CaptureChannel<unknown>;
};

export type CapturedAccessibility = {
	snapshot: AxSnapshot;
	view: DeviceSnapshot;
	observationId: string;
};

export type CapturedViewport = CapturedImage & {
	captureId: string | null;
	observationId: string | null;
};

export type ImageCaptureChannel =
	| { status: "ok"; capturedAt: number; value: CapturedViewport }
	| { status: "error"; capturedAt: number; error: string };

export type DeviceObservation = {
	device: string;
	platform: "ios" | "android";
	startedAt: number;
	completedAt: number;
	observationId: string | null;
	captureId: string | null;
	accessibility: CaptureChannel<CapturedAccessibility>;
	image: ImageCaptureChannel;
	context: CaptureContext;
	view: DeviceSnapshot | null;
	warnings: string[];
};

export type DeviceScreenshot = {
	device: string;
	platform: "ios" | "android";
	startedAt: number;
	completedAt: number;
	observationId: null;
	captureId: string | null;
	image: ImageCaptureChannel;
	context: CaptureContext;
	warnings: string[];
};

export type DeviceMatches = {
	device: string;
	snapshot: string;
	query: string;
	nodes: AxViewNode[];
};

export type ObservationSession = {
	platform: "ios" | "android";
	captureScreenshot(): Promise<SessionScreenshot>;
	readConfig(): Promise<unknown>;
	readAccessibility(): Promise<unknown>;
};

export type ResolveObservationSession = (
	device: string,
) => Effect.Effect<ObservationSession, ApplicationCommandError>;

export type ObserveDependencies = {
	resolveSession: ResolveObservationSession;
	store: SnapshotStore;
	readForegroundApp: (device: string) => Effect.Effect<string | null>;
};

export type ObserveOptions = {
	screenshot?: boolean;
	all?: boolean;
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function channel<T>(read: () => Promise<T>): Promise<CaptureChannel<T>> {
	try {
		const value = await read();
		return { status: "ok", capturedAt: Date.now(), value };
	} catch (error) {
		return { status: "error", capturedAt: Date.now(), error: messageOf(error) };
	}
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isAxSnapshot(value: unknown): value is AxSnapshot {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<AxSnapshot>;
	if (
		!candidate.screen ||
		!isFiniteNumber(candidate.screen.width) ||
		!isFiniteNumber(candidate.screen.height) ||
		!Array.isArray(candidate.elements)
	)
		return false;
	return candidate.elements.every((element) => {
		if (!element || typeof element !== "object") return false;
		const item = element as unknown as Record<string, unknown>;
		const frame = item.frame as Record<string, unknown> | undefined;
		return (
			typeof item.id === "string" &&
			typeof item.path === "string" &&
			typeof item.label === "string" &&
			typeof item.value === "string" &&
			typeof item.role === "string" &&
			typeof item.type === "string" &&
			typeof item.enabled === "boolean" &&
			!!frame &&
			isFiniteNumber(frame.x) &&
			isFiniteNumber(frame.y) &&
			isFiniteNumber(frame.width) &&
			isFiniteNumber(frame.height)
		);
	});
}

function configValue(config: unknown, key: string): unknown {
	return config && typeof config === "object"
		? (config as Record<string, unknown>)[key]
		: undefined;
}

function orientationOf(config: unknown): string | null {
	const value = configValue(config, "orientation");
	return typeof value === "string" && value ? value : null;
}

function generationOf(config: unknown): number | null {
	const presentation = configValue(config, "presentationGeneration");
	if (isFiniteNumber(presentation)) return presentation;
	const generation = configValue(config, "generation");
	return isFiniteNumber(generation) ? generation : null;
}

function screenOf(
	config: unknown,
	snapshot: AxSnapshot,
): { width: number; height: number; orientation: string } {
	const width = configValue(config, "width");
	const height = configValue(config, "height");
	return isFiniteNumber(width) && width > 0 && isFiniteNumber(height) && height > 0
		? { width, height, orientation: orientationOf(config) ?? "" }
		: { ...snapshot.screen, orientation: orientationOf(config) ?? "" };
}

function configChanged(before: unknown, after: unknown): boolean {
	for (const key of ["width", "height"] as const) {
		const beforeValue = configValue(before, key);
		const afterValue = configValue(after, key);
		if (
			isFiniteNumber(beforeValue) &&
			isFiniteNumber(afterValue) &&
			beforeValue !== afterValue
		)
			return true;
	}
	const beforeOrientation = orientationOf(before);
	const afterOrientation = orientationOf(after);
	if (
		beforeOrientation !== null &&
		afterOrientation !== null &&
		beforeOrientation !== afterOrientation
	)
		return true;
	const beforeGeneration = generationOf(before);
	const afterGeneration = generationOf(after);
	return (
		beforeGeneration !== null &&
		afterGeneration !== null &&
		beforeGeneration !== afterGeneration
	);
}

async function captureViewport(
	dependencies: ObserveDependencies,
	session: ObservationSession,
	device: string,
	before: CaptureChannel<unknown>,
	observationId: string | null,
): Promise<{
	captureId: string | null;
	image: ImageCaptureChannel;
	after: CaptureChannel<unknown>;
	changed: boolean;
	warnings: string[];
}> {
	const attempt = dependencies.store.beginCapture(device);
	const rawImage = await channel(() => session.captureScreenshot());
	const after = await channel(() => session.readConfig());
	const changed =
		before.status === "ok" &&
		after.status === "ok" &&
		configChanged(before.value, after.value);
	const warnings: string[] = [];
	if (changed)
		warnings.push(
			"The screen changed during capture. The image is not paired with the accessibility tree.",
		);

	if (rawImage.status === "error") {
		dependencies.store.failCapture(attempt);
		return {
			captureId: null,
			image: rawImage,
			after,
			changed,
			warnings,
		};
	}

	let image: CapturedImage;
	try {
		image = capturedImage(rawImage.value);
	} catch (error) {
		dependencies.store.failCapture(attempt);
		return {
			captureId: null,
			image: {
				status: "error",
				capturedAt: rawImage.value.capturedAt,
				error: messageOf(error),
			},
			after,
			changed,
			warnings,
		};
	}

	const publishable =
		before.status === "ok" && after.status === "ok" && !changed;
	const published = publishable
		? dependencies.store.publishCapture(attempt, {
				screen: { width: image.width, height: image.height },
				orientation: orientationOf(after.value),
				generation: generationOf(after.value),
				observation: observationId,
			})
		: (dependencies.store.failCapture(attempt), null);
	if (!published)
		warnings.push("The capture ID is not actionable.");
	return {
		captureId: published?.id ?? null,
		image: {
			status: "ok",
			capturedAt: rawImage.value.capturedAt,
			value: {
				...image,
				captureId: published?.id ?? null,
				observationId: published?.observation ?? null,
			},
		},
		after,
		changed,
		warnings,
	};
}

function contextOf(
	app: string | null,
	before: CaptureChannel<unknown>,
	after: CaptureChannel<unknown>,
	changedDuringCapture: boolean,
): CaptureContext {
	const available =
		after.status === "ok"
			? after.value
			: before.status === "ok"
				? before.value
				: null;
	return {
		app,
		orientation: orientationOf(available),
		generation: generationOf(available),
		changedDuringCapture,
		before,
		after,
	};
}

function contextWarnings(
	before: CaptureChannel<unknown>,
	after: CaptureChannel<unknown>,
): string[] {
	const warnings: string[] = [];
	if (before.status === "error")
		warnings.push(`Screen config before capture failed: ${before.error}`);
	if (after.status === "error")
		warnings.push(`Screen config after capture failed: ${after.error}`);
	return warnings;
}

export function observeDevice(
	dependencies: ObserveDependencies,
	device: string,
	options: ObserveOptions = {},
): Effect.Effect<DeviceObservation, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!device)
			return yield* Effect.fail(
				new InvalidCommandInput({ message: "Invalid or missing device" }),
			);
		const startedAt = Date.now();
		const ticket = dependencies.store.beginObservation(device);
		const session = yield* dependencies.resolveSession(device).pipe(
			Effect.tapError(() =>
				Effect.sync(() => dependencies.store.failObservation(ticket)),
			),
		);
		const app = yield* dependencies.readForegroundApp(device).pipe(
			Effect.tapError(() =>
				Effect.sync(() => dependencies.store.failObservation(ticket)),
			),
		);
		const before = yield* Effect.promise(() => channel(() => session.readConfig()));

		let accessibility: CaptureChannel<CapturedAccessibility>;
		let view: DeviceSnapshot | null = null;
		const raw = yield* Effect.promise(() =>
			channel(() => session.readAccessibility()),
		);
		if (raw.status === "error") {
			dependencies.store.failObservation(ticket);
			accessibility = raw;
		} else if (!isAxSnapshot(raw.value)) {
			dependencies.store.failObservation(ticket);
			accessibility = {
				status: "error",
				capturedAt: raw.capturedAt,
				error: "The accessibility tree is malformed",
			};
		} else {
			view = dependencies.store.publishObservation(ticket, {
				platform: session.platform,
				snapshot: raw.value,
				screen: screenOf(before.status === "ok" ? before.value : null, raw.value),
				app,
				all: options.all === true,
			});
			accessibility = view
				? {
						status: "ok",
						capturedAt: raw.capturedAt,
						value: {
							snapshot: raw.value,
							view,
							observationId: view.id,
						},
					}
				: {
						status: "error",
						capturedAt: raw.capturedAt,
						error: "The accessibility read expired before publication",
					};
		}

		const viewport =
			options.screenshot === false
				? null
				: yield* Effect.promise(() =>
						captureViewport(
							dependencies,
							session,
							device,
							before,
							view?.id ?? null,
						),
					);
		const after = viewport?.after ?? before;
		const image: ImageCaptureChannel = viewport?.image ?? {
			status: "error",
			capturedAt: Date.now(),
			error: "Image capture was not requested",
		};
		const warnings = [
			...(accessibility.status === "error"
				? [`Accessibility capture failed: ${accessibility.error}`]
				: []),
			...contextWarnings(before, after),
			...(viewport && image.status === "error"
				? [`Image capture failed: ${image.error}`]
				: []),
			...(viewport?.warnings ?? []),
		];
		return {
			device,
			platform: session.platform,
			startedAt,
			completedAt: Date.now(),
			observationId: view?.id ?? null,
			captureId: viewport?.captureId ?? null,
			accessibility,
			image,
			context: contextOf(app, before, after, viewport?.changed ?? false),
			view,
			warnings,
		};
	});
}

export function captureDeviceScreenshot(
	dependencies: ObserveDependencies,
	device: string,
): Effect.Effect<DeviceScreenshot, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!device)
			return yield* Effect.fail(
				new InvalidCommandInput({ message: "Invalid or missing device" }),
			);
		const startedAt = Date.now();
		const session = yield* dependencies.resolveSession(device);
		const before = yield* Effect.promise(() => channel(() => session.readConfig()));
		const viewport = yield* Effect.promise(() =>
			captureViewport(dependencies, session, device, before, null),
		);
		return {
			device,
			platform: session.platform,
			startedAt,
			completedAt: Date.now(),
			observationId: null,
			captureId: viewport.captureId,
			image: viewport.image,
			context: contextOf(null, before, viewport.after, viewport.changed),
			warnings: [
				...contextWarnings(before, viewport.after),
				...(viewport.image.status === "error"
					? [`Image capture failed: ${viewport.image.error}`]
					: []),
				...viewport.warnings,
			],
		};
	});
}

export function findOnDevice(
	dependencies: ObserveDependencies,
	device: string,
	query: string,
): Effect.Effect<DeviceMatches, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (!query.trim())
			return yield* Effect.fail(
				new InvalidCommandInput({ message: "A search text is required" }),
			);
		const observation = yield* observeDevice(dependencies, device, {
			screenshot: false,
		});
		const view = observation.view;
		if (!view)
			return yield* Effect.fail(
				new InvalidCommandInput({
					message:
						observation.accessibility.status === "error"
							? observation.accessibility.error
							: "Accessibility is not available now",
				}),
			);
		return {
			device,
			snapshot: view.id,
			query,
			nodes: matchAxNodes(view.nodes, query.trim()).map((node) => ({
				...node,
				children: [],
			})),
		};
	});
}
