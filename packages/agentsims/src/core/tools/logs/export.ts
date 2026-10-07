import { FileSystem, Path } from "@effect/platform";
import { Clock, Config, Effect } from "effect";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { commandFailure, InvalidCommandInput } from "../errors";

export const LOG_EXPORT_BYTES = 8 * 1024 * 1024;

/** Save captured browser history. A download must not acquire another collector. */
export function exportLogs(input: unknown) {
	return Effect.gen(function* () {
		const { name, text } = yield* Effect.try({
			try: () => {
				if (!input || typeof input !== "object" || Array.isArray(input))
					throw new InvalidCommandInput({ message: "Invalid log export." });
				const value = input as Record<string, unknown>;
				if (
					typeof value.name !== "string" ||
					value.name.length > 256 ||
					typeof value.text !== "string" ||
					!value.text.length
				)
					throw new InvalidCommandInput({
						message: "Log name and text are required.",
					});
				if (Buffer.byteLength(value.text, "utf8") > LOG_EXPORT_BYTES)
					throw new InvalidCommandInput({
						message: "Log export exceeds 8 MiB.",
					});
				return {
					name:
						value.name
							.replace(/[^a-zA-Z0-9_-]+/g, "-")
							.replace(/^-+|-+$/g, "")
							.slice(0, 72) || "agentsims",
					text: value.text,
				};
			},
			catch: commandFailure,
		});
		const fileSystem = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const home = yield* Config.string("HOME").pipe(
			Config.withDefault(homedir()),
		);
		const downloads = path.join(home, "Downloads");
		yield* fileSystem.makeDirectory(downloads, { recursive: true });
		const timestamp = new Date(yield* Clock.currentTimeMillis)
			.toISOString()
			.replace(/[:.]/g, "-");
		const filename = `${name}-logs-${timestamp}-${randomUUID()}.txt`;
		const destination = path.join(downloads, filename);
		const temporary = path.join(downloads, `.${filename}.tmp`);
		return yield* Effect.gen(function* () {
			yield* fileSystem.writeFileString(temporary, text, {
				flag: "wx",
				mode: 0o600,
			});
			yield* fileSystem.rename(temporary, destination);
			return { path: destination };
		}).pipe(
			Effect.ensuring(fileSystem.remove(temporary).pipe(Effect.ignore)),
			Effect.uninterruptible,
		);
	});
}
