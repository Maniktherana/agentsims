import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { androidBuildCommands, androidBuildInputs, androidSdkRoot } from "../../../../../android/accessibility/build";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("SDK discovery uses explicit roots before the native platform default", () => {
	expect(androidSdkRoot("win32", { ANDROID_HOME: "D:\\SDK", ANDROID_SDK_ROOT: "E:\\SDK" }, "C:\\Users\\dev")).toBe("D:\\SDK");
	expect(androidSdkRoot("win32", { ANDROID_SDK_ROOT: "E:\\SDK" }, "C:\\Users\\dev")).toBe("E:\\SDK");
	expect(androidSdkRoot("win32", { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" }, "C:\\Users\\dev")).toBe("C:\\Users\\dev\\AppData\\Local\\Android\\Sdk");
	expect(androidSdkRoot("win32", {}, "C:\\Users\\dev")).toBe("C:\\Users\\dev\\AppData\\Local\\Android\\Sdk");
	expect(androidSdkRoot("darwin", {}, "/Users/dev")).toBe("/Users/dev/Library/Android/sdk");
	expect(androidSdkRoot("linux", {}, "/home/dev")).toBe("/home/dev/Android/Sdk");
});

test("SDK inputs select the latest installed platform and D8 jar", () => {
	const sdk = mkdtempSync(join(tmpdir(), "agentsims SDK with spaces "));
	directories.push(sdk);
	for (const path of ["platforms/android-9/android.jar", "platforms/android-35/android.jar", "build-tools/9.0.0/lib/d8.jar", "build-tools/35.0.0/lib/d8.jar"]) {
		const file = join(sdk, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "fixture");
	}
	mkdirSync(join(sdk, "platforms/android-99"));
	mkdirSync(join(sdk, "build-tools/99.0.0/lib"), { recursive: true });
	expect(androidBuildInputs(sdk)).toEqual({ platformJar: join(sdk, "platforms/android-35/android.jar"), d8Jar: join(sdk, "build-tools/35.0.0/lib/d8.jar") });
	rmSync(join(sdk, "build-tools"), { recursive: true });
	expect(() => androidBuildInputs(sdk)).toThrow("D8 compiler is missing");
	rmSync(join(sdk, "platforms"), { recursive: true });
	expect(() => androidBuildInputs(sdk)).toThrow("platform is missing");
});

test.each(["win32", "linux", "darwin"])("the %s build preserves argument boundaries and uses Java D8 directly", (platform) => {
	const windows = platform === "win32";
	const temporary = windows ? "C:\\build output\\temporary" : "/build output/temporary";
	const platformJar = windows ? "C:\\Android SDK\\platforms\\android-35\\android.jar" : "/Android SDK/platforms/android-35/android.jar";
	const d8Jar = windows ? "C:\\Android SDK\\build-tools\\35.0.0\\lib\\d8.jar" : "/Android SDK/build-tools/35.0.0/lib/d8.jar";
	const source = windows ? "C:\\project files\\Main.java" : "/project files/Main.java";
	const output = windows ? "C:\\build output\\AX.jar" : "/build output/AX.jar";
	const commands = androidBuildCommands({ platform, temporary, platformJar, d8Jar, source, output });
	expect(commands.map((command) => command.executable)).toEqual(windows ? ["javac.exe", "jar.exe", "java.exe", "jar.exe"] : ["javac", "jar", "java", "jar"]);
	expect(commands[0]!.args.slice(0, 6)).toEqual(["-source", "8", "-target", "8", "-cp", platformJar]);
	expect(commands[0]!.args.at(-1)).toBe(source);
	expect(commands[2]!.args.slice(0, 6)).toEqual(["-Xmx2G", "-cp", d8Jar, "com.android.tools.r8.D8", "--lib", platformJar]);
	expect(commands[2]!.args.at(-1)).toBe(`${temporary}${windows ? "\\" : "/"}classes.jar`);
	expect(commands[3]!.args).toEqual(["cf", output, "-C", `${temporary}${windows ? "\\" : "/"}dex`, "classes.dex"]);
});
