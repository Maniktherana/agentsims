import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { freePort } from "./server";

const packageRoot = resolve(import.meta.dir, "../../..");
export const sourceCliPath = join(packageRoot, "src/cli/main.ts");
export const explicitIosDevice =
	process.env.AGENTSIMS_E2E_IOS_DEVICE?.trim() || null;
export const explicitAndroidDevice =
	process.env.AGENTSIMS_E2E_ANDROID_DEVICE?.trim() || null;

export type OwnedE2EServer = {
	origin: string;
	stop(): Promise<void>;
};

function requireFile(path: string, label: string): void {
	if (existsSync(path) && statSync(path).isFile()) return;
	throw new Error(
		`${label} is missing: ${path}. Build it before native tests.`,
	);
}

function requireNativeArtifacts(): void {
	if (explicitIosDevice)
		requireFile(
			join(packageRoot, "dist/native/agentsims-native.node"),
			"The iOS native addon",
		);
	if (explicitAndroidDevice)
		requireFile(
			join(packageRoot, "dist/android/agentsims-ax-server.jar"),
			"The Android accessibility helper",
		);
}

async function stopOwnedChild(
	child: ReturnType<typeof Bun.spawn>,
): Promise<void> {
	if (child.exitCode !== null) return;
	child.stdin.end();
	const graceful = await Promise.race([
		child.exited.then(() => true),
		Bun.sleep(5_000).then(() => false),
	]);
	if (graceful) return;
	child.kill("SIGTERM");
	const terminated = await Promise.race([
		child.exited.then(() => true),
		Bun.sleep(2_000).then(() => false),
	]);
	if (!terminated) child.kill("SIGKILL");
	await child.exited;
}

async function requireDeviceReady(
	origin: string,
	device: string,
): Promise<void> {
	const url = `${origin}/helper/${encodeURIComponent(device)}/config`;
	const deadline = Date.now() + 30_000;
	let detail = "no response";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			detail = `${response.status} ${await response.text()}`;
			if (response.ok) return;
		} catch (error) {
			detail = error instanceof Error ? error.message : String(error);
		}
		await Bun.sleep(100);
	}
	throw new Error(`Native device ${device} did not become ready: ${detail}`);
}

export async function startOwnedE2EServer(): Promise<OwnedE2EServer> {
	requireNativeArtifacts();
	const port = await freePort();
	const child = Bun.spawn(
		[
			process.execPath,
			sourceCliPath,
			"serve",
			"--managed",
			"--json",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
		],
		{
			cwd: packageRoot,
			env: { ...process.env },
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stdout = new Response(child.stdout).text();
	const stderr = new Response(child.stderr).text();
	const origin = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(
				`Agentsims exited during startup (${child.exitCode}).\n${await stderr}`,
			);
		}
		let ready = false;
		try {
			ready = (await fetch(`${origin}/status`)).ok;
		} catch {
			// The owned server is still starting.
		}
		if (ready) {
			let stopped = false;
			const owned = {
				origin,
				async stop() {
					if (stopped) return;
					stopped = true;
					await stopOwnedChild(child);
					const exitCode = child.exitCode;
					if (exitCode !== 0)
						throw new Error(
							`Agentsims exited with ${exitCode}.\n${await stderr}\n${await stdout}`,
						);
				},
			};
			try {
				for (const device of [explicitIosDevice, explicitAndroidDevice])
					if (device) await requireDeviceReady(origin, device);
				return owned;
			} catch (error) {
				await owned.stop().catch(() => {});
				throw error;
			}
		}
		await Bun.sleep(100);
	}
	await stopOwnedChild(child);
	throw new Error(
		`Agentsims did not become ready.\n${await stderr}\n${await stdout}`,
	);
}

export async function runSourceCli(
	server: OwnedE2EServer,
	args: readonly string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const child = Bun.spawn(
		[process.execPath, sourceCliPath, ...args, "--url", server.origin],
		{
			cwd: packageRoot,
			env: { ...process.env },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}
