import { execFile } from "child_process";
import { androidTool } from "./sdk-tools";

export function adb(
	args: string[],
	options?: {
		encoding?: BufferEncoding | "buffer";
		timeout?: number;
		maxBuffer?: number;
	},
): Promise<string | Buffer> {
	return new Promise((resolve, reject) => {
		execFile(
			androidTool("adb"),
			args,
			{
				encoding:
					options?.encoding === "buffer"
						? "buffer"
						: (options?.encoding ?? "utf8"),
				timeout: options?.timeout ?? 10_000,
				maxBuffer: options?.maxBuffer ?? 32 * 1024 * 1024,
			},
			(err, stdout, stderr) => {
				if (err)
					return reject(new Error(stderr?.toString().trim() || err.message));
				resolve(stdout as string | Buffer);
			},
		);
	});
}
export function adbText(args: string[], timeout?: number): Promise<string> {
	return adb(args, { encoding: "utf8", timeout }) as Promise<string>;
}
export function adbBuffer(args: string[], timeout?: number): Promise<Buffer> {
	return adb(args, { encoding: "buffer", timeout }) as Promise<Buffer>;
}
export async function getAndroidProp(
	serial: string,
	name: string,
): Promise<string | undefined> {
	try {
		return (
			(await adbText(["-s", serial, "shell", "getprop", name], 3_000)).trim() ||
			undefined
		);
	} catch {
		return undefined;
	}
}
