import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	assertPreviewDynamicImportsPresent,
	assertPreviewManifestAssetsPresent,
	enumeratePreviewDynamicImports,
} from "../../../../server/http/static-files";
import { startTestServer } from "../../../helpers/server";

describe("preview assets", () => {
	test("serves the entry and every emitted dynamic import with browser MIME types", async () => {
		const javascript: Record<string, string> = {
			"assets/client-a0.js":
				'const theme = () => import("./pierre-light-a1.js");',
			"assets/pierre-light-a1.js":
				'const grammar = () => import("./tsx-b2.js");',
			"assets/tsx-b2.js":
				'import { token } from "./client-a0.js"; export default token;',
		};
		const assetFiles = new Set(Object.keys(javascript));
		const imports = assertPreviewDynamicImportsPresent(javascript, assetFiles);
		expect(enumeratePreviewDynamicImports(javascript)).toEqual(imports);
		const manifestImports = assertPreviewManifestAssetsPresent(
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
			assetFiles,
		);
		expect(manifestImports).toEqual([
			"assets/client-a0.js",
			"assets/pierre-light-a1.js",
			"assets/tsx-b2.js",
		]);

		const previewRoot = mkdtempSync(
			join(tmpdir(), "agentsims-preview-imports-"),
		);
		let stopServer = async () => {};
		try {
			mkdirSync(join(previewRoot, "assets"));
			for (const [assetKey, source] of Object.entries(javascript))
				writeFileSync(join(previewRoot, assetKey), source);
			const { origin, server } = await startTestServer({
				previewRoot,
				readDeviceStates: async () => [],
			});
			stopServer = () => server.stop();
			for (const assetKey of manifestImports) {
				const response = await fetch(`${origin}/${assetKey}`);
				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toBe(
					"text/javascript; charset=utf-8",
				);
				expect(response.headers.get("cache-control")).toBe(
					"public, max-age=31536000, immutable",
				);
				expect(await response.text()).toBe(javascript[assetKey]);
			}
		} finally {
			await stopServer();
			rmSync(previewRoot, { recursive: true, force: true });
		}
	});

	test("fails the build contract when a local dynamic import is omitted", () => {
		expect(() =>
			assertPreviewDynamicImportsPresent(
				{ "client.js": 'import("./assets/missing.js")' },
				new Set(),
			),
		).toThrow("assets/missing.js");
	});

	test("fails the build contract when an entry stylesheet is omitted", () => {
		expect(() =>
			assertPreviewManifestAssetsPresent(
				{ client: { file: "assets/client.js", css: ["assets/client.css"] } },
				new Set(["assets/client.js"]),
			),
		).toThrow("assets/client.css");
	});

	test("serves production assets from disk and scopes generated URLs to the mount", async () => {
		const previewRoot = mkdtempSync(join(tmpdir(), "agentsims-preview-"));
		let stopServer = async () => {};
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
			await stopServer();
			rmSync(previewRoot, { recursive: true, force: true });
		}
	});
});
