import { shellEscape, type ExecResult } from "../input/exec";

/**
 * Screenshots save the same way recordings do: the host CLI writes the file.
 * The CLI captures through the server at full device resolution, never from
 * the browser canvas, which can be scaled down for the stream.
 */
export const SCREENSHOT_SAVE_DIRECTORY = '"$HOME/Downloads"';

type Exec = (command: string) => Promise<ExecResult>;

/** The recording naming scheme with a `screenshot-` prefix. */
export function hostScreenshotFileName(device: string, now: Date): string {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const slug = device.replace(/[^0-9A-Za-z._-]/g, "_") || "device";
	return `screenshot-${slug}-${stamp}.png`;
}

/** Capture now into a pending file. The preview decides later to keep it or not. */
export function hostScreenshotCaptureCommand(
	device: string,
	name: string,
): string {
	return `T="\${TMPDIR:-/tmp}"; agentsims screenshot "\${T%/}/agentsims-pending-${name}" -d ${shellEscape(device)} --json`;
}

export function hostScreenshotCommitCommand(
	pendingPath: string,
	name: string,
): string {
	const target = `${SCREENSHOT_SAVE_DIRECTORY}/${name}`;
	return `mkdir -p ${SCREENSHOT_SAVE_DIRECTORY} && mv -n ${shellEscape(pendingPath)} ${target} && test ! -e ${shellEscape(pendingPath)} && printf '%s' ${target}`;
}

export function hostScreenshotDiscardCommand(pendingPath: string): string {
	return `rm -f ${shellEscape(pendingPath)}`;
}

function firstLine(text: string): string {
	return (
		text
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean)
			?.replace(/^agentsims:\s*/, "") ?? ""
	);
}

/** `agentsims screenshot --json` → the written path, or the reason that it was not written. */
export function parseHostScreenshot(result: ExecResult): string {
	let json: {
		artifact?: { status?: string; path?: string; error?: string } | null;
		image?: { status?: string; error?: string } | null;
	} | null = null;
	try {
		const start = result.stdout.indexOf("{");
		const end = result.stdout.lastIndexOf("}");
		if (start >= 0 && end > start)
			json = JSON.parse(result.stdout.slice(start, end + 1));
	} catch {
		json = null;
	}
	const artifact = json?.artifact;
	if (artifact?.status === "ok" && typeof artifact.path === "string")
		return artifact.path;
	throw new Error(
		artifact?.error ??
			json?.image?.error ??
			(firstLine(`${result.stderr}\n${result.stdout}`) ||
				`The command stopped with code ${result.exitCode}.`),
	);
}

function notSaved(reason: unknown): Error {
	const text = reason instanceof Error ? reason.message : String(reason);
	return new Error(`Screenshot was not saved. ${text}`.trim());
}

/** One screenshot: captured at the click, kept or discarded by the preview. */
export class HostScreenshotSave {
	private readonly name: string;
	private readonly pending: Promise<string>;
	private settled: "open" | "committed" | "discarded" = "open";

	constructor(
		private readonly exec: Exec,
		device: string,
		now = new Date(),
	) {
		this.name = hostScreenshotFileName(device, now);
		this.pending = exec(hostScreenshotCaptureCommand(device, this.name)).then(
			parseHostScreenshot,
		);
		// The preview can end before the capture. Do not report that as unhandled.
		this.pending.catch(() => {});
	}

	/** Move the capture into the save directory. Returns the saved path. */
	async commit(): Promise<string> {
		if (this.settled === "discarded")
			throw notSaved("The screenshot was discarded.");
		let pendingPath: string;
		try {
			pendingPath = await this.pending;
		} catch (error) {
			throw notSaved(error);
		}
		const result = await this.exec(
			hostScreenshotCommitCommand(pendingPath, this.name),
		);
		const path = result.stdout.trim();
		if (result.exitCode !== 0 || !path)
			throw notSaved(
				firstLine(result.stderr) || "The file did not move to Downloads.",
			);
		this.settled = "committed";
		return path;
	}

	/** Remove a capture that the user did not keep. */
	discard(): void {
		if (this.settled !== "open") return;
		this.settled = "discarded";
		void this.pending.then(
			(path) => this.exec(hostScreenshotDiscardCommand(path)),
			() => {},
		);
	}
}
