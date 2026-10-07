import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "os";
import type { AxSnapshot } from "../../core/tools/observe/accessibility-model";
import {
	enrichAxSnapshotWithRnSource as enrichWithSource,
	rnSourceManifestPath,
} from "../../core/react-native/enrich-accessibility";
import { expoRoute } from "../../../../agentsims-react-native/src/node/babel-plugin";
import { startTestServer } from "../helpers/server";
import {
	createRnProjectContext,
	rnProjectContextFromEnvironment,
} from "../../core/react-native/source-context";
import { createRnProjectContext as producerProjectContext } from "../../../../agentsims-react-native/src/project-context";
import { agentsimsHome } from "../../core/home";

const originalManifest = process.env.AGENTSIMS_RN_MANIFEST;
const originalRoot = process.env.AGENTSIMS_PROJECT_ROOT;
const originalDevices = process.env.AGENTSIMS_RN_DEVICES;
const manifests = new Set<string>();
let manifestSequence = 0;

function useManifest(entries: object[], root = "/repo"): string {
	const manifest = join(
		tmpdir(),
		`agentsims-rn-source-test-${process.pid}-${manifestSequence++}.jsonl`,
	);
	const project = createRnProjectContext(root, { manifestPath: manifest });
	writeFileSync(
		manifest,
		entries
			.map((entry) =>
				JSON.stringify({ ...entry, projectKey: project.projectKey }),
			)
			.join("\n") + "\n",
	);
	process.env.AGENTSIMS_RN_MANIFEST = manifest;
	process.env.AGENTSIMS_PROJECT_ROOT = root;
	process.env.AGENTSIMS_RN_DEVICES = JSON.stringify(["source-fixture"]);
	manifests.add(manifest);
	return manifest;
}

function enrichAxSnapshotWithRnSource(snapshot: AxSnapshot): AxSnapshot {
	return enrichWithSource(snapshot, {
		project: createRnProjectContext(process.env.AGENTSIMS_PROJECT_ROOT!, {
			manifestPath: process.env.AGENTSIMS_RN_MANIFEST,
		}),
		allowStaticIds: true,
	});
}

async function getFromMiddleware(
	url: string,
	requestHeaders: Record<string, string> = {},
) {
	const started = await startTestServer({ device: "source-fixture" });
	try {
		const response = await fetch(`${started.origin}${url}`, {
			headers: requestHeaders,
		});
		return {
			status: response.status,
			body: await response.text(),
			headers: { ETag: response.headers.get("etag") ?? undefined },
		};
	} finally {
		await started.server.stop();
	}
}

afterEach(() => {
	if (originalRoot === undefined) delete process.env.AGENTSIMS_PROJECT_ROOT;
	else process.env.AGENTSIMS_PROJECT_ROOT = originalRoot;
	if (originalDevices === undefined) delete process.env.AGENTSIMS_RN_DEVICES;
	else process.env.AGENTSIMS_RN_DEVICES = originalDevices;
	if (originalManifest === undefined) delete process.env.AGENTSIMS_RN_MANIFEST;
	else process.env.AGENTSIMS_RN_MANIFEST = originalManifest;
	for (const manifest of manifests) {
		try {
			unlinkSync(manifest);
		} catch (error) {
			console.warn(
				"[agentsims:test] recoverable setup or cleanup failure",
				error,
			);
		}
	}
	manifests.clear();
});

describe("React Native source context", () => {
	test("conditional source requests do not reuse another project's validator", async () => {
		const directory = mkdtempSync(
			join(tmpdir(), "agentsims-source-validator-"),
		);
		const servers: Awaited<ReturnType<typeof startTestServer>>[] = [];
		try {
			for (const [name, source] of [
				["a", "aaa"],
				["b", "bbb"],
			] as const) {
				const root = join(directory, name);
				mkdirSync(root);
				const file = join(root, "App.tsx");
				writeFileSync(file, source + "\n");
				utimesSync(file, 1700000000, 1700000000);
				useManifest(
					[
						{
							testID: "shared",
							tag: "Text",
							file: "App.tsx",
							absoluteFile: file,
							line: 1,
						},
					],
					root,
				);
				servers.push(await startTestServer({ device: "source-fixture" }));
			}
			const path = "/source?testID=shared&file=App.tsx&line=1";
			const first = await fetch(servers[0]!.origin + path);
			expect(first.status).toBe(200);
			const validator = first.headers.get("etag")!;
			expect((await first.json()).lines).toEqual(["aaa", ""]);
			const second = await fetch(servers[1]!.origin + path, {
				headers: { "if-none-match": validator },
			});
			expect(second.status).toBe(200);
			expect(second.headers.get("etag")).not.toBe(validator);
			expect((await second.json()).lines).toEqual(["bbb", ""]);
			const own = await fetch(servers[0]!.origin + path, {
				headers: { "if-none-match": validator },
			});
			expect(own.status).toBe(304);
		} finally {
			for (const { server } of servers) await server.stop();
			rmSync(directory, { recursive: true, force: true });
		}
	});
	test("two live servers retain separate source contexts", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agentsims-two-projects-"));
		const servers: Awaited<ReturnType<typeof startTestServer>>[] = [];
		try {
			for (const name of ["first", "second"]) {
				const root = join(directory, name);
				mkdirSync(root);
				const file = join(root, "App.tsx");
				writeFileSync(file, `export const project = "${name}";\n`);
				useManifest(
					[
						{
							testID: "shared",
							tag: "Pressable",
							file: "App.tsx",
							absoluteFile: file,
							line: 1,
						},
					],
					root,
				);
				servers.push(await startTestServer({ device: "source-fixture" }));
			}
			for (const [index, server] of servers.entries()) {
				const name = index === 0 ? "first" : "second";
				const own = join(directory, name, "App.tsx");
				const foreign = join(
					directory,
					index === 0 ? "second" : "first",
					"App.tsx",
				);
				const query = (file: string) =>
					new URLSearchParams({ testID: "shared", file, line: "1" });
				const response = await fetch(`${server.origin}/source?${query(own)}`);
				expect(response.status).toBe(200);
				expect((await response.json()).lines).toEqual([
					`export const project = "${name}";`,
					"",
				]);
				expect(
					(await fetch(`${server.origin}/source?${query(foreign)}`)).status,
				).toBe(404);
			}
		} finally {
			for (const { server } of servers) await server.stop();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test.serial.each(["home-dir", "legacy-home", "both", "default"])(
		"producer and runtime share canonical project identity and %s manifest location",
		(homeMode) => {
			const directory = mkdtempSync(
				join(tmpdir(), "agentsims-project-boundary-"),
			);
			const root = join(directory, "project");
			const alias = join(directory, "project-link");
			const original = {
				AGENTSIMS_HOME_DIR: process.env.AGENTSIMS_HOME_DIR,
				AGENTSIMS_HOME: process.env.AGENTSIMS_HOME,
				AGENTSIMS_RN_APP_IDS: process.env.AGENTSIMS_RN_APP_IDS,
			};
			try {
				mkdirSync(root);
				symlinkSync(
					root,
					alias,
					process.platform === "win32" ? "junction" : "dir",
				);
				delete process.env.AGENTSIMS_HOME_DIR;
				delete process.env.AGENTSIMS_HOME;
				delete process.env.AGENTSIMS_RN_MANIFEST;
				if (homeMode === "home-dir" || homeMode === "both")
					process.env.AGENTSIMS_HOME_DIR = join(directory, "current home");
				if (homeMode === "legacy-home" || homeMode === "both")
					process.env.AGENTSIMS_HOME = join(directory, "legacy home");
				process.env.AGENTSIMS_PROJECT_ROOT = alias;
				process.env.AGENTSIMS_RN_APP_IDS = JSON.stringify(["dev.example.app"]);
				process.env.AGENTSIMS_RN_DEVICES = JSON.stringify([
					"ios-fixture",
					"android:emulator-5554",
				]);
				const producer = producerProjectContext(root, {
					appIds: ["dev.example.app"],
					devices: ["ios-fixture", "android:emulator-5554"],
				});
				const runtime = rnProjectContextFromEnvironment();
				const canonicalRoot = realpathSync(root);
				const expectedKey = createHash("sha1")
					.update(canonicalRoot.replace(/\\/g, "/"))
					.digest("hex")
					.slice(0, 12);
				const expectedHome =
					homeMode === "default"
						? join(homedir(), ".agentsims")
						: join(
								directory,
								homeMode === "legacy-home" ? "legacy home" : "current home",
							);
				expect(producer.projectRoot).toBe(canonicalRoot);
				expect(producer.projectKey).toBe(expectedKey);
				expect(producer.manifestPath).toBe(
					resolve(expectedHome, "projects", expectedKey, "rn-source-map.jsonl"),
				);
				expect(agentsimsHome()).toBe(expectedHome);
				expect(runtime).toEqual(producer);
			} finally {
				for (const [name, value] of Object.entries(original)) {
					if (value === undefined) delete process.env[name];
					else process.env[name] = value;
				}
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);

	test("uses a project-specific default manifest", () => {
		delete process.env.AGENTSIMS_RN_MANIFEST;
		process.env.AGENTSIMS_PROJECT_ROOT = "/repo";
		expect(rnSourceManifestPath()).toBe(
			createRnProjectContext("/repo").manifestPath,
		);
	});

	test("derives Expo Router paths without route groups or layouts", () => {
		expect(expoRoute("app/(tabs)/checkout/index.tsx")).toBe("/checkout");
		expect(expoRoute("src/app/_layout.tsx")).toBe("/");
		expect(expoRoute("src/components/Button.tsx")).toBeUndefined();
	});

	test("enriches a native target with actionable RN ownership metadata", () => {
		useManifest([
			{
				testID: "ags_pay",
				tag: "Pressable",
				elementKind: "host",
				file: "app/(tabs)/checkout.tsx",
				absoluteFile: "/repo/app/(tabs)/checkout.tsx",
				line: 88,
				column: 5,
				componentName: "PayButton",
				ownerStack: ["CheckoutScreen", "PaymentFooter", "PayButton"],
				route: "/checkout",
				visibleText: "Pay now",
				props: { accessibilityRole: "button", disabled: false },
				injected: true,
			},
		]);
		const snapshot: AxSnapshot = {
			screen: { width: 390, height: 844 },
			elements: [
				{
					id: "ai.puch:id/ags_pay",
					path: "/0/2/4",
					label: "Pay now",
					value: "",
					role: "button",
					type: "android.widget.Button",
					enabled: true,
					frame: { x: 24, y: 612, width: 342, height: 52 },
					nativeId: "ai.puch:id/ags_pay",
				},
			],
		};

		const enriched = enrichAxSnapshotWithRnSource(snapshot);

		expect(enriched.elements[0]?.source).toMatchObject({
			testID: "ags_pay",
			elementKind: "host",
			componentName: "PayButton",
			ownerStack: ["CheckoutScreen", "PaymentFooter", "PayButton"],
			route: "/checkout",
			visibleText: "Pay now",
			props: { accessibilityRole: "button", disabled: false },
		});
	});

	test("serves and revalidates the complete approved source file", async () => {
		const sourceFile = join(
			tmpdir(),
			`agentsims-source-route-${process.pid}-${manifestSequence}.tsx`,
		);
		writeFileSync(
			sourceFile,
			[
				"export function Composer() {",
				'  return <Textarea testID="composer" />;',
				"}",
			].join("\n"),
		);
		manifests.add(sourceFile);
		useManifest(
			[
				{
					testID: "composer",
					tag: "Textarea",
					file: "src/chat/Composer.tsx",
					absoluteFile: sourceFile,
					line: 2,
					componentName: "Textarea",
				},
			],
			tmpdir(),
		);
		const query = new URLSearchParams({
			testID: "composer",
			file: sourceFile,
			line: "2",
		});

		const response = await getFromMiddleware(`/source?${query}`);
		expect(response.status).toBe(200);
		const source = JSON.parse(response.body) as {
			startLine: number;
			lines: string[];
			cacheKey: string;
		};
		expect(source.startLine).toBe(1);
		expect(source.lines).toHaveLength(3);
		expect(source.lines.join("\n")).toContain("Textarea");
		expect(source.cacheKey.length).toBeGreaterThan(0);
		const etag = response.headers.ETag;
		expect(etag).toBe(JSON.stringify(source.cacheKey));
		const revalidated = await getFromMiddleware(`/source?${query}`, {
			"if-none-match": etag!,
		});
		expect(revalidated.status).toBe(304);
		expect(revalidated.body).toBe("");
	});

	test("matches an Android leaf through a nearby injected source carrier", () => {
		useManifest([
			{
				testID: "ags_message",
				tag: "TextInput",
				file: "components/composer/composer.tsx",
				absoluteFile: "/repo/components/composer/composer.tsx",
				line: 38,
				column: 9,
				componentName: "Composer",
				ownerStack: ["ChatScreen", "Composer"],
				route: "/chat",
				props: { placeholder: "Ask Vartalaap" },
				injected: true,
			},
		]);
		const snapshot: AxSnapshot = {
			screen: { width: 1080, height: 2400 },
			elements: [
				{
					id: "ai.vartalaap:id/ags_message",
					path: "37",
					label: "",
					value: "",
					role: "android.view.View",
					type: "android.view.View",
					enabled: true,
					frame: { x: 70, y: 2090, width: 940, height: 108 },
					testId: "ai.vartalaap:id/ags_message",
					nativeId: "ai.vartalaap:id/ags_message",
				},
				{
					id: "emulator-5554:38",
					path: "38",
					label: "Ask Vartalaap",
					value: "Ask Vartalaap",
					role: "android.widget.EditText",
					type: "android.widget.EditText",
					enabled: true,
					frame: { x: 71, y: 2091, width: 940, height: 105 },
				},
			],
		};

		const enriched = enrichAxSnapshotWithRnSource(snapshot);

		expect(enriched.elements[1]?.source).toMatchObject({
			confidence: "related-native-id",
			matchReason: "nearby-placeholder",
			testID: "ags_message",
			componentName: "Composer",
			file: "components/composer/composer.tsx",
			line: 38,
		});
	});

	test("inherits an unambiguous RN owner through the native hierarchy", () => {
		useManifest([
			{
				testID: "ags_checkout",
				tag: "Pressable",
				file: "components/checkout-button.tsx",
				line: 24,
				componentName: "CheckoutButton",
				injected: true,
			},
		]);
		const snapshot: AxSnapshot = {
			screen: { width: 390, height: 844 },
			elements: [
				{
					id: "app:id/ags_checkout",
					path: "0.1",
					label: "",
					value: "",
					role: "android.view.View",
					type: "android.view.View",
					enabled: true,
					frame: { x: 24, y: 700, width: 342, height: 52 },
					nativeId: "app:id/ags_checkout",
				},
				{
					id: "emulator-5554:0.1.0",
					path: "0.1.0",
					label: "",
					value: "",
					role: "android.widget.TextView",
					type: "android.widget.TextView",
					enabled: true,
					frame: { x: 40, y: 714, width: 180, height: 24 },
				},
			],
		};

		const enriched = enrichAxSnapshotWithRnSource(snapshot);

		expect(enriched.elements[1]?.source).toMatchObject({
			confidence: "related-native-id",
			matchReason: "ancestor-owner",
			testID: "ags_checkout",
			componentName: "CheckoutButton",
			file: "components/checkout-button.tsx",
			line: 24,
		});
	});

	test("does not attach a broad injected container to an unrelated leaf", () => {
		useManifest([
			{
				testID: "ags_panel",
				tag: "View",
				file: "components/panel.tsx",
				line: 12,
				componentName: "Panel",
				injected: true,
			},
		]);
		const snapshot: AxSnapshot = {
			screen: { width: 1080, height: 2400 },
			elements: [
				{
					id: "ai.vartalaap:id/ags_panel",
					path: "10",
					label: "",
					value: "",
					role: "android.view.View",
					type: "android.view.View",
					enabled: true,
					frame: { x: 0, y: 200, width: 1080, height: 1800 },
					nativeId: "ai.vartalaap:id/ags_panel",
				},
				{
					id: "emulator-5554:11",
					path: "11",
					label: "Delete account",
					value: "Delete account",
					role: "android.widget.TextView",
					type: "android.widget.TextView",
					enabled: true,
					frame: { x: 48, y: 1750, width: 320, height: 64 },
				},
			],
		};

		const enriched = enrichAxSnapshotWithRnSource(snapshot);

		expect(enriched.elements[1]?.source).toBeUndefined();
	});

	test("does not choose between equally plausible nearby source owners", () => {
		useManifest([
			{
				testID: "ags_first",
				tag: "Text",
				file: "components/first.tsx",
				line: 10,
				componentName: "FirstLabel",
				visibleText: "Continue",
				injected: true,
			},
			{
				testID: "ags_second",
				tag: "Text",
				file: "components/second.tsx",
				line: 20,
				componentName: "SecondLabel",
				visibleText: "Continue",
				injected: true,
			},
		]);
		const frame = { x: 40, y: 600, width: 300, height: 52 };
		const snapshot: AxSnapshot = {
			screen: { width: 390, height: 844 },
			elements: [
				{
					id: "app:id/ags_first",
					path: "20",
					label: "",
					value: "",
					role: "android.view.View",
					type: "android.view.View",
					enabled: true,
					frame,
					nativeId: "app:id/ags_first",
				},
				{
					id: "app:id/ags_second",
					path: "21",
					label: "",
					value: "",
					role: "android.view.View",
					type: "android.view.View",
					enabled: true,
					frame,
					nativeId: "app:id/ags_second",
				},
				{
					id: "emulator-5554:22",
					path: "22",
					label: "Continue",
					value: "Continue",
					role: "android.widget.TextView",
					type: "android.widget.TextView",
					enabled: true,
					frame,
				},
			],
		};

		const enriched = enrichAxSnapshotWithRnSource(snapshot);

		expect(enriched.elements[2]?.source).toBeUndefined();
	});

	test("does not claim an exact testID duplicated by different source owners", () => {
		useManifest([
			{
				testID: "shared-action",
				tag: "Pressable",
				file: "components/primary-action.tsx",
				line: 10,
				componentName: "PrimaryAction",
			},
			{
				testID: "shared-action",
				tag: "Pressable",
				file: "components/secondary-action.tsx",
				line: 24,
				componentName: "SecondaryAction",
			},
		]);
		const snapshot: AxSnapshot = {
			screen: { width: 390, height: 844 },
			elements: [
				{
					id: "shared-action",
					path: "4",
					label: "Continue",
					value: "",
					role: "button",
					type: "android.widget.Button",
					enabled: true,
					frame: { x: 24, y: 612, width: 342, height: 52 },
					testId: "shared-action",
				},
			],
		};

		const enriched = enrichAxSnapshotWithRnSource(snapshot);

		expect(enriched.elements[0]?.source).toBeUndefined();
	});
});
