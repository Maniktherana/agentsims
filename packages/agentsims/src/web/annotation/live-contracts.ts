import type { ContextInput } from "../../core/tools/context/contracts";
import type {
	AnnotationGeometry,
	AnnotationIdentity,
	AnnotationPoint,
	AnnotationSelection,
	AnnotationSelectionCache,
} from "./contracts";
import type { RenderedScreenshot } from "../simulator/screenshot/rendered-screenshot";
import type {
	AxRect,
	AxSnapshot,
} from "../../core/tools/observe/accessibility-model";

export type AnnotationEvidence = Extract<ContextInput, { kind: "annotation" }>;
export const ANNOTATION_NOTE_CHARACTER_LIMIT = 4096;

export interface AnnotationNativePreview {
	readonly snapshot: AxSnapshot | null;
	readonly identity: AnnotationIdentity;
	readonly status: string;
	readonly connected: boolean;
}

export interface LiveAnnotationNote {
	readonly id: string;
	readonly deviceName?: string;
	readonly state: "draft" | "saved";
	readonly note: string;
	readonly selection: AnnotationSelection;
	readonly imageSize: { readonly width: number; readonly height: number };
	readonly evidence: AnnotationEvidence;
}

export interface AnnotationSendPayload {
	readonly prompt: string;
	readonly retainedContext?: {
		readonly workspace: string;
		readonly ids: readonly string[];
		readonly prompt: string;
	};
	readonly images: readonly {
		readonly id: string;
		readonly mimeType: "image/png" | "image/jpeg";
		readonly width: number;
		readonly height: number;
		readonly base64: string;
	}[];
}

export interface AnnotationSendResult {
	status: "sent" | "unavailable" | "failed" | "unknown";
	message?: string;
}

export interface AnnotationContextClient {
	create(
		workspace: string,
		input: AnnotationEvidence,
		requestId: string,
	): Promise<{ id: string }>;
	update(workspace: string, id: string, note: string): Promise<unknown>;
	save(workspace: string, id: string): Promise<unknown>;
	remove(workspace: string, id: string): Promise<unknown>;
}

export interface LiveAnnotationOptions {
	active: boolean;
	deviceName?: string | null;
	identity: AnnotationIdentity;
	cache: AnnotationSelectionCache | null;
	nativePreview?: AnnotationNativePreview;
	/** All coordinates refer to browser client pixels. */
	geometry: AnnotationGeometry | null;
	/** Must read the frame already on screen synchronously. */
	capturePresentedSurface: () => RenderedScreenshot | null;
	onEndSelection: () => void;
	workspace?: string;
	basePath?: string;
	/** Supply only for a real, currently available host capability. */
	send?: (payload: AnnotationSendPayload) => Promise<AnnotationSendResult>;
	contextClient?: AnnotationContextClient;
	copy?: (payload: AnnotationSendPayload) => Promise<void>;
	now?: () => number;
	onSummaryChange?: (
		deviceId: string,
		summary: LiveAnnotationSummaryController | null,
	) => void;
}

export interface LiveAnnotationSnapshot {
	readonly device: string;
	readonly active: boolean;
	readonly inputDisabled: boolean;
	readonly selecting: boolean;
	readonly hoverTarget: AnnotationSelection | null;
	readonly notes: readonly LiveAnnotationNote[];
	readonly comments: readonly LiveAnnotationNote[];
	readonly draft: LiveAnnotationNote | null;
	readonly editor: LiveAnnotationNote | null;
	readonly listOpen: boolean;
	readonly status: string;
	readonly copying: boolean;
	readonly sending: boolean;
	readonly canSend: boolean;
	readonly selectingEnded: boolean;
}

export interface LiveAnnotationController extends LiveAnnotationSnapshot {
	hover: (point: AnnotationPoint | null) => void;
	select: (point: AnnotationPoint) => void;
	setNote: (note: string) => void;
	saveDraft: () => void;
	retainDraft: () => void;
	closeEditor: () => void;
	escape: () => void;
	endSelection: () => void;
	editNote: (id: string) => void;
	removeNote: (id: string) => void;
	clearCopiedNotes: (notes: readonly LiveAnnotationNote[]) => void;
	toggleList: () => void;
	noteViewportRect: (note: LiveAnnotationNote) => AxRect | null;
	copyPrompt: () => Promise<void>;
	sendPrompt: () => Promise<void>;
	prepareSendPayload: () => Promise<AnnotationSendPayload | null>;
}

export interface LiveAnnotationSummaryController {
	readonly device: string;
	readonly editorId: string | null;
	readonly comments: readonly LiveAnnotationNote[];
	readonly copying: boolean;
	readonly sending: boolean;
	readonly canSend: boolean;
	readonly status: string;
	editNote: (id: string) => void;
	closeEditor: () => void;
	endSelection: () => void;
	removeNote: (id: string) => void;
	clearCopiedNotes: (notes: readonly LiveAnnotationNote[]) => void;
	prepareSendPayload: () => Promise<AnnotationSendPayload | null>;
}
