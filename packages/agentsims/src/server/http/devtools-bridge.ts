import { createServer as createNetServer } from "net";

const START_PORT = 9222;

export type WebKitBridgeTarget = {
	id: string;
	title: string;
	url: string;
	type: string;
	appName?: string;
	bundleId?: string;
	udid?: string;
	inUseByOtherInspector?: boolean;
};

export type WebKitBridge = {
	port: number;
	cdpUrl: string;
	listTargets(): Promise<WebKitBridgeTarget[]>;
	highlightTarget?(targetId: string, on: boolean): Promise<void>;
	releaseHighlight?(targetId?: string): void;
	close?(): void;
};

type InspectWebKitTarget = {
	targetId: string;
	title?: string;
	appName?: string;
	url?: string;
	type?: string;
	bundleId?: string;
	inUseByOtherInspector?: boolean;
	source?: { kind?: string; id?: string };
};

async function isLocalPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createNetServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => server.close(() => resolve(true)));
		server.listen(port, "127.0.0.1");
	});
}

export async function startInspectWebKitBridge(): Promise<WebKitBridge> {
	const { startCdpServer } = await import("inspect-webkit");
	for (let port = START_PORT; port < START_PORT + 50; port++) {
		if (!(await isLocalPortFree(port))) continue;
		try {
			const server = await startCdpServer({
				host: "127.0.0.1",
				port,
			});
			return {
				port,
				cdpUrl: `http://127.0.0.1:${port}`,
				async listTargets() {
					return (server.getTargets() as InspectWebKitTarget[])
						.filter((target) => target.source?.kind === "simulator")
						.map((target) => {
							const url = target.url ?? "";
							return {
								id: target.targetId,
								title: target.title || target.appName || url || "Untitled",
								url: /^https?:/i.test(url) ? url : "about:blank",
								type: target.type || "page",
								appName: target.appName,
								bundleId: target.bundleId,
								udid: target.source?.id,
								inUseByOtherInspector: Boolean(target.inUseByOtherInspector),
							};
						});
				},
				highlightTarget: server.highlightTarget.bind(server),
				releaseHighlight: server.releaseHighlight.bind(server),
				close: () => server.stop(),
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
			throw error;
		}
	}
	throw new Error(
		`No available inspect-webkit port found in ${START_PORT}-${START_PORT + 49}`,
	);
}
