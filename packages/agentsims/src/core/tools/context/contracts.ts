import type { AxElement, AxRect } from "../observe/accessibility-model";
import type { LogRecord } from "../logs/contracts";

export const CONTEXT_LIMITS = Object.freeze({
	itemsPerWorkspace: 32,
	bytesTotal: 64 * 1024 * 1024,
	imageBytes: 8 * 1024 * 1024,
	noteCharacters: 4096,
	logs: 200,
	logBytes: 64 * 1024,
	sourceLines: 41,
	sourceBytes: 32 * 1024,
	targetBytes: 32 * 1024,
});

/** Pixels refer to the captured image, never to the current live screen. */
export type ContextTarget = {
	readonly rect: AxRect;
} & (
	| { readonly kind: "region"; readonly reason: string }
	| {
			readonly kind: "element";
			readonly revision: number;
			readonly collectedAt: number;
			readonly app: string;
			readonly orientation: string;
			readonly element: AxElement;
	  }
);

export type ContextImage = {
	readonly mimeType: "image/png" | "image/jpeg";
	readonly width: number;
	readonly height: number;
	readonly base64: string;
};

export type ContextSource = {
	readonly projectKey: string;
	readonly testID: string;
	readonly file: string;
	readonly line: number;
	readonly startLine: number;
	readonly lines: readonly string[];
};

type ContextBase = {
	readonly device: string;
	readonly platform: "ios" | "android";
	readonly capturedAt: number;
	readonly note: string;
	readonly logs: readonly LogRecord[];
};

export type ContextInput = ContextBase &
	(
		| {
				readonly kind: "annotation";
				readonly sessionId: string;
				readonly target: ContextTarget;
				readonly image: ContextImage;
				readonly source?: ContextSource;
		  }
		| { readonly kind: "logs" }
	);

export type ContextItem = ContextInput & {
	readonly id: string;
	readonly workspace: string;
	readonly state: "draft" | "saved";
	readonly createdAt: number;
	readonly updatedAt: number;
};

export class ContextError extends Error {
	constructor(
		readonly code: "invalid" | "limit" | "missing" | "closed",
		message: string,
	) {
		super(message);
		this.name = "ContextError";
	}
}
