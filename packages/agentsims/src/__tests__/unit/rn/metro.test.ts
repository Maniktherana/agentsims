import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentsims } from "../../../core/react-native/node/metro";

test("preview preserves Metro middleware and closes with the Metro server", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-metro-"));
	const originalManifest = process.env.AGENTSIMS_RN_MANIFEST;
	const originalRoot = process.env.AGENTSIMS_PROJECT_ROOT;
	try {
		let ended = 0;
		let handled = 0;
		let wrapped = 0;
		const server = {
			async end() {
				ended += 1;
			},
		};
		const config = withAgentsims(
			{
				server: {
					enhanceMiddleware(inner: (...args: any[]) => void) {
						wrapped += 1;
						return inner;
					},
				},
			},
			{
				preview: true,
				instrumentBabel: false,
				manifestPath: join(directory, "manifest.jsonl"),
			},
		);
		const middleware = config.server.enhanceMiddleware(() => {
			handled += 1;
		}, server);
		middleware({ url: "/index.bundle?platform=android" }, {}, () => {});
		expect(wrapped).toBe(1);
		expect(handled).toBe(1);
		await server.end();
		expect(ended).toBe(1);
	} finally {
		if (originalManifest === undefined)
			delete process.env.AGENTSIMS_RN_MANIFEST;
		else process.env.AGENTSIMS_RN_MANIFEST = originalManifest;
		if (originalRoot === undefined) delete process.env.AGENTSIMS_PROJECT_ROOT;
		else process.env.AGENTSIMS_PROJECT_ROOT = originalRoot;
		rmSync(directory, { recursive: true, force: true });
	}
});
