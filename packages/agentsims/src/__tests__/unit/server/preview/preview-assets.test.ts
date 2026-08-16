import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	assertPreviewDynamicImportsEmbedded,
	assertPreviewManifestAssetsEmbedded,
	enumeratePreviewDynamicImports,
	type PreviewAssetMap,
} from "../../../../server/preview/preview-assets";
import { startTestServer } from "../../../helpers/server";

async function getPreviewAsset(previewAssets: PreviewAssetMap, url: string) {
	const { origin, server } = await startTestServer({
		previewAssets,
		readDeviceStates: async () => [],
	});
	try {
		const response = await fetch(`${origin}${url}`);
		return {
			status: response.status,
			headers: Object.fromEntries(response.headers),
			body: Buffer.from(await response.arrayBuffer()),
		};
	} finally {
		server.stop();
	}
}

describe("preview assets", () => {
	test("serves the entry and every emitted dynamic import with browser MIME types", async () => {
		const javascript = {
			"assets/client-a0.js":
				'const theme = () => import("./pierre-light-a1.js");',
			"assets/pierre-light-a1.js":
				'const grammar = () => import("./tsx-b2.js");',
			"assets/tsx-b2.js":
				'import { token } from "./client-a0.js"; export default token;',
		};
		const previewAssets: PreviewAssetMap = {
			"assets/client-a0.js": Buffer.from(
				javascript["assets/client-a0.js"],
			).toString("base64"),
			"assets/pierre-light-a1.js": Buffer.from(
				javascript["assets/pierre-light-a1.js"],
			).toString("base64"),
			"assets/tsx-b2.js": Buffer.from(javascript["assets/tsx-b2.js"]).toString(
				"base64",
			),
		};
		const imports = assertPreviewDynamicImportsEmbedded(
			javascript,
			previewAssets,
		);
		expect(enumeratePreviewDynamicImports(javascript)).toEqual(imports);
		const manifestImports = assertPreviewManifestAssetsEmbedded(
			{
				"src/client.tsx": {
					file: "assets/client-a0.js",
					isEntry: true,
					dynamicImports: ["_pierre-light.js"],
				},
				"_pierre-light.js": {
					file: "assets/pierre-light-a1.js",
					dynamicImports: ["_tsx.js"],
				},
				"_tsx.js": { file: "assets/tsx-b2.js" },
			},
			previewAssets,
		);
		expect(manifestImports).toEqual([
			"assets/client-a0.js",
			"assets/pierre-light-a1.js",
			"assets/tsx-b2.js",
		]);

		for (const assetKey of manifestImports) {
			const response = await getPreviewAsset(previewAssets, `/${assetKey}`);
			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toBe(
				"text/javascript; charset=utf-8",
			);
			expect(response.body.toString().trim().length).toBeGreaterThan(0);
		}
	});

	test("fails the build contract when a local dynamic import is omitted", () => {
		expect(() =>
			assertPreviewDynamicImportsEmbedded(
				{ "client.js": 'import("./assets/missing.js")' },
				{},
			),
		).toThrow("assets/missing.js");
	});

	test("serves production assets from disk and scopes generated URLs to the mount", async () => {
		const previewRoot = mkdtempSync(join(tmpdir(), "agentsims-preview-"));
		let stopServer = () => {};
		try {
			mkdirSync(join(previewRoot, "assets"));
			writeFileSync(
				join(previewRoot, "index.html"),
				'<link rel="stylesheet" href="/__SIM_PREVIEW_BASE__/assets/client.css">' +
					"<!--__SIM_PREVIEW_CONFIG__-->" +
					'<script src="/__SIM_PREVIEW_BASE__/assets/client.js"></script>',
			);
			writeFileSync(
				join(previewRoot, "assets", "client.js"),
				"export default 1;",
			);
			writeFileSync(
				join(previewRoot, "assets", "client.css"),
				"@font-face{src:url(/__SIM_PREVIEW_BASE__/assets/font.woff2)}",
			);

			const started = await startTestServer({
				basePath: "/review",
				execToken: "preview-disk-test",
				previewRoot,
				readDeviceStates: async () => [],
			});
			stopServer = () => started.server.stop();
			const request = async (url: string) => {
				const response = await fetch(`${started.origin}${url}`);
				return {
					status: response.status,
					headers: Object.fromEntries(response.headers),
					body: Buffer.from(await response.arrayBuffer()),
				};
			};

			const script = await request("/review/assets/client.js");
			expect(script.status).toBe(200);
			expect(script.headers["content-type"]).toBe(
				"text/javascript; charset=utf-8",
			);
			expect(script.body.toString()).toContain("export default 1");

			const style = await request("/review/assets/client.css");
			expect(style.status).toBe(200);
			expect(style.headers["content-type"]).toBe("text/css; charset=utf-8");
			expect(style.headers["cache-control"]).toBe("no-store");
			expect(style.body.toString()).toContain("url(/review/assets/font.woff2)");
			expect(style.body.toString()).not.toContain("__SIM_PREVIEW_BASE__");

			const page = await request("/review");
			expect(page.status).toBe(200);
			expect(page.body.toString()).toMatch(
				/href="\/review\/assets\/client\.css\?v=[^"]+"/,
			);
			expect(page.body.toString()).toContain('src="/review/assets/client.js"');
			expect(page.body.toString()).toContain("window.__SIM_PREVIEW__=");

			expect((await request("/review/assets/%5C..%5Csecret")).status).toBe(404);
		} finally {
			stopServer();
			rmSync(previewRoot, { recursive: true, force: true });
		}
	});
});
