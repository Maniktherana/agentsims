import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamStatusPill } from "../../../../../web/components/simulator/stream-status-pill";
import { SimulatorFrameRateStore } from "../../../../../web/simulator/stream/simulator-frame-rate";

function measuredRate(fps: number) {
	const rate = new SimulatorFrameRateStore();
	rate.start();
	if (fps === 0) {
		rate.recordTiming(1n, 0n);
		rate.recordTiming(2n, 1_000_000_000n);
	} else {
		rate.recordTiming(1n, 1_000_000n);
		rate.recordTiming(2n, 1_000_000n + BigInt(Math.round(1_000_000 / fps)));
	}
	return rate;
}

describe("StreamStatusPill", () => {
	test("renders live state", () => {
		const html = renderToStaticMarkup(
			<StreamStatusPill phase="streaming" frameRate={measuredRate(60)} />,
		);

		expect(html.replace(/<[^>]+>/g, "")).toContain("60 FPS");
		expect(html).not.toContain(">live</span>");
		expect(html).not.toContain("connecting");
	});

	test("reserves the FPS slot and shows an em dash for the first live window", () => {
		const html = renderToStaticMarkup(
			<StreamStatusPill
				phase="streaming"
				frameRate={new SimulatorFrameRateStore()}
			/>,
		);

		expect(html.replace(/<[^>]+>/g, "")).toContain("— FPS");
	});

	test("renders a measured zero", () => {
		const html = renderToStaticMarkup(
			<StreamStatusPill phase="streaming" frameRate={measuredRate(0)} />,
		);

		expect(html.replace(/<[^>]+>/g, "")).toContain("0 FPS");
	});

	test("shows lifecycle states instead of live FPS", () => {
		for (const [phase, label] of [
			["booting", "Booting"],
			["connecting", "Connecting"],
			["shutting-down", "Shutting down"],
		] as const) {
			const html = renderToStaticMarkup(
				<StreamStatusPill phase={phase} frameRate={measuredRate(60)} />,
			);
			expect(html).toContain(label);
			expect(html).not.toContain("60 FPS");
			expect(html).not.toContain(">live</span>");
		}
	});

	test("announces transient lifecycle text but not redundant steady-live status", () => {
		const connecting = renderToStaticMarkup(
			<StreamStatusPill phase="connecting" frameRate={measuredRate(60)} />,
		);
		const live = renderToStaticMarkup(
			<StreamStatusPill phase="streaming" frameRate={measuredRate(60)} />,
		);

		expect(connecting).toContain('aria-live="polite"');
		expect(connecting).toContain("Connecting");
		expect(live).toContain('aria-live="polite"');
		expect(live).not.toContain("Streaming");
		expect(live).not.toContain(">live</span>");
	});
});
