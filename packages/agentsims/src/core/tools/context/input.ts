import { z } from "zod";
import type { AxElement } from "../observe/accessibility-model";
import { LOG_LEVELS, LOG_SOURCES } from "../logs/contracts";
import { ContextError, CONTEXT_LIMITS } from "./contracts";
import type { ContextInput } from "./contracts";

const identifier = z.string().trim().min(1).max(256);
const time = z.number().finite().nonnegative();
const logText = (characters: number) =>
	z
		.string()
		.max(characters * 2)
		.refine((value) => Array.from(value).length <= characters);
const rect = z
	.object({
		x: z.number().finite().nonnegative(),
		y: z.number().finite().nonnegative(),
		width: z.number().finite().positive(),
		height: z.number().finite().positive(),
	})
	.strict();
const element = z
	.object({
		id: identifier,
		path: z.string().max(4096),
		label: z.string(),
		value: z.string(),
		role: z.string(),
		type: z.string(),
		enabled: z.boolean(),
		frame: z
			.object({
				x: z.number().finite(),
				y: z.number().finite(),
				width: z.number().finite().nonnegative(),
				height: z.number().finite().nonnegative(),
			})
			.strict(),
	})
	.passthrough()
	.transform((value) => value as unknown as AxElement);
const log = z
	.object({
		id: z.string().min(1).max(4120),
		cursor: z
			.object({
				epoch: z.string().min(1).max(4096),
				sequence: z.number().int().nonnegative(),
			})
			.strict(),
		device: identifier,
		platform: z.enum(["ios", "android"]),
		source: z.enum(LOG_SOURCES),
		receivedAt: time,
		sourceTime: z
			.object({ text: logText(512), epochMs: time.optional() })
			.strict()
			.optional(),
		level: z.enum(LOG_LEVELS),
		nativeLevel: logText(64).optional(),
		message: logText(4096),
		app: logText(512).optional(),
		projectId: logText(512).optional(),
		pid: z.number().int().positive().optional(),
		tid: z.number().int().nonnegative().optional(),
		tag: z.string().max(1024).optional(),
		process: z.string().max(1024).optional(),
		stack: z.string().max(16384).optional(),
		truncated: z.boolean(),
	})
	.strict();
const source = z
	.object({
		projectKey: identifier,
		testID: identifier,
		file: z.string().min(1).max(4096),
		line: z.number().int().positive(),
		startLine: z.number().int().positive(),
		lines: z.array(z.string()).max(CONTEXT_LIMITS.sourceLines),
	})
	.strict();
const base = {
	device: identifier,
	platform: z.enum(["ios", "android"]),
	capturedAt: time,
	note: z.string().max(CONTEXT_LIMITS.noteCharacters),
	logs: z.array(log).max(CONTEXT_LIMITS.logs),
};
const input = z.discriminatedUnion("kind", [
	z
		.object({
			...base,
			kind: z.literal("annotation"),
			sessionId: identifier,
			target: z.discriminatedUnion("kind", [
				z
					.object({ kind: z.literal("region"), rect, reason: identifier })
					.strict(),
				z
					.object({
						kind: z.literal("element"),
						rect,
						revision: z.number().int().nonnegative(),
						collectedAt: time,
						app: identifier,
						orientation: identifier,
						element,
					})
					.strict(),
			]),
			image: z
				.object({
					mimeType: z.enum(["image/png", "image/jpeg"]),
					width: z.number().int().positive(),
					height: z.number().int().positive(),
					base64: z.string(),
				})
				.strict(),
			source: source.optional(),
		})
		.strict(),
	z.object({ ...base, kind: z.literal("logs") }).strict(),
]);

export function parseContextInput(value: unknown): ContextInput {
	const result = input.safeParse(value);
	if (!result.success)
		throw new ContextError("invalid", "Invalid context data.");
	return result.data;
}

export function contextWorkspace(value: unknown): string {
	const result = identifier.safeParse(value);
	if (!result.success)
		throw new ContextError("invalid", "Workspace is required.");
	return result.data;
}
