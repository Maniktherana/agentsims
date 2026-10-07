import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";

export function androidSdkRoot(platform: string, environment: NodeJS.ProcessEnv, home: string): string {
	if (environment.ANDROID_HOME) return environment.ANDROID_HOME;
	if (environment.ANDROID_SDK_ROOT) return environment.ANDROID_SDK_ROOT;
	if (platform === "win32") return win32.join(environment.LOCALAPPDATA ?? win32.join(home, "AppData", "Local"), "Android", "Sdk");
	return platform === "darwin" ? join(home, "Library", "Android", "sdk") : join(home, "Android", "Sdk");
}

export function androidBuildInputs(sdk: string): { platformJar: string; d8Jar: string } {
	const latest = (directory: string, suffix: string[], label: string): string => {
		const names = existsSync(directory) ? readdirSync(directory).sort((a, b) => b.localeCompare(a, "en", { numeric: true })) : [];
		for (const name of names) {
			const path = join(directory, name, ...suffix);
			if (existsSync(path) && statSync(path).isFile()) return path;
		}
		throw new Error(`The Android SDK ${label} is missing under ${sdk}. Install an SDK platform and build-tools.`);
	};
	return {
		platformJar: latest(join(sdk, "platforms"), ["android.jar"], "platform"),
		d8Jar: latest(join(sdk, "build-tools"), ["lib", "d8.jar"], "D8 compiler"),
	};
}

export type AndroidBuildCommand = { executable: string; args: string[] };
export function androidBuildCommands(options: { platform: string; platformJar: string; d8Jar: string; source: string; temporary: string; output: string }): AndroidBuildCommand[] {
	const paths = options.platform === "win32" ? win32 : { join };
	const executable = (name: string) => options.platform === "win32" ? `${name}.exe` : name;
	const classes = paths.join(options.temporary, "classes");
	const dex = paths.join(options.temporary, "dex");
	const classesJar = paths.join(options.temporary, "classes.jar");
	return [
		{ executable: executable("javac"), args: ["-source", "8", "-target", "8", "-cp", options.platformJar, "-d", classes, options.source] },
		{ executable: executable("jar"), args: ["cf", classesJar, "-C", classes, "."] },
		{ executable: executable("java"), args: ["-Xmx2G", "-cp", options.d8Jar, "com.android.tools.r8.D8", "--lib", options.platformJar, "--output", dex, classesJar] },
		{ executable: executable("jar"), args: ["cf", options.output, "-C", dex, "classes.dex"] },
	];
}

export function buildAndroidAccessibility(output = resolve(import.meta.dir, "../../dist/android/agentsims-ax-server.jar")): void {
	const inputs = androidBuildInputs(androidSdkRoot(process.platform, process.env, homedir()));
	const temporary = mkdtempSync(join(tmpdir(), "agentsims-android-ax-build-"));
	try {
		for (const directory of [dirname(output), join(temporary, "classes"), join(temporary, "dex")]) mkdirSync(directory, { recursive: true });
		for (const command of androidBuildCommands({ ...inputs, platform: process.platform, source: resolve(import.meta.dir, "src/dev/agentsims/ax/Main.java"), temporary, output })) {
			const result = spawnSync(command.executable, command.args, { stdio: "inherit", shell: false });
			if (result.error) throw new Error(`${command.executable} is required. Install a JDK and add its bin directory to PATH. ${result.error.message}`);
			if (result.status !== 0) throw new Error(`${command.executable} failed (${result.signal ?? result.status}).`);
		}
		console.log(`Built: ${output}`);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		const [output, ...extra] = process.argv.slice(2);
		if (extra.length) throw new Error("Usage: bun android/accessibility/build.ts [output.jar]");
		buildAndroidAccessibility(output ? resolve(output) : undefined);
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Android accessibility build failed.");
		process.exitCode = 1;
	}
}
