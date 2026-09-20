import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DeviceRow,
	resolveDeviceLifecyclePhase,
} from "../../../../../../web/components/dock/devices/device-row";
import type { GridDevice } from "../../../../../../web/workspace/grid";

const noop = () => {};

function render(device: GridDevice, active = false): string {
	return renderToStaticMarkup(
		<DeviceRow
			device={device}
			active={active}
			starting={false}
			shuttingDown={false}
			onSelect={noop}
			onShutdown={noop}
		/>,
	);
}

describe("DeviceRow", () => {
	test("does not render a redundant Simulator status for idle devices", () => {
		const html = render({
			device: "idle",
			name: "iPhone 17",
			runtime: "iOS-27-0",
			state: "Shutdown",
			helper: null,
		});

		expect(html).toContain("iPhone 17");
		expect(html).not.toContain("Simulator");
	});

	test("labels trailing runtime versions with their operating system", () => {
		const ios = render({
			device: "ios",
			name: "iPhone 17",
			runtime: "iOS-27-0",
			state: "Shutdown",
			helper: null,
		});
		const android = render({
			device: "android:Pixel_10",
			name: "Pixel 10",
			runtime: "Android-16",
			state: "Shutdown",
			helper: null,
		});

		expect(ios).toContain(">iOS 27.0</span>");
		expect(android).toContain(">Android 16</span>");
	});

	test("keeps meaningful streaming status", () => {
		const html = render({
			device: "streaming",
			name: "iPhone 16",
			runtime: "iOS-26-5",
			state: "Booted",
			helper: {
				port: 3100,
				url: "http://localhost:3100",
				streamUrl: "http://localhost:3100/stream.mjpeg",
				wsUrl: "ws://localhost:3100/ws",
			},
		});

		expect(html).toContain("Streaming");
	});

	test("resolves settled and transitional lifecycle phases", () => {
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Shutdown", helper: null },
				false,
				false,
			),
		).toBe("available");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Shutdown", helper: null },
				true,
				false,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				true,
				false,
			),
		).toBe("connecting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				false,
				false,
			),
		).toBe("connecting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				false,
				true,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booting", helper: null },
				false,
				false,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Creating", helper: null },
				false,
				false,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Shutting Down", helper: null },
				false,
				false,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{
					state: "Shutting Down",
					helper: {
						port: 3100,
						url: "http://localhost:3100",
						streamUrl: "http://localhost:3100/stream.mjpeg",
						wsUrl: "ws://localhost:3100/ws",
					},
				},
				false,
				false,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{
					state: "Shutting Down",
					helper: {
						port: 3100,
						url: "http://localhost:3100",
						streamUrl: "http://localhost:3100/stream.mjpeg",
						wsUrl: "ws://localhost:3100/ws",
					},
				},
				false,
				false,
				true,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booting", helper: null },
				false,
				false,
				true,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "offline", helper: null },
				false,
				false,
			),
		).toBe("connecting");
	});

	test("lets the active browser transport override stale helper state both ways", () => {
		const helper = {
			port: 3100,
			url: "http://localhost:3100",
			streamUrl: "http://localhost:3100/stream.mjpeg",
			wsUrl: "ws://localhost:3100/ws",
		};

		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				false,
				false,
				true,
			),
		).toBe("streaming");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper },
				false,
				false,
				false,
			),
		).toBe("connecting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper },
				false,
				false,
				undefined,
			),
		).toBe("streaming");
	});

	test("disables selection while booting", () => {
		const html = renderToStaticMarkup(
			<DeviceRow
				device={{
					device: "booting",
					name: "iPhone 17",
					runtime: "iOS-27-0",
					state: "Shutdown",
					helper: null,
				}}
				active
				starting
				shuttingDown={false}
				onSelect={noop}
				onShutdown={noop}
			/>,
		);

		expect(html).toContain("Booting · iOS 27.0");
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain('tabindex="-1"');
	});

	test("disables visibility and shutdown while connecting", () => {
		const html = renderToStaticMarkup(
			<DeviceRow
				device={{
					device: "connecting",
					name: "iPhone 17",
					runtime: "iOS-27-0",
					state: "Booted",
					helper: null,
				}}
				active
				visible={false}
				showVisibilityControl
				starting
				shuttingDown={false}
				onSelect={noop}
				onVisibleChange={noop}
				onShutdown={noop}
			/>,
		);

		expect(html).toContain("Connecting · iOS 27.0");
		expect(html.match(/ disabled=""/g)).toHaveLength(2);
	});

	test("shows shutdown immediately even while the stale helper row is still present", () => {
		const html = renderToStaticMarkup(
			<DeviceRow
				device={{
					device: "streaming",
					name: "iPhone 16",
					runtime: "iOS-26-5",
					state: "Booted",
					helper: {
						port: 3100,
						url: "http://localhost:3100",
						streamUrl: "http://localhost:3100/stream.mjpeg",
						wsUrl: "ws://localhost:3100/ws",
					},
				}}
				active
				starting={false}
				shuttingDown
				onSelect={noop}
				onShutdown={noop}
			/>,
		);

		expect(html).toContain("Shutting down");
		expect(html).not.toContain("Streaming ·");
	});

	test("keeps settled status accessible without marking the row busy", () => {
		const html = renderToStaticMarkup(
			<DeviceRow
				device={{
					device: "available",
					name: "iPhone 17",
					runtime: "iOS-27-0",
					state: "Shutdown",
					helper: null,
				}}
				active={false}
				starting={false}
				shuttingDown={false}
				onSelect={noop}
				onShutdown={noop}
			/>,
		);

		expect(html).toContain('aria-label="iPhone 17, Available · iOS 27.0"');
		expect(html).not.toContain('aria-busy="true"');
	});

	test("does not render a live stream thumbnail in the device list", () => {
		const html = render({
			device: "streaming",
			name: "iPhone 16",
			runtime: "iOS-26-5",
			state: "Booted",
			helper: {
				port: 3100,
				url: "http://localhost:3100",
				streamUrl: "http://localhost:3100/stream.mjpeg",
				wsUrl: "ws://localhost:3100/ws",
			},
		});

		expect(html).not.toContain("<img");
		expect(html).not.toContain("stream.mjpeg");
	});

	test("uses accessible visibility and power actions instead of a checkbox and trailing version", () => {
		const html = renderToStaticMarkup(
			<DeviceRow
				device={{
					device: "streaming",
					name: "iPhone 16",
					runtime: "iOS-26-5",
					state: "Booted",
					helper: {
						port: 3100,
						url: "http://localhost:3100",
						streamUrl: "http://localhost:3100/stream.mjpeg",
						wsUrl: "ws://localhost:3100/ws",
					},
				}}
				active
				visible
				showVisibilityControl
				starting={false}
				shuttingDown={false}
				onSelect={noop}
				onVisibleChange={noop}
				onShutdown={noop}
			/>,
		);

		expect(html).toContain('aria-label="Hide iPhone 16"');
		expect(html).toContain('aria-label="Shut down device"');
		expect(html).not.toContain('type="checkbox"');
		expect(html).not.toContain(">26.5</span>");
	});
});
