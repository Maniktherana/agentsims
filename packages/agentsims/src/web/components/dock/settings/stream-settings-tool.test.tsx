import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AndroidSimulatorSettingsTool } from "./android-simulator-settings-tool";
import {
	StreamFrameRateHistory,
	StreamSettingsTool,
} from "./stream-settings-tool";
import { SimulatorFrameRateStore } from "../../../simulator/stream/simulator-frame-rate";

const noop = () => {};

describe("simulator stream history", () => {
	test("renders themed native FPS history and its definition", () => {
		const frameRate = new SimulatorFrameRateStore();
		frameRate.start();
		frameRate.recordTiming(1n, 1_000_000n);
		frameRate.recordTiming(2n, 1_016_667n);

		const html = renderToStaticMarkup(
			<StreamFrameRateHistory frameRate={frameRate} />,
		);

		expect(html).toContain('data-stream-fps-history=""');
		expect(html).toContain("60 FPS");
		expect(html).toContain("Recent · 30 sec");
		expect(html).toContain("frames Agentsims receives from the simulator");
		expect(html).toContain("not necessarily the app’s actual render rate");
		expect(html).toContain("border-white/[0.06]");
		frameRate.reset();
	});

	test("keeps Android FPS in a dedicated chart-only Stream accordion", () => {
		const frameRate = new SimulatorFrameRateStore();
		const simulatorHtml = renderToStaticMarkup(
			<AndroidSimulatorSettingsTool udid="android:emulator-5554" />,
		);
		const streamHtml = renderToStaticMarkup(
			<StreamSettingsTool
				preference="auto"
				onPreferenceChange={noop}
				activeCodec="h264"
				avccSupported
				frameRate={frameRate}
				showCodecControls={false}
			/>,
		);

		expect(simulatorHtml).toContain('data-android-simulator-settings=""');
		expect(simulatorHtml).not.toContain('data-stream-fps-history=""');
		expect(streamHtml).toContain('data-stream-settings=""');
		expect(streamHtml).not.toContain(">Codec<");
		expect(streamHtml).not.toContain("<canvas");
	});
});
