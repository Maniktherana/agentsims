import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SimulatorView } from "../../../../../web/components/simulator/simulator-view";
import { AxTarget } from "../../../../../web/components/accessibility/target";

function renderAndroidSelection(selecting: boolean) {
	return renderToStaticMarkup(
		<SimulatorView
			url="http://localhost:3100"
			hideControls
			codec="mjpeg"
			onStreamTouch={() => {}}
			streamConfig={{ width: 1080, height: 2400, orientation: "portrait" }}
			inputDisabled={selecting}
			presentationPlaneStyle={{
				width: 270,
				height: 600,
				transform: "translate(-50%, -50%) rotate(90deg)",
			}}
			presentationOverlay={
				<AxTarget
					element={{
						id: "settings",
						path: "0.0",
						label: "Settings",
						value: "",
						role: "android.widget.Button",
						type: "android.widget.Button",
						enabled: true,
						frame: { x: 24, y: 200, width: 160, height: 80 },
					}}
					index={0}
					screen={{ width: 1080, height: 2400 }}
					highlighted={false}
					selected={false}
					interactive={selecting}
					onHighlight={() => {}}
					onSelect={() => {}}
				/>
			}
		/>,
	);
}

function inputLayerTag(html: string) {
	const tag = html.match(
		/<div\b[^>]*style="[^"]*touch-action:none[^"]*"[^>]*>/,
	)?.[0];
	expect(tag).toBeDefined();
	return tag ?? "";
}

describe("SimulatorView accessibility input", () => {
	test("passes pointers through the stream layer to Android selection targets", () => {
		const html = renderAndroidSelection(true);
		expect(inputLayerTag(html)).toContain("pointer-events:none");
		expect(html).toContain("pointer-events-auto");
		expect(html).toContain("translate(-50%, -50%) rotate(90deg)");
	});

	test("restores stream input when selection ends", () => {
		const html = renderAndroidSelection(false);
		expect(inputLayerTag(html)).not.toContain("pointer-events:none");
		expect(html).not.toContain("pointer-events-auto");
		expect(html).toContain("pointer-events-none");
	});
});
