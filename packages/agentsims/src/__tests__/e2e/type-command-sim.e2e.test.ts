import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { DeviceSession as IosDeviceSession } from "../../core/ios/session";
import {
	acquireIosSimulatorTestLock,
	IOS_E2E_HOOK_TIMEOUT_MS,
} from "../helpers/ios-e2e-lock";
import {
	explicitAndroidDevice,
	explicitIosDevice,
	runSourceCli,
	startOwnedE2EServer,
	type OwnedE2EServer,
} from "../helpers/native-e2e";

type Node = {
	ref: string;
	role: string;
	label: string;
	value: string;
	states?: string[];
	children?: Node[];
};

type Observation = {
	observationId: string | null;
	captureId: string | null;
	accessibility: { status: string };
	image: { status: string };
	artifact?: { status: string; path?: string };
	view: { app?: string | null; nodes: Node[] } | null;
};

type TextResult = {
	dispatch: { status: string };
	verification: {
		status: string;
		observed?: { expected: string; value: string };
	};
	text: {
		expected: string | null;
		value: string | null;
		submit: { requested: boolean; status: string };
	};
};

const platforms = [
	...(explicitIosDevice
		? [
				{
					platform: "ios" as const,
					device: explicitIosDevice,
					app:
						process.env.AGENTSIMS_E2E_APP_ID?.trim() ||
						"com.apple.Preferences",
					field: process.env.AGENTSIMS_E2E_TEXT_TARGET?.trim() || "Search",
				},
			]
		: []),
	...(explicitAndroidDevice
		? [
				{
					platform: "android" as const,
					device: explicitAndroidDevice,
					app: "com.android.settings",
					field: process.env.AGENTSIMS_E2E_TEXT_TARGET?.trim() || "Search",
				},
			]
		: []),
];
const describeConfigured = platforms.length > 0 ? describe : describe.skip;

function flatten(nodes: Node[]): Node[] {
	return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

async function cliJson<T>(server: OwnedE2EServer, args: string[]): Promise<T> {
	const result = await runSourceCli(server, [...args, "--json"]);
	if (result.exitCode !== 0)
		throw new Error(
			`agentsims ${args.join(" ")} failed.\n${result.stderr}\n${result.stdout}`,
		);
	return JSON.parse(result.stdout) as T;
}

async function observe(
	server: OwnedE2EServer,
	device: string,
): Promise<Observation> {
	return cliJson(server, ["observe", "-d", device, "--all"]);
}

function fieldIn(observation: Observation, target?: string): Node | null {
	const fields = flatten(observation.view?.nodes ?? []).filter(
		(node) => node.role === "textbox",
	);
	if (!target) return fields[0] ?? null;
	const expected = target.toLowerCase();
	return (
		fields.find((node) =>
			[node.label, node.value].some((value) =>
				value.toLowerCase().includes(expected),
			),
		) ?? null
	);
}

async function prepareField(
	server: OwnedE2EServer,
	platform: "android" | "ios",
	device: string,
	app: string,
	target: string,
): Promise<{ observation: Observation; field: Node }> {
	for (const operation of ["stop", "launch"] as const) {
		const result = await runSourceCli(server, [
			"app",
			operation,
			app,
			"-d",
			device,
			"--json",
		]);
		if (result.exitCode !== 0) {
			const output = JSON.parse(result.stdout) as {
				dispatch?: { status?: string };
				verification?: { status?: string };
			};
			if (
				output.dispatch?.status !== "accepted" &&
				!(operation === "stop" && output.verification?.status === "matched")
			)
				throw new Error(
					`agentsims app ${operation} failed.\n${result.stderr}\n${result.stdout}`,
				);
		}
	}
	const deadline = Date.now() + 60_000;
	let lastObservation: Observation | null = null;
	while (Date.now() < deadline) {
		const observation = await observe(server, device);
		lastObservation = observation;
		const activeApp = observation.view?.app;
		if (
			activeApp !== app &&
			!(
				platform === "android" &&
				activeApp === "com.google.android.settings.intelligence"
			)
		) {
			await Bun.sleep(250);
			continue;
		}
		const field = fieldIn(observation, target);
		if (field) return { observation, field };
		const nodes = observation.view?.nodes ?? [];
		const searchText = flatten(nodes).find(
			(node) => platform === "android" && /^Search settings$/i.test(node.label),
		);
		const searchContainer = searchText
			? flatten(nodes)
					.filter((node) =>
						flatten(node.children ?? []).some(
							(child) => child.ref === searchText.ref,
						),
					)
					.at(-1)
			: null;
		const search = flatten(searchContainer?.children ?? []).find(
			(node) => node.role === "button",
		);
		if (search) {
			await cliJson(server, ["tap", `@${search.ref}`, "-d", device]);
			await Bun.sleep(250);
			continue;
		}
		await Bun.sleep(250);
	}
	throw new Error(
		`No editable field matching ${JSON.stringify(target)} became available on ${device}. ` +
			`Foreground app: ${lastObservation?.view?.app ?? "unknown"}. ` +
			`Nodes: ${JSON.stringify(flatten(lastObservation?.view?.nodes ?? []).map(({ role, label }) => ({ role, label })))}`,
	);
}

function expectMatched(result: TextResult, expected: string): void {
	expect(result.dispatch.status).toBe("accepted");
	expect(result.verification.status).toBe("matched");
	expect(result.verification.observed).toMatchObject({
		expected,
		value: expected,
	});
	expect(result.text.expected).toBe(expected);
	expect(result.text.value).toBe(expected);
}

describeConfigured("real mobile text loop", () => {
	let server: OwnedE2EServer;
	let releaseIosLock = () => {};

	beforeAll(async () => {
		if (explicitIosDevice)
			releaseIosLock = await acquireIosSimulatorTestLock(explicitIosDevice);
		server = await startOwnedE2EServer();
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	afterAll(async () => {
		try {
			await server?.stop();
		} finally {
			releaseIosLock();
		}
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	for (const target of platforms) {
		test(`${target.platform} proves target, focus, replacement, insertion, rejection, submit, and capture`, async () => {
			const prepared = await prepareField(
				server,
				target.platform,
				target.device,
				target.app,
				target.field,
			);
			expect(prepared.observation.observationId).toBeTruthy();
			expect(prepared.observation.captureId).toBeTruthy();
			expect(prepared.observation.accessibility.status).toBe("ok");
			expect(prepared.observation.image.status).toBe("ok");
			expect(prepared.observation.artifact?.status).toBe("ok");
			expect(
				prepared.observation.artifact?.path &&
					existsSync(prepared.observation.artifact.path),
			).toBe(true);

			if (target.platform === "ios") {
				const raw = await fetch(
					`${server.origin}/helper/${encodeURIComponent(target.device)}/ax?mode=fresh`,
				);
				expect(raw.status).toBe(200);
				expect(Array.isArray(await raw.json())).toBe(true);
			}

			const first = await cliJson<TextResult>(server, [
				"fill",
				"AgentSimsOne",
				"--into",
				`@${prepared.field.ref}`,
				"-d",
				target.device,
			]);
			expectMatched(first, "AgentSimsOne");

			const stale = await runSourceCli(server, [
				"fill",
				"stale",
				"--into",
				`@${prepared.field.ref}`,
				"-d",
				target.device,
				"--json",
			]);
			expect(stale.exitCode).not.toBe(0);

			const focusedObservation = await observe(server, target.device);
			const focused = fieldIn(focusedObservation);
			expect(focused).not.toBeNull();
			expect(focused?.states).toContain("focused");
			const repeated = await cliJson<TextResult>(server, [
				"fill",
				"AgentSimsTwo",
				"--into",
				`@${focused!.ref}`,
				"-d",
				target.device,
			]);
			expectMatched(repeated, "AgentSimsTwo");

			const insertion =
				target.platform === "android"
					? "A:+_?file:///sdcard/Download/task.html"
					: "x";
			const inserted = await cliJson<TextResult>(server, [
				"type",
				insertion,
				"-d",
				target.device,
			]);
			expectMatched(inserted, `AgentSimsTwo${insertion}`);

			const replaced = await cliJson<TextResult>(server, [
				"fill",
				"AgentSimsReplace",
				"-d",
				target.device,
			]);
			expectMatched(replaced, "AgentSimsReplace");

			if (target.platform === "ios") {
				const adapter = new IosDeviceSession(target.device);
				try {
					const nativeField = await adapter.readFocusedField();
					expect(nativeField).toMatchObject({
						focused: true,
						value: "AgentSimsReplace",
						selection: { start: 16, end: 16 },
					});
					expect(nativeField?.identity?.id).toBeTruthy();
					expect(nativeField?.identity?.path).toBeUndefined();
				} finally {
					await adapter.close();
				}
			}

			const current = await observe(server, target.device);
			const wrong = flatten(current.view?.nodes ?? []).find(
				(node) => node.role === "button",
			);
			expect(wrong).toBeDefined();
			const refused = await runSourceCli(server, [
				"fill",
				"wrong",
				"--into",
				`@${wrong!.ref}`,
				"-d",
				target.device,
				"--json",
			]);
			expect(refused.exitCode).not.toBe(0);

			const submitted = await cliJson<TextResult>(server, [
				"fill",
				"AgentSimsSubmit",
				"--submit",
				"-d",
				target.device,
			]);
			expectMatched(submitted, "AgentSimsSubmit");
			expect(submitted.text.submit).toMatchObject({
				requested: true,
				status: "accepted",
			});
		}, 180_000);
	}
});
