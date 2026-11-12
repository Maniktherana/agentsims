import type { ForegroundApp } from "../../core/tools/devices/foreground-apps";

/** The app-state stream repeats the same app. Equal values keep one object. */
export function sameForegroundApp(
	a: ForegroundApp | null,
	b: ForegroundApp | null,
): boolean {
	return a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
}
