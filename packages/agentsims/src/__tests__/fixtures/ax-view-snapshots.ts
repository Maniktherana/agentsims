import type {
	AxElement,
	AxSnapshot,
} from "../../core/tools/observe/accessibility-model";

export function axElement(
	path: string,
	type: string,
	overrides: Partial<AxElement> = {},
): AxElement {
	return {
		id: overrides.id ?? `node:${path}`,
		path,
		label: "",
		value: "",
		role: type,
		type,
		enabled: true,
		frame: { x: 0, y: 0, width: 100, height: 40 },
		...overrides,
	};
}

/** An Android sign-in screen: a scrollable list, a field, and two buttons. */
export const androidSignInSnapshot: AxSnapshot = {
	screen: { width: 1080, height: 2400 },
	elements: [
		axElement("0", "android.widget.FrameLayout", {
			id: "root",
			frame: { x: 0, y: 0, width: 1080, height: 2400 },
		}),
		axElement("0.0", "android.widget.LinearLayout", {
			id: "form",
			frame: { x: 0, y: 200, width: 1080, height: 800 },
		}),
		axElement("0.0.0", "android.widget.EditText", {
			id: "com.example:id/email",
			label: "Email",
			value: "a@b.co",
			testId: "com.example:id/email",
			traits: ["focusable", "focused"],
			frame: { x: 40, y: 240, width: 1000, height: 120 },
		}),
		axElement("0.0.1", "android.widget.EditText", {
			id: "com.example:id/password",
			label: "Password",
			traits: ["focusable", "password"],
			frame: { x: 40, y: 400, width: 1000, height: 120 },
		}),
		axElement("0.0.2", "android.widget.Button", {
			id: "com.example:id/submit",
			label: "Sign in",
			testId: "com.example:id/submit",
			traits: ["clickable", "long press"],
			frame: { x: 40, y: 560, width: 1000, height: 120 },
		}),
		axElement("0.0.2.0", "android.widget.TextView", {
			id: "submit-text",
			label: "Sign in",
			value: "Sign in",
			frame: { x: 60, y: 580, width: 200, height: 60 },
		}),
		axElement("0.1", "androidx.recyclerview.widget.RecyclerView", {
			id: "list",
			traits: ["scrollable"],
			frame: { x: 0, y: 1000, width: 1080, height: 1000 },
		}),
		axElement("0.1.0", "android.widget.Switch", {
			id: "autoplay",
			label: "Autoplay",
			traits: ["checkable", "checked"],
			frame: { x: 40, y: 1040, width: 1000, height: 120 },
		}),
		axElement("0.1.1", "android.widget.CheckBox", {
			id: "remember",
			label: "Remember me",
			enabled: false,
			traits: ["checkable"],
			frame: { x: 40, y: 1200, width: 1000, height: 120 },
		}),
		axElement("0.2", "android.view.View", {
			id: "spacer",
			frame: { x: 0, y: 2100, width: 1080, height: 40 },
		}),
	],
};

/** iOS reports points; the stream reports pixels three times larger. */
export const iosSettingsSnapshot: AxSnapshot = {
	screen: { width: 402, height: 874 },
	elements: [
		axElement("0.0", "Button", {
			id: "back",
			label: "Back",
			frame: { x: 10, y: 20, width: 40, height: 40 },
		}),
		axElement("0.1", "ScrollArea", {
			id: "scroll",
			frame: { x: 0, y: 80, width: 402, height: 700 },
		}),
		axElement("0.1.0", "StaticText", {
			id: "title",
			value: "Settings",
			frame: { x: 20, y: 100, width: 200, height: 30 },
		}),
		axElement("0.1.1", "SecureTextField", {
			id: "secret",
			label: "Passcode",
			enabled: false,
			frame: { x: 20, y: 200, width: 360, height: 44 },
		}),
	],
};
