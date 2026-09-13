export const ANDROID_DEVICE_PREFIX = "android:";
export const ANDROID_AVD_PREFIX = "android-avd:";

export function androidStateId(serial: string): string {
	return `${ANDROID_DEVICE_PREFIX}${serial}`;
}

export function androidSerialFromStateId(device: string): string | null {
	return device.startsWith(ANDROID_DEVICE_PREFIX)
		? device.slice(ANDROID_DEVICE_PREFIX.length)
		: null;
}

export function androidAvdStateId(name: string): string {
	return `${ANDROID_AVD_PREFIX}${encodeURIComponent(name)}`;
}

export function androidAvdNameFromStateId(device: string): string | null {
	if (!device.startsWith(ANDROID_AVD_PREFIX)) return null;
	try {
		return decodeURIComponent(device.slice(ANDROID_AVD_PREFIX.length));
	} catch {
		return device.slice(ANDROID_AVD_PREFIX.length);
	}
}
