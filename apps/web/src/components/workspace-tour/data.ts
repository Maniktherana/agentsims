/*
 * Real content for the workspace tour. Every string, frame and value was read
 * from the running product (iPhone 17, Pixel 10 and the Crema app), or from
 * the agent run that the trace records.
 */

type DeviceForm = "iphone" | "ipad" | "android-phone" | "android-tablet";
export type DeviceStatus = "available" | "booting" | "connecting" | "streaming" | "shutting-down";

export interface TourDevice {
	id: string;
	name: string;
	platform: "ios" | "android";
	form: DeviceForm;
	runtime: string;
	status: DeviceStatus;
}

export const IPHONE_ID = "iphone-17";
export const PIXEL_ID = "pixel-10";

/** The device list of the product, in its order: iPhone 17 and Pixel 10 stream. */
export const DEVICES: readonly TourDevice[] = [
	{ id: "androidworldavd", name: "AndroidWorldAvd", platform: "android", form: "android-phone", runtime: "Android 13", status: "available" },
	{ id: PIXEL_ID, name: "Pixel 10", platform: "android", form: "android-phone", runtime: "Android 17", status: "streaming" },
	{ id: "pixel-tablet", name: "Pixel Tablet", platform: "android", form: "android-tablet", runtime: "Android 15", status: "available" },
	{ id: "iphone-17e", name: "iPhone 17e", platform: "ios", form: "iphone", runtime: "iOS 27.2", status: "available" },
	{ id: "iphone-18-pro", name: "iPhone 18 Pro", platform: "ios", form: "iphone", runtime: "iOS 27.2", status: "available" },
	{ id: "iphone-18-pro-max", name: "iPhone 18 Pro Max", platform: "ios", form: "iphone", runtime: "iOS 27.2", status: "available" },
	{ id: "iphone-air", name: "iPhone Air", platform: "ios", form: "iphone", runtime: "iOS 27.2", status: "available" },
	{ id: "iphone-duo-19-4", name: "iPhone Duo", platform: "ios", form: "iphone", runtime: "iOS 27.2.iPhone19.4", status: "available" },
	{ id: "iphone-duo", name: "iPhone Duo", platform: "ios", form: "iphone", runtime: "iOS 27.1", status: "available" },
	{ id: "ipad-a16", name: "iPad (A16)", platform: "ios", form: "ipad", runtime: "iOS 27.2", status: "available" },
	{ id: "ipad-air-11", name: "iPad Air 11-inch (M4)", platform: "ios", form: "ipad", runtime: "iOS 27.2", status: "available" },
	{ id: "ipad-air-13", name: "iPad Air 13-inch (M4)", platform: "ios", form: "ipad", runtime: "iOS 27.2", status: "available" },
	{ id: "ipad-mini", name: "iPad mini (A20 Pro)", platform: "ios", form: "ipad", runtime: "iOS 27.2", status: "available" },
	{ id: "ipad-pro-11", name: "iPad Pro 11-inch (M5)", platform: "ios", form: "ipad", runtime: "iOS 27.2", status: "available" },
	{ id: "ipad-pro-13", name: "iPad Pro 13-inch (M5)", platform: "ios", form: "ipad", runtime: "iOS 27.2", status: "available" },
	{ id: IPHONE_ID, name: "iPhone 17", platform: "ios", form: "iphone", runtime: "iOS 27.2", status: "streaming" },
];

/** The rate in the name bar of Pixel 10 when its stream starts. A still screen reads 0. */
export const PIXEL_FIRST_FPS = 71;

/** The typed address, one frame per key, as the run captured them. */
export const TYPED = "manikrana.dev";
const typedFrames = Array.from({ length: TYPED.length }, (_, i) => `/demo/tour-safari-typed-${String(i + 1).padStart(2, "0")}.webp`);

/**
 * The screens, converted from the device screenshots of one continuous
 * pass, so the clock in the status bar never goes back.
 */
export const SCREENS = {
	homeLight: "/demo/tour-home-light.webp",
	homeDark: "/demo/tour-home-dark.webp",
	safariStart: "/demo/tour-safari-start.webp",
	safariFocused: "/demo/tour-safari-focused.webp",
	safariLoaded: "/demo/tour-safari-loaded.webp",
	homePage1: "/demo/tour-home-page-1.webp",
	homePage2: "/demo/tour-home-page-2.webp",
	cremaSplash: "/demo/tour-crema-splash.webp",
	cremaMenu: "/demo/tour-crema-menu.webp",
	cremaDetail: "/demo/tour-crema-detail.webp",
	pixelHome: "/demo/tour-pixel-home.webp",
	traceCall1: "/demo/tour-trace-call-1.webp",
	traceCall2: "/demo/tour-trace-call-2.webp",
	traceCall3: "/demo/tour-trace-call-3.webp",
	traceCall4: "/demo/tour-trace-call-4.webp",
	traceCall5: "/demo/tour-trace-call-5.webp",
	traceCall6: "/demo/tour-trace-call-6.webp",
} as const;

/**
 * The pixel size of the files: twice the largest width at which each is
 * drawn, for a 2x screen. iPhone 17 is drawn at most 246.1px wide, Pixel 10
 * 247.7px, and a trace screenshot 184px. The trace column takes its width
 * from the image, so its files keep the exact ratio of the capture, 201:437.
 */
export const IPHONE_FILE = { width: 493, height: 1072 };
export const PIXEL_FILE = { width: 496, height: 1113 };
export const TRACE_FILE = { width: 402, height: 874 };

/** Every image of the tour. */
export const ALL_SCREENS: readonly string[] = [...Object.values(SCREENS), ...typedFrames];

/** The screens of the first frame. They load first, when the picture comes near. */
export const FIRST_SCREENS: readonly string[] = [SCREENS.homeLight, SCREENS.pixelHome];

/**
 * The screens iPhone 17 streams in the story. `home` is page 1 and follows
 * the appearance; `home-1` is page 1 again a minute later, after the
 * toolbar's Home; `typed-N` shows the first N characters of the address.
 */
export type IPhoneScreen =
	| "home"
	| "safari-start"
	| "safari-focused"
	| `typed-${number}`
	| "safari-loaded"
	| "home-1"
	| "home-2"
	| "crema-splash"
	| "crema-menu"
	| "crema-detail"
	| "black";

export const SCREEN_SRC: Record<string, string> = {
	"safari-start": SCREENS.safariStart,
	"safari-focused": SCREENS.safariFocused,
	...Object.fromEntries(typedFrames.map((src, i) => [`typed-${i + 1}`, src])),
	"safari-loaded": SCREENS.safariLoaded,
	"home-1": SCREENS.homePage1,
	"home-2": SCREENS.homePage2,
	"crema-splash": SCREENS.cremaSplash,
	"crema-menu": SCREENS.cremaMenu,
	"crema-detail": SCREENS.cremaDetail,
};

/** Frame aspect ratios, as the product sizes them. */
export const FORM_ASPECT: Record<DeviceForm, number> = {
	// iPhone 17 with its hardware frame: 454 × 908.
	iphone: 454 / 908,
	ipad: 1640 / 2360,
	// Pixel_10 AVD: 1080 × 2424.
	"android-phone": 1080 / 2424,
	"android-tablet": 1600 / 2560,
};

/** The iPhone 17 screen in points. Element frames below use this space. */
export const IPHONE_SCREEN = { width: 402, height: 874 };

interface Frame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The places the pointer touches on the stream, and the screen each is on,
 * in screen points: the `observe` boxes of the run divided by 3, or measured
 * on the screenshot where the run has no box (the address field, Crema on
 * page 2, and the empty area the swipe starts on).
 */
export const STREAM_TARGETS = {
	safari: { screen: "home", frame: { x: 123, y: 771.33, width: 68, height: 68 } },
	address: { screen: "safari-start", frame: { x: 90, y: 793.33, width: 221.67, height: 46.67 } },
	/** The swipe to page 2 starts right of the middle of page 1, on no icon. */
	swipe: { screen: "home-1", frame: { x: 230, y: 500, width: 120, height: 80 } },
	crema: { screen: "home-2", frame: { x: 306, y: 188.67, width: 68, height: 68 } },
	todaysPour: { screen: "crema-menu", frame: { x: 24, y: 280, width: 354, height: 166 } },
} satisfies Record<string, { screen: IPhoneScreen; frame: Frame }>;

export interface AxRow {
	/** The product's path, also the element id in the tour. */
	path: string;
	type: string;
	/** The properties column of the tree row, as the product renders it. */
	name?: string;
	/** Frame in screen points. Rows without a frame have no box on the device. */
	frame?: Frame;
	/** Actionable elements get an outline while the tree is open. */
	actionable?: boolean;
	level: 0 | 1;
}

/** The accessibility tree of the Crema drink detail, as the product lists it. */
export const AX_ROWS: readonly AxRow[] = [
	{ path: "0", type: "Application", name: 'label="Crema"', level: 0 },
	{ path: "0.0", type: "Button", name: 'label="Back"', level: 1, actionable: true, frame: { x: 24, y: 74, width: 44, height: 44 } },
	{ path: "0.1", type: "Button", name: 'label="Bag, empty"', level: 1, actionable: true, frame: { x: 334, y: 74, width: 44, height: 44 } },
	{ path: "0.2", type: "Heading", name: 'label="Guji Pour Over"', level: 1 },
	{ path: "0.3", type: "StaticText", name: 'role="text" label="Peach · jasmine"', level: 1 },
	{
		path: "0.4",
		type: "StaticText",
		name: 'role="text" label="A natural-process Ethiopian coffee, brewed by hand to order. Bright, floral, and sweet as it cools."',
		level: 1,
	},
	{ path: "0.5", type: "StaticText", name: 'role="text" label="Size"', level: 1 },
	{ path: "0.6", type: "Button", name: 'label="Small, 8 oz"', level: 1, actionable: true, frame: { x: 28, y: 638, width: 112.67, height: 56 } },
	{
		path: "0.7",
		type: "Button",
		name: 'label="Medium, 12 oz" traits=["selected"]',
		level: 1,
		actionable: true,
		frame: { x: 144.67, y: 638, width: 112.67, height: 56 },
	},
	{ path: "0.8", type: "Button", name: 'label="Large, 16 oz"', level: 1, actionable: true, frame: { x: 261.33, y: 638, width: 112.67, height: 56 } },
	{ path: "0.9", type: "StaticText", name: 'role="text" label="Quantity"', level: 1 },
	{
		path: "0.10",
		type: "Button",
		name: 'label="Decrease Quantity" enabled=false',
		level: 1,
		actionable: true,
		frame: { x: 282, y: 742.3333339691162, width: 32, height: 32 },
	},
	{ path: "0.11", type: "StaticText", name: 'role="text" label="Quantity, 1"', level: 1 },
	{
		path: "0.12",
		type: "Button",
		name: 'label="Increase Quantity"',
		level: 1,
		actionable: true,
		frame: { x: 342, y: 742.3333339691162, width: 32, height: 32 },
	},
	{
		path: "0.13",
		type: "Button",
		name: 'label="Add to bag · $5.10"',
		level: 1,
		actionable: true,
		frame: { x: 24, y: 772.0000200271606, width: 354, height: 56 },
	},
	{ path: "0.14", type: "StaticText", name: 'role="text" label="7:21 PM"', level: 1 },
	{ path: "0.15", type: "GenericElement", name: 'label="Dynamic Island, Empty"', level: 1 },
	{ path: "0.16", type: "GenericElement", name: 'label="Cellular" value="No signal"', level: 1 },
	{ path: "0.17", type: "GenericElement", name: 'value="SSID, 3 of 3 Wi-Fi bars"', level: 1 },
	{ path: "0.18", type: "GenericElement", name: 'label="100% battery power" value="Not charging"', level: 1 },
];

/** The tooltip of a tree row, as the product writes it. */
export function axRowLabel(row: AxRow): string {
	return `${row.type}${row.name ? ` ${row.name}` : ""} path="${row.path}"`;
}

export const AX_COUNT = 20;

/** The element the story inspects, and the detail pane the product shows for it. */
export const INSPECTED_PATH = "0.13";
export const INSPECTED_DETAIL = {
	type: "Button",
	name: "“Add to bag · $5.10”",
	role: "button",
	rows: [
		{ label: "Role", value: "button" },
		{ label: "Native type", value: "Button", code: true },
		{ label: "Label", value: "Add to bag · $5.10" },
		{ label: "Native chain", value: "Application › Button", code: true },
		{ label: "Bounds", value: "24,772.0000200271606 354x56", code: true },
		{ label: "AX path", value: "0.13", code: true },
	],
} as const;

/** The note of the story, on the cart button that shows a gear. */
export const NOTE_PATH = "0.1";
export const NOTE_TEXT = "should be cart icon";

export type TraceCommand = "observe" | "tap";

export interface TraceCall {
	command: TraceCommand;
	details: string;
	screenshot: string;
	/** The command line and the output the expanded call shows, as the product renders them from the trace. */
	line: string;
	output: string;
}

export const TRACE_NAME = "1532a7c2-2c11-48c9-aac5-9d06a5440b27-20261111-135137-crema-order-two-large-pour-overs-and-a-cortado";

const CALL_1_COMMAND = "agentsims observe -d 1532A7C2-2C11-48C9-AAC5-9D06A5440B27";
const CALL_1_OUTPUT =
	"observe  device=1532A7C2-2C11-48C9-AAC5-9D06A5440B27  platform=ios  observation=s105  capture=c51  started=2026-11-11T13:51:37.959Z  completed=2026-11-11T13:51:38.379Z\naccessibility  ok  captured=2026-11-11T13:51:38.351Z  observation=s105\nimage  ok  captured=2026-11-11T13:51:38.379Z  capture=c51  1206×2622  observation=s105\ncontext  app=dev.agentsims.crema  orientation=portrait  generation=unknown  changed=no\nelements  20 shown / 20 total\n\n- generic \"Crema\" [ref=e3233]\n  - button \"Back\" [ref=e3234]\n  - button \"Bag, empty\" [ref=e3235]\n  - generic \"Guji Pour Over\" [ref=e3236]\n  - text \"Peach · jasmine\" [ref=e3237]\n  - text \"A natural-process Ethiopian coffee, brewed by hand to order. Bright, floral, and sweet as it cools.\" [ref=e3238]\n  - text \"Size\" [ref=e3239]\n  - button \"Small, 8 oz\" [ref=e3240]\n  - button \"Medium, 12 oz\" [ref=e3241] [selected]\n  - button \"Large, 16 oz\" [ref=e3242]\n  - text \"Quantity\" [ref=e3243]\n  - button \"Decrease Quantity\" [ref=e3244] [disabled]\n  - text \"Quantity, 1\" [ref=e3245]\n  - button \"Increase Quantity\" [ref=e3246]\n  - button \"Add to bag · $5.10\" [ref=e3247]\n  - text \"7:21 PM\" [ref=e3248] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]\n  - generic \"Dynamic Island, Empty\" [ref=e3249]\n  - generic \"Cellular\" [ref=e3250] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: No signal\n  - generic [ref=e3251] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"] [testid=3 of 3 Wi-Fi bars]: SSID, 3 of 3 Wi-Fi bars\n  - generic \"100% battery power\" [ref=e3252] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: Not charging";
const CALL_2_COMMAND = "agentsims tap @e3242 -d 1532A7C2-2C11-48C9-AAC5-9D06A5440B27";
const CALL_2_OUTPUT =
	"action  tap button \"Large, 16 oz\" @e3242 at 953,1998 px\ndispatch  accepted  The device accepted every input frame.\nverification  not_applicable  screenChanged=yes  Observed after the action.\naccessibility  ok  captured=2026-11-11T13:51:45.586Z  observation=s109  settled=500ms\nimage  ok  reason=window_changed  captured=2026-11-11T13:51:45.604Z  capture=c52  1206×2622\nelements  20 shown / 20 total\n\n- generic \"Crema\" [ref=e3313]\n  - button \"Back\" [ref=e3314]\n  - button \"Bag, empty\" [ref=e3315]\n  - generic \"Guji Pour Over\" [ref=e3316]\n  - text \"Peach · jasmine\" [ref=e3317]\n  - text \"A natural-process Ethiopian coffee, brewed by hand to order. Bright, floral, and sweet as it cools.\" [ref=e3318]\n  - text \"Size\" [ref=e3319]\n  - button \"Small, 8 oz\" [ref=e3320]\n  - button \"Medium, 12 oz\" [ref=e3321]\n  - button \"Large, 16 oz\" [ref=e3322] [selected]\n  - text \"Quantity\" [ref=e3323]\n  - button \"Decrease Quantity\" [ref=e3324] [disabled]\n  - text \"Quantity, 1\" [ref=e3325]\n  - button \"Increase Quantity\" [ref=e3326]\n  - button \"Add to bag · $5.60\" [ref=e3327]\n  - text \"7:21 PM\" [ref=e3328] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]\n  - generic \"Dynamic Island, Empty\" [ref=e3329]\n  - generic \"Cellular\" [ref=e3330] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: No signal\n  - generic [ref=e3331] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"] [testid=3 of 3 Wi-Fi bars]: SSID, 3 of 3 Wi-Fi bars\n  - generic \"100% battery power\" [ref=e3332] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: Not charging";
const CALL_3_COMMAND = "agentsims tap @e3326 -d 1532A7C2-2C11-48C9-AAC5-9D06A5440B27";
const CALL_3_OUTPUT =
	"action  tap button \"Increase Quantity\" @e3326 at 1074,2275 px\ndispatch  accepted  The device accepted every input frame.\nverification  not_applicable  screenChanged=yes  Observed after the action.\naccessibility  ok  captured=2026-11-11T13:51:54.469Z  observation=s114  settled=750ms\nimage  ok  reason=window_changed  captured=2026-11-11T13:51:54.481Z  capture=c53  1206×2622\nelements  20 shown / 20 total\n\n- generic \"Crema\" [ref=e3413]\n  - button \"Back\" [ref=e3414]\n  - button \"Bag, empty\" [ref=e3415]\n  - generic \"Guji Pour Over\" [ref=e3416]\n  - text \"Peach · jasmine\" [ref=e3417]\n  - text \"A natural-process Ethiopian coffee, brewed by hand to order. Bright, floral, and sweet as it cools.\" [ref=e3418]\n  - text \"Size\" [ref=e3419]\n  - button \"Small, 8 oz\" [ref=e3420]\n  - button \"Medium, 12 oz\" [ref=e3421]\n  - button \"Large, 16 oz\" [ref=e3422] [selected]\n  - text \"Quantity\" [ref=e3423]\n  - button \"Decrease Quantity\" [ref=e3424]\n  - text \"Quantity, 2\" [ref=e3425]\n  - button \"Increase Quantity\" [ref=e3426]\n  - button \"Add to bag · $11.20\" [ref=e3427]\n  - text \"7:21 PM\" [ref=e3428] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]\n  - generic \"Dynamic Island, Empty\" [ref=e3429]\n  - generic \"Cellular\" [ref=e3430] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: No signal\n  - generic [ref=e3431] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"] [testid=3 of 3 Wi-Fi bars]: SSID, 3 of 3 Wi-Fi bars\n  - generic \"100% battery power\" [ref=e3432] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: Not charging";
const CALL_4_COMMAND = "agentsims tap @e3427 -d 1532A7C2-2C11-48C9-AAC5-9D06A5440B27";
const CALL_4_OUTPUT =
	"action  tap button \"Add to bag · $11.20\" @e3427 at 603,2400 px\ndispatch  accepted  The device accepted every input frame.\nverification  not_applicable  screenChanged=yes  Observed after the action.\naccessibility  ok  captured=2026-11-11T13:52:03.820Z  observation=s120  settled=1000ms\nimage  ok  reason=window_changed  captured=2026-11-11T13:52:03.832Z  capture=c54  1206×2622\nelements  34 shown / 34 total\n\n- generic \"Crema\" [ref=e3565]\n  - button \"Bag, 2 items\" [ref=e3566]\n  - text \"2\" [ref=e3567]\n  - text \"Harbor St\" [ref=e3568]\n  - text \"· Open until 6 pm\" [ref=e3569]\n  - generic \"Good evening, Sam\" [ref=e3570]\n  - text \"340 beans · 60 to a free drink\" [ref=e3571]\n  - button \"Today's pour, Guji Pour Over, $4.50\" [ref=e3572] [hint=\"Peach · jasmine\"]\n  - button \"All\" [ref=e3573] [selected]\n  - button \"Espresso\" [ref=e3574]\n  - button \"Milk\" [ref=e3575]\n  - button \"Cold\" [ref=e3576]\n  - button \"Tea\" [ref=e3577]\n  - button \"Espresso, $3.20\" [ref=e3578] [hint=\"Cacao · plum\"]\n  - button \"Add Espresso\" [ref=e3579]\n  - button \"Cortado, $4.10\" [ref=e3580] [hint=\"Short · strong · silky\"]\n  - button \"Add Cortado\" [ref=e3581]\n  - button \"Flat White, $4.60\" [ref=e3582] [hint=\"Velvet microfoam\"]\n  - button \"Add Flat White\" [ref=e3583]\n  - button \"Cappuccino, $4.40\" [ref=e3584] [hint=\"Deep foam · cocoa\"]\n  - button \"Add Cappuccino\" [ref=e3585]\n  - button \"Cold Brew, $4.80\" [ref=e3586] [hint=\"Steeped 18 hours\"]\n  - button \"Add Cold Brew\" [ref=e3587]\n  - button \"Iced Oat Latte, $5.20\" [ref=e3588] [hint=\"Oat milk · two shots\"]\n  - button \"Add Iced Oat Latte\" [ref=e3589]\n  - button \"Iced Matcha, $5.40\" [ref=e3590] [hint=\"Ceremonial grade\"]\n  - button \"Add Iced Matcha\" [ref=e3591]\n  - button \"Hojicha Latte, $5.00\" [ref=e3592] [hint=\"Roasted tea · caramel\"]\n  - button \"Add Hojicha Latte\" [ref=e3593]\n  - text \"7:22 PM\" [ref=e3594] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]\n  - generic \"Dynamic Island, Empty\" [ref=e3595]\n  - generic \"Cellular\" [ref=e3596] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: No signal\n  - generic [ref=e3597] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"] [testid=3 of 3 Wi-Fi bars]: SSID, 3 of 3 Wi-Fi bars\n  - generic \"100% battery power\" [ref=e3598] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: Not charging";
const CALL_5_COMMAND = "agentsims tap @e3581 -d 1532A7C2-2C11-48C9-AAC5-9D06A5440B27";
const CALL_5_OUTPUT =
	"action  tap button \"Add Cortado\" @e3581 at 1074,1884 px\ndispatch  accepted  The device accepted every input frame.\nverification  not_applicable  screenChanged=yes  Observed after the action.\naccessibility  ok  captured=2026-11-11T13:52:13.409Z  observation=s126  settled=1000ms\nimage  ok  reason=window_changed  captured=2026-11-11T13:52:13.417Z  capture=c55  1206×2622\nelements  34 shown / 34 total\n\n- generic \"Crema\" [ref=e3769]\n  - button \"Bag, 3 items\" [ref=e3770]\n  - text \"3\" [ref=e3771]\n  - text \"Harbor St\" [ref=e3772]\n  - text \"· Open until 6 pm\" [ref=e3773]\n  - generic \"Good evening, Sam\" [ref=e3774]\n  - text \"340 beans · 60 to a free drink\" [ref=e3775]\n  - button \"Today's pour, Guji Pour Over, $4.50\" [ref=e3776] [hint=\"Peach · jasmine\"]\n  - button \"All\" [ref=e3777] [selected]\n  - button \"Espresso\" [ref=e3778]\n  - button \"Milk\" [ref=e3779]\n  - button \"Cold\" [ref=e3780]\n  - button \"Tea\" [ref=e3781]\n  - button \"Espresso, $3.20\" [ref=e3782] [hint=\"Cacao · plum\"]\n  - button \"Add Espresso\" [ref=e3783]\n  - button \"Cortado, $4.10\" [ref=e3784] [hint=\"Short · strong · silky\"]\n  - button \"Add Cortado\" [ref=e3785]\n  - button \"Flat White, $4.60\" [ref=e3786] [hint=\"Velvet microfoam\"]\n  - button \"Add Flat White\" [ref=e3787]\n  - button \"Cappuccino, $4.40\" [ref=e3788] [hint=\"Deep foam · cocoa\"]\n  - button \"Add Cappuccino\" [ref=e3789]\n  - button \"Cold Brew, $4.80\" [ref=e3790] [hint=\"Steeped 18 hours\"]\n  - button \"Add Cold Brew\" [ref=e3791]\n  - button \"Iced Oat Latte, $5.20\" [ref=e3792] [hint=\"Oat milk · two shots\"]\n  - button \"Add Iced Oat Latte\" [ref=e3793]\n  - button \"Iced Matcha, $5.40\" [ref=e3794] [hint=\"Ceremonial grade\"]\n  - button \"Add Iced Matcha\" [ref=e3795]\n  - button \"Hojicha Latte, $5.00\" [ref=e3796] [hint=\"Roasted tea · caramel\"]\n  - button \"Add Hojicha Latte\" [ref=e3797]\n  - text \"7:22 PM\" [ref=e3798] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]\n  - generic \"Dynamic Island, Empty\" [ref=e3799]\n  - generic \"Cellular\" [ref=e3800] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: No signal\n  - generic [ref=e3801] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"] [testid=3 of 3 Wi-Fi bars]: SSID, 3 of 3 Wi-Fi bars\n  - generic \"100% battery power\" [ref=e3802] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: Not charging";
const CALL_6_COMMAND = "agentsims tap @e3770 -d 1532A7C2-2C11-48C9-AAC5-9D06A5440B27";
const CALL_6_OUTPUT =
	"action  tap button \"Bag, 3 items\" @e3770 at 1068,288 px\ndispatch  accepted  The device accepted every input frame.\nverification  not_applicable  screenChanged=yes  Observed after the action.\naccessibility  ok  captured=2026-11-11T13:52:21.229Z  observation=s130  settled=500ms\nimage  ok  reason=window_changed  captured=2026-11-11T13:52:21.338Z  capture=c56  1206×2622\nelements  30 shown / 30 total\n\n- generic \"Crema\" [ref=e3918]\n  - button \"Back\" [ref=e3919]\n  - generic \"Your bag\" [ref=e3920]\n  - text \"Pickup at Harbor St\" [ref=e3921]\n  - text \"Ready in about 6 min\" [ref=e3922]\n  - text \"3 items\" [ref=e3923]\n  - text \"Guji Pour Over\" [ref=e3924]\n  - text \"Large\" [ref=e3925]\n  - button \"Decrease Guji Pour Over quantity\" [ref=e3926]\n  - text \"Guji Pour Over quantity, 2\" [ref=e3927]\n  - button \"Increase Guji Pour Over quantity\" [ref=e3928]\n  - text \"$11.20\" [ref=e3929]\n  - text \"Cortado\" [ref=e3930]\n  - text \"Medium · Whole milk\" [ref=e3931]\n  - button \"Decrease Cortado quantity\" [ref=e3932]\n  - text \"Cortado quantity, 1\" [ref=e3933]\n  - button \"Increase Cortado quantity\" [ref=e3934]\n  - text \"$4.70\" [ref=e3935]\n  - text \"Subtotal\" [ref=e3936]\n  - text \"$15.90\" [ref=e3937]\n  - text \"Tax\" [ref=e3938]\n  - text \"$1.41\" [ref=e3939]\n  - text \"Total\" [ref=e3940]\n  - text \"$17.31\" [ref=e3941]\n  - button \"Place order · $17.31\" [ref=e3942]\n  - text \"7:22 PM\" [ref=e3943] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]\n  - generic \"Dynamic Island, Empty\" [ref=e3944]\n  - generic \"Cellular\" [ref=e3945] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: No signal\n  - generic [ref=e3946] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"] [testid=3 of 3 Wi-Fi bars]: SSID, 3 of 3 Wi-Fi bars\n  - generic \"100% battery power\" [ref=e3947] [hint=\"Swipe down with three fingers to reveal notifications., Swipe up with three fingers to reveal the control center, Double-tap to scroll to top\"]: Not charging";

/** The six calls of the agent run, in order. */
export const TRACE_CALLS: readonly TraceCall[] = [
	{
		command: "observe",
		details: "dev.agentsims.crema 20 shown / 20 total",
		screenshot: SCREENS.traceCall1,
		line: CALL_1_COMMAND,
		output: CALL_1_OUTPUT,
	},
	{
		command: "tap",
		details: "button \"Large, 16 oz\" @e3242 at 953,1998 px",
		screenshot: SCREENS.traceCall2,
		line: CALL_2_COMMAND,
		output: CALL_2_OUTPUT,
	},
	{
		command: "tap",
		details: "button \"Increase Quantity\" @e3326 at 1074,2275 px",
		screenshot: SCREENS.traceCall3,
		line: CALL_3_COMMAND,
		output: CALL_3_OUTPUT,
	},
	{
		command: "tap",
		details: "button \"Add to bag · $11.20\" @e3427 at 603,2400 px",
		screenshot: SCREENS.traceCall4,
		line: CALL_4_COMMAND,
		output: CALL_4_OUTPUT,
	},
	{
		command: "tap",
		details: "button \"Add Cortado\" @e3581 at 1074,1884 px",
		screenshot: SCREENS.traceCall5,
		line: CALL_5_COMMAND,
		output: CALL_5_OUTPUT,
	},
	{
		command: "tap",
		details: "button \"Bag, 3 items\" @e3770 at 1068,288 px",
		screenshot: SCREENS.traceCall6,
		line: CALL_6_COMMAND,
		output: CALL_6_OUTPUT,
	},
];

/** The Simulator section of Settings for iPhone 17. Only Appearance has a menu. */
export const SIMULATOR_SETTINGS = [
	{ key: "appearance", label: "Appearance", kind: "select" },
	{ key: "liquidGlass", label: "Liquid Glass", kind: "select", value: "Clear" },
	{ key: "colorFilter", label: "Color Filter", kind: "select", value: "None" },
	{ key: "textSize", label: "Text Size", kind: "slider" },
	{ key: "reduceMotion", label: "Reduce Motion", kind: "switch" },
	{ key: "increaseContrast", label: "Increase Contrast", kind: "switch" },
	{ key: "showBorders", label: "Show Borders", kind: "switch" },
	{ key: "reduceTransparency", label: "Reduce Transparency", kind: "switch" },
	{ key: "voiceOver", label: "VoiceOver", kind: "switch" },
] as const;

/** The collapsed sections under Simulator, in the product's order. */
export const SETTINGS_SECTIONS = [
	{ key: "camera", label: "Camera" },
	{ key: "audio", label: "Audio" },
	{ key: "location", label: "Location" },
	{ key: "permissions", label: "Permissions" },
	{ key: "trace", label: "Trace" },
	{ key: "stream", label: "Stream" },
] as const;

/** The caption under the window: the tool of each beat, and what it does. */
export const CAPTIONS = [
	{ id: "devices", name: "Devices", text: "Boot and shut down simulators and emulators from the dock." },
	{ id: "canvas", name: "Canvas", text: "Move a device on the canvas, and use it with your mouse and keyboard." },
	{
		id: "settings",
		name: "Settings",
		text: "Change appearance and location on iOS, and network, battery, and locale on Android.",
	},
	{ id: "notes", name: "Notes", text: "Mark problems on the screen and copy them to your agent as one prompt." },
	{
		id: "inspector",
		name: "Inspector",
		text: "See each native element on the screen and its properties in the accessibility view.",
	},
	{ id: "traces", name: "Traces", text: "See each command an agent ran, with the screenshot and output it captured." },
] as const;

export type CaptionId = (typeof CAPTIONS)[number]["id"];
