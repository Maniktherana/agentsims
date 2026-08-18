import { Effect } from "effect";
import {
	commandFailure,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "./errors";

export type DeviceObservation = {
	device: string;
	platform: "ios" | "android";
	capturedAt: number;
	screenshot: {
		mimeType: string;
		contentBase64: string;
		bytes: number;
	};
	config: unknown;
	accessibility: unknown;
	warnings: string[];
};

export type ObservationSession = {
	platform: "ios" | "android";
	mimeType: string;
	captureScreenshot(): Promise<Buffer>;
	readConfig(): Promise<unknown>;
	readAccessibility(): Promise<unknown>;
};

export type ResolveObservationSession = (
	device: string,
) => Promise<ObservationSession>;

export class DeviceObservationCommands {
	constructor(private readonly resolveSession: ResolveObservationSession) {}

	observe(
		device: string,
		includeAccessibility = true,
	): Effect.Effect<DeviceObservation, ApplicationCommandError> {
		return Effect.gen(this, function* () {
			if (!device) {
				return yield* Effect.fail(
					new InvalidCommandInput({ message: "Invalid or missing device" }),
				);
			}
			const session = yield* Effect.tryPromise({
				try: () => this.resolveSession(device),
				catch: commandFailure,
			});
			const warnings: string[] = [];
			let accessibility: unknown = null;
			if (includeAccessibility) {
				accessibility = yield* Effect.tryPromise({
					try: () => session.readAccessibility(),
					catch: commandFailure,
				}).pipe(
					Effect.catchAll((error) => {
						warnings.push(`accessibility unavailable: ${error.message}`);
						return Effect.succeed(null);
					}),
				);
			}
			const [screenshot, config] = yield* Effect.tryPromise({
				try: () =>
					Promise.all([session.captureScreenshot(), session.readConfig()]),
				catch: commandFailure,
			});
			return {
				device,
				platform: session.platform,
				capturedAt: Date.now(),
				screenshot: {
					mimeType: session.mimeType,
					contentBase64: screenshot.toString("base64"),
					bytes: screenshot.byteLength,
				},
				config,
				accessibility,
				warnings,
			};
		});
	}
}
