export const AX_UNAVAILABLE_ERROR =
	"Accessibility unavailable on this simulator.";

export interface AxRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AxSourceContext {
	kind: "react-native";
	confidence: "exact-testid" | "native-id" | "related-native-id";
	/**
	 * Whether the instrumented JSX callsite is a React Native host element or
	 * an actual custom component boundary. `componentName` is owner context for
	 * host elements; it must not be presented as that native node's identity.
	 */
	elementKind?: "host" | "custom";
	matchReason?:
		| "test-id"
		| "native-id"
		| "element-id"
		| "ancestor-owner"
		| "nearby-visible-text"
		| "nearby-accessibility-label"
		| "nearby-placeholder"
		| "nearby-carrier-text"
		| "nearby-host-type";
	testID: string;
	componentName?: string;
	ownerStack?: string[];
	elementName?: string;
	file?: string;
	absoluteFile?: string;
	line?: number;
	column?: number;
	route?: string;
	visibleText?: string;
	props?: Record<string, string | number | boolean | null>;
	injected?: boolean;
}

/** The position of a slider, progress bar, or other ranged control. */
export interface AxRange {
	current: number;
	min: number;
	max: number;
}

export interface AxElement {
	id: string;
	path: string;
	label: string;
	value: string;
	role: string;
	type: string;
	enabled: boolean;
	/** Raw Android visibility; consumers decide tree vs hit-target eligibility. */
	visibleToUser?: boolean;
	/** Present on Android top-level roots when interactive windows are available. */
	windowId?: number;
	/** Native accessibility-node identity when the platform exposes it. */
	sourceId?: number;
	windowLayer?: number;
	windowType?: number;
	windowActive?: boolean;
	windowFocused?: boolean;
	frame: AxRect;
	testId?: string;
	nativeId?: string;
	/** Present when the platform reports a value range for the control. */
	range?: AxRange;
	/** Text a field shows while empty. */
	placeholder?: string;
	/** Help or tooltip text the platform attaches to the control. */
	hint?: string;
	/** The spoken state a screen reader announces, such as "On" or "50%". */
	state?: string;
	/** Validation text a field shows. */
	error?: string;
	/** The title of a pane or region this node represents. */
	paneTitle?: string;
	heading?: boolean;
	/** The caption node that names this control, by its text. */
	labeledBy?: string;
	/** Row and column counts of a list or grid, including offscreen items. */
	collection?: { rows: number; cols: number };
	/** The zero-based position of an item inside its list or grid. */
	item?: { row: number; col: number; rowSpan?: number; colSpan?: number };
	/** Platform actions the node accepts beyond tap and long press. */
	actions?: string[];
	/** Cursor or selection inside an editable field. */
	selection?: { start: number; end: number };
	maxLength?: number;
	/** A platform subrole, such as an iOS AXSubrole with its prefix removed. */
	subrole?: string;
	traits?: string[];
	source?: AxSourceContext;
}

export interface AxSnapshot {
	screen: { width: number; height: number };
	elements: AxElement[];
	errors?: string[];
}
