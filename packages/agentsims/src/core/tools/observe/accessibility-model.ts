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
	windowLayer?: number;
	windowType?: number;
	windowActive?: boolean;
	windowFocused?: boolean;
	frame: AxRect;
	testId?: string;
	nativeId?: string;
	traits?: string[];
	source?: AxSourceContext;
}

export interface AxSnapshot {
	screen: { width: number; height: number };
	elements: AxElement[];
	errors?: string[];
}
