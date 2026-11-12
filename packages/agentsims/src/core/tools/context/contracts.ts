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
	deviceNameCharacters: 256,
	structureItems: 4,
	nearbyTexts: 3,
	structureText: 160,
});

/** A described element near the target. Every field is captured app data. */
export type ContextNode = {
	readonly label?: string;
	readonly role: string;
	readonly type?: string;
	readonly testId?: string;
	/** `file:line[:column]` from source enrichment. */
	readonly source?: string;
};

export type ContextNodeList = {
	/** All matching tree links, including the ones that are not listed. */
	readonly total: number;
	readonly items: readonly ContextNode[];
};

/**
 * Structure frozen at selection time. Lists come only from real tree links.
 * Counts and strings are capped by `CONTEXT_LIMITS`.
 */
export type ContextStructure = {
	/** Nearest first. */
	readonly ancestors?: readonly ContextNode[];
	readonly siblings?: ContextNodeList;
	readonly children?: ContextNodeList;
	/** Visible text near the target, nearest first. */
	readonly nearby?: readonly string[];
	/** Position in reading order among elements that share one source or one role and label. */
	readonly instance?: {
		readonly index: number;
		readonly total: number;
		readonly basis: "source" | "label";
	};
};

/** Pixels refer to the captured image, never to the current live screen. */
export type ContextTarget = {
	readonly rect: AxRect;
} & (
	| {
			readonly kind: "region";
			readonly reason: string;
			/** A native preview label. It does not prove element identity. */
			readonly overlaps?: string;
	  }
	| {
			readonly kind: "element";
			readonly revision: number;
			readonly collectedAt: number;
			readonly app: string;
			readonly orientation: string;
			readonly element: AxElement;
			readonly structure?: ContextStructure;
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
				/** The display name of the device at capture time. */
				readonly deviceName?: string;
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
