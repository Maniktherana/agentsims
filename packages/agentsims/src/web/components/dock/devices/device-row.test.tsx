import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceRow, resolveDeviceLifecyclePhase } from "./device-row";
import type { GridDevice } from "../../../workspace/grid";

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
		expect(html).toContain('data-device-phase="streaming"');
		expect(html).toContain('data-device-status-glyph="streaming"');
		expect(html).not.toContain("agentsims-device-status-spin");
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

	test("uses a reverse spinner and disables selection while booting", () => {
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

		expect(html).toContain('data-device-phase="booting"');
		expect(html).toContain('data-device-status-glyph="booting"');
		expect(html).toContain("agentsims-device-status-spin");
		expect(html).toContain("Booting… · iOS 27.0");
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain('tabindex="-1"');
	});

	test("uses a loader and disables visibility and shutdown while connecting", () => {
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

		expect(html).toContain('data-device-phase="connecting"');
		expect(html).toContain("lucide-loader-circle");
		expect(html).toContain("Connecting… · iOS 27.0");
		expect(html.match(/ disabled=""/g)).toHaveLength(2);
	});

	test("uses a ringless corner status anchor", () => {
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

		expect(html).toContain("data-device-status-anchor");
		expect(html).toContain("-bottom-2");
		expect(html).toContain("-right-2");
		expect(html).not.toContain("ring-2");
		expect(html).not.toContain("ring-[#1c1c1e]");
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

		expect(html).toContain("Shutting down…");
		expect(html).not.toContain("Streaming ·");
		expect(html).not.toContain("text-[#34d399]");
		expect(html).toContain('data-device-phase="shutting-down"');
		expect(html).toContain("agentsims-device-status-breathe");
	});

	test("removes continuous status motion under reduced motion", () => {
		const css = readFileSync(
			new URL("../../../global.css", import.meta.url),
			"utf8",
		);
		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain(".agentsims-device-status-spin,");
		expect(css).toContain("animation: none;");
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

	test("keeps streaming status green when selected", () => {
		const html = render(
			{
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
			},
			true,
		);

		expect(html).toContain("Streaming");
		expect(html).toContain("text-[#34d399]");
	});

	test("uses visible eye and power actions instead of a checkbox and trailing version", () => {
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

		expect(html).toContain('data-testid="device-row-trailing-slot"');
		expect(html).toContain('aria-label="Hide iPhone 16"');
		expect(html).toContain('aria-label="Shut down device"');
		expect(html).toContain("lucide-eye");
		expect(html).toContain("lucide-power");
		expect(html.match(/data-base-ui-tooltip-trigger/g)).toHaveLength(2);
		expect(html).toContain("hover:!text-red-400");
		expect(html).toContain("!border-transparent");
		expect(html).toContain("group/icon-action");
		expect(html).not.toContain("group-hover:opacity-100");
		expect(html).not.toContain('type="checkbox"');
		expect(html).not.toContain(">26.5</span>");
	});

	test("does not add active or hover fills to running rows", () => {
		const html = render(
			{
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
			},
			true,
		);

		expect(html).not.toContain("bg-white/10");
		expect(html).not.toContain("hover:bg-white/8");
		expect(html).toContain("focus-visible:outline-white/25");
		expect(html).toContain("bg-white/6");
		expect(html).not.toContain("agentsims-device-tile-running-selected");
		expect(html).not.toContain("bg-[#0a84ff]");
		expect(html).not.toContain("bg-[#26364c]");
		expect(html).not.toContain("shadow-[inset");
	});
});
