import { afterEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
	createRnProjectContext,
	type RnProjectContext,
} from "../../../../core/react-native/source-context";
import { makeRnSources } from "../../../../core/react-native/sources";
import type { AxSnapshot } from "../../../../core/tools/observe/accessibility-model";

const directories: string[] = [];
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});

function fixture(options: { appIds?: string[]; devices?: string[] } = {}) {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-project-source-"));
	directories.push(directory);
	const root = join(directory, "project");
	mkdirSync(root);
	const file = join(root, "App.tsx");
	writeFileSync(file, "export const first = 1;\nexport const second = 2;\n");
	const project = createRnProjectContext(root, {
		...options,
		manifestPath: join(directory, "sources.jsonl"),
	});
	return { directory, root, file, project };
}

function manifest(
	project: RnProjectContext,
	file: string,
	testID = "shared",
	extra: object[] = [],
) {
	writeFileSync(
		project.manifestPath,
		[
			...extra,
			{
				projectKey: project.projectKey,
				testID,
				tag: "Pressable",
				file: "App.tsx",
				absoluteFile: file,
				line: 1,
			},
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n") + "\n",
	);
}

function snapshot(testID = "shared"): AxSnapshot {
	return {
		screen: { width: 390, height: 844 },
		elements: [
			{
				id: testID,
				testId: testID,
				path: "/0",
				label: "Continue",
				value: "",
				role: "button",
				type: "Button",
				enabled: true,
				frame: { x: 10, y: 20, width: 120, height: 44 },
			},
		],
	};
}

test("two projects with authored IDs read only their own source", async () => {
	const a = fixture({ devices: ["ios-a"] });
	const b = fixture({ devices: ["android:b"] });
	manifest(a.project, a.file, "shared", [
		{
			projectKey: b.project.projectKey,
			testID: "shared",
			tag: "Pressable",
			absoluteFile: b.file,
			file: "App.tsx",
			line: 1,
		},
	]);
	manifest(b.project, b.file);
	const sourcesA = makeRnSources(a.project, () => Effect.succeed(undefined));
	const sourcesB = makeRnSources(b.project, () => Effect.succeed(undefined));
	expect(
		(await Effect.runPromise(sourcesA.enrich("ios-a", snapshot()))).elements[0]
			?.source?.absoluteFile,
	).toBe(a.file);
	expect(
		(await Effect.runPromise(sourcesB.enrich("android:b", snapshot())))
			.elements[0]?.source?.absoluteFile,
	).toBe(b.file);
	expect(
		await Effect.runPromise(
			sourcesA.read({ testID: "shared", file: b.file, line: 1 }, "ios-a"),
		),
	).toBeNull();
	expect(
		await Effect.runPromise(
			sourcesB.read({ testID: "shared", file: a.file, line: 1 }, "android:b"),
		),
	).toBeNull();
});

test("authored IDs require an explicit device or foreground app binding", async () => {
	const f = fixture({ appIds: ["com.example.first"] });
	manifest(f.project, f.file);
	let app = "com.example.second";
	const sources = makeRnSources(f.project, () => Effect.succeed(app));
	expect(
		(await Effect.runPromise(sources.enrich("ios-a", snapshot()))).elements[0]
			?.source,
	).toBeUndefined();
	app = "com.example.first";
	expect(
		(await Effect.runPromise(sources.enrich("ios-a", snapshot()))).elements[0]
			?.source,
	).toBeDefined();
	app = "com.example.second";
	expect(
		await Effect.runPromise(
			sources.read({ testID: "shared", file: f.file, line: 1 }, "ios-a"),
		),
	).toBeNull();
});

test("generated IDs identify their registered project without an authored-ID binding", async () => {
	const f = fixture();
	const id = `ags_${f.project.projectKey}_abcdef`;
	manifest(f.project, f.file, id);
	const sources = makeRnSources(f.project, () => Effect.succeed(undefined));
	expect(
		(await Effect.runPromise(sources.enrich("android:a", snapshot(id))))
			.elements[0]?.source?.testID,
	).toBe(id);
	expect(
		(await Effect.runPromise(sources.enrich("android:a", snapshot("shared"))))
			.elements[0]?.source,
	).toBeUndefined();
});

test("an absent project leaves native inspection available and denies source reads", async () => {
	const sources = makeRnSources(null, () => Effect.succeed(undefined));
	const native = snapshot();
	expect(await Effect.runPromise(sources.enrich("ios-a", native))).toBe(native);
	expect(
		await Effect.runPromise(
			sources.read({ testID: "shared", file: "/tmp/unknown", line: 1 }),
		),
	).toBeNull();
});

test("metadata cannot approve a file outside its project or a symlink to that file", async () => {
	const f = fixture({ devices: ["ios-a"] });
	const outside = join(f.directory, "secret.tsx");
	writeFileSync(outside, "private source");
	const link = join(f.root, "linked.tsx");
	symlinkSync(outside, link);
	const directoryLink = join(f.root, "linked-directory");
	const outsideDirectory = join(f.directory, "outside");
	mkdirSync(outsideDirectory);
	symlinkSync(outsideDirectory, directoryLink);
	const brokenLink = join(f.root, "broken-link");
	symlinkSync(join(outsideDirectory, "missing"), brokenLink);
	const sources = makeRnSources(f.project, () => Effect.succeed(undefined));
	for (const file of [
		outside,
		link,
		join(directoryLink, "missing.tsx"),
		join(brokenLink, "missing.tsx"),
	]) {
		manifest(f.project, file);
		expect(
			(await Effect.runPromise(sources.enrich("ios-a", snapshot()))).elements[0]
				?.source,
		).toBeUndefined();
		expect(
			await Effect.runPromise(
				sources.read({ testID: "shared", file, line: 1 }, "ios-a"),
			),
		).toBeNull();
	}
});

test("source cache keeps the requested line and does not mutate native elements", async () => {
	const f = fixture({ devices: ["ios-a"] });
	manifest(f.project, f.file, "first", [
		{
			projectKey: f.project.projectKey,
			testID: "second",
			tag: "Text",
			absoluteFile: f.file,
			file: "App.tsx",
			line: 2,
		},
	]);
	const sources = makeRnSources(f.project, () => Effect.succeed(undefined));
	const native = snapshot("first");
	await Effect.runPromise(sources.enrich("ios-a", native));
	expect(native.elements[0]?.source).toBeUndefined();
	expect(
		(
			await Effect.runPromise(
				sources.read({ testID: "first", file: f.file, line: 1 }, "ios-a"),
			)
		)?.line,
	).toBe(1);
	expect(
		(
			await Effect.runPromise(
				sources.read({ testID: "second", file: f.file, line: 2 }, "ios-a"),
			)
		)?.line,
	).toBe(2);
});
