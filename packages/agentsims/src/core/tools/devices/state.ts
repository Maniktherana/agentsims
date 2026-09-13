import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "node:crypto";
import { readdirSync, mkdirSync, writeFileSync, renameSync, rmSync } from "fs";
import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

/** Directory where Agentsims stores runtime state. */
export const STATE_DIR = join(tmpdir(), "agentsims");

/** Per-device state file: `/tmp/agentsims/server-{udid}.json` */
export function stateFileForDevice(udid: string): string {
	return join(STATE_DIR, `server-${udid}.json`);
}

/** Runtime record for a device streamed in-process by a preview server. */
export interface DeviceState {
	pid: number;
	port: number;
	device: string;
	url: string;
	streamUrl: string;
	wsUrl: string;
}

/**
 * Build the state for a device served in-process. There is no separate helper
 * port. The URLs point at the Bun server's same-origin
 * `{base}/helper/<device>/…` routes backed by native device sessions.
 */
export function inProcessDeviceState(
	udid: string,
	port: number,
	base = "/",
	host = "127.0.0.1",
): DeviceState {
	const h = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
	// Normalize to a leading-slash, no-trailing-slash prefix so a base without a
	// leading slash (e.g. "foo") still yields well-formed `…:port/foo/helper/…`.
	const trimmed = base.replace(/^\/+/, "").replace(/\/+$/, "");
	const prefix = trimmed === "" ? "" : `/${trimmed}`;
	const streamPath = udid.startsWith("android:")
		? "stream.avcc"
		: "stream.mjpeg";
	return {
		pid: process.pid,
		port,
		device: udid,
		url: `http://${h}:${port}`,
		streamUrl: `http://${h}:${port}${prefix}/helper/${udid}/${streamPath}`,
		wsUrl: `ws://${h}:${port}${prefix}/helper/${udid}/ws`,
	};
}

/** Persist a device's state so other processes / the grid can enumerate it.
 *  Writes atomically (temp file + rename) so a concurrent reader never observes
 *  a truncated or partially-written file. */
export function writeDeviceState(state: DeviceState): void {
	mkdirSync(STATE_DIR, { recursive: true });
	const file = stateFileForDevice(state.device);
	const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2));
	renameSync(tmp, file);
}

export function removeDeviceState(device: string): void {
	rmSync(stateFileForDevice(device), { force: true });
}

/** List all per-device state files in the state directory. */
export function listStateFiles(): string[] {
	try {
		return readdirSync(STATE_DIR)
			.filter((f) => f.startsWith("server-") && f.endsWith(".json"))
			.map((f) => join(STATE_DIR, f));
	} catch {
		return [];
	}
}

export type DeviceStateStoreService = {
	write(state: DeviceState): Effect.Effect<void, unknown>;
	remove(device: string): Effect.Effect<void, unknown>;
	removeFile(file: string): Effect.Effect<void, unknown>;
	listFiles(): Effect.Effect<string[]>;
	read(file: string): Effect.Effect<DeviceState, unknown>;
};

export class DeviceStateStore extends Context.Tag(
	"@agentsims/DeviceStateStore",
)<DeviceStateStore, DeviceStateStoreService>() {}

export const deviceStateStoreLayer = (directory: string, pid: number) =>
	Layer.effect(
		DeviceStateStore,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const fileFor = (device: string) =>
				path.join(directory, `server-${device}.json`);
			return DeviceStateStore.of({
				write: (state) =>
					Effect.gen(function* () {
						yield* fs.makeDirectory(directory, { recursive: true });
						const file = fileFor(state.device);
						const temporary = `${file}.${pid}.${randomUUID()}.tmp`;
						yield* fs.writeFileString(
							temporary,
							JSON.stringify(state, null, 2),
						);
						yield* fs.rename(temporary, file);
					}),
				remove: (device) =>
					fs.remove(fileFor(device)).pipe(Effect.catchAll(() => Effect.void)),
				removeFile: (file) =>
					fs.remove(file).pipe(Effect.catchAll(() => Effect.void)),
				listFiles: () =>
					fs.readDirectory(directory).pipe(
						Effect.map((files) =>
							files
								.filter(
									(file) =>
										file.startsWith("server-") && file.endsWith(".json"),
								)
								.map((file) => path.join(directory, file)),
						),
						Effect.catchAll(() => Effect.succeed([])),
					),
				read: (file) =>
					fs.readFileString(file).pipe(
						Effect.flatMap((text) =>
							Effect.try({
								try: () => JSON.parse(text) as DeviceState,
								catch: (error) => error,
							}),
						),
					),
			});
		}),
	);
