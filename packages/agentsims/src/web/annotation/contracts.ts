import type {
	AxElement,
	AxRect,
	AxSnapshot,
} from "../../core/tools/observe/accessibility-model";
import type { SimulatorOrientation } from "../simulator/types";

export interface AnnotationSize {
	width: number;
	height: number;
}

export interface AnnotationPoint {
	x: number;
	y: number;
}

export type AnnotationRotation = 0 | 90 | 180 | 270;

/** Rotations are clockwise. The viewport contains the presented image. */
export interface AnnotationGeometry {
	viewport: AxRect;
	image: AnnotationSize;
	axScreen: AnnotationSize;
	imageRotation?: AnnotationRotation;
	axToImageRotation?: AnnotationRotation;
	/** The visible CSS rectangle after an ancestor clips the image. */
	clip?: AxRect;
}

export interface AnnotationIdentity {
	device: string;
	sessionId: string;
	platform: "ios" | "android";
	app: string | null;
	orientation: SimulatorOrientation | null;
}

export interface AnnotationCacheMetadata extends AnnotationIdentity {
	revision: number;
	collectedAt: number;
	connected: boolean;
	dirty: boolean;
	confirmedUnchanged: boolean;
}

export interface AnnotationCachedElement {
	readonly key: string;
	readonly element: AxElement;
	readonly frame: AxRect;
	readonly parentKeys: readonly string[];
	readonly windowKey: string;
	readonly meaningful: boolean;
}

export interface AnnotationCachedWindow {
	readonly key: string;
	readonly frame: AxRect | null;
	readonly layer: number | null;
	readonly active: boolean;
	readonly focused: boolean;
}

/** Build once for each cache revision. Its contents are detached and frozen. */
export interface AnnotationSpatialSnapshot {
	readonly snapshot: AxSnapshot;
	readonly elements: readonly AnnotationCachedElement[];
	readonly windows: readonly AnnotationCachedWindow[];
}

export interface AnnotationSelectionCache extends AnnotationSpatialSnapshot {
	readonly metadata: Readonly<AnnotationCacheMetadata>;
}

export type AnnotationFallbackReason =
	| "missing-tree"
	| "unavailable-tree"
	| "disconnected"
	| "dirty-tree"
	| "stale-tree"
	| "invalid-time"
	| "unknown-identity"
	| "device-changed"
	| "session-changed"
	| "app-changed"
	| "orientation-changed"
	| "platform-changed"
	| "revision-changed"
	| "geometry-changed"
	| "ambiguous-window"
	| "no-target";

export interface AnnotationElementTarget {
	readonly key: string;
	readonly element: AxElement;
	readonly axScreen: AnnotationSize;
	readonly imageRect: AxRect;
	readonly viewportRect: AxRect;
}

export interface AnnotationElementSelection extends AnnotationElementTarget {
	readonly kind: "element";
	readonly identity: Readonly<AnnotationIdentity>;
	readonly metadata: Readonly<AnnotationCacheMetadata>;
	/** The selected leaf followed by its visible ancestors. */
	readonly candidates: readonly AnnotationElementTarget[];
	readonly candidateIndex: number;
}

export interface AnnotationRegionSelection {
	readonly kind: "region";
	readonly identity: Readonly<AnnotationIdentity>;
	readonly coordinateSpace: "image-pixels";
	readonly rect: AxRect;
	readonly viewportRect: AxRect;
	readonly reason: AnnotationFallbackReason;
	/** Captured native label for presentation; this does not prove element identity. */
	readonly previewLabel?: string;
}

export type AnnotationSelection =
	| AnnotationElementSelection
	| AnnotationRegionSelection;

export interface AnnotationSelectionInput {
	identity: AnnotationIdentity;
	cache: AnnotationSelectionCache | null;
	geometry: AnnotationGeometry;
	point: AnnotationPoint;
	now: number;
	/** The fallback rectangle in CSS pixels. The default is 32 by 32. */
	regionSize?: AnnotationSize;
}
