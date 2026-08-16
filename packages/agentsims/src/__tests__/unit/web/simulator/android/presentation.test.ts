import { describe, expect, test } from "bun:test";
import {
	androidCutoutEdge,
	androidPresentation,
	androidPresentedOrientation,
	relativeAndroidOrientation,
	relativeAndroidPlaneStyle,
	retainedAndroidDisplayOrientation,
} from "../../../../../web/simulator/android/presentation";

describe("Android presented surface geometry parity", () => {
	test("matches the devtool retained display and relative r0-r3 contract", () => {
		expect(
			retainedAndroidDisplayOrientation(
				null,
				"portrait_upside_down",
				"portrait",
			),
		).toBe("portrait_upside_down");
		expect(
			retainedAndroidDisplayOrientation(
				"portrait_upside_down",
				null,
				"portrait",
			),
		).toBe("portrait_upside_down");
		expect(
			[
				"portrait",
				"landscape_left",
				"portrait_upside_down",
				"landscape_right",
			].map((displayed) =>
				relativeAndroidOrientation(
					displayed as
						| "portrait"
						| "landscape_left"
						| "portrait_upside_down"
						| "landscape_right",
					"portrait",
				),
			),
		).toEqual([
			"portrait",
			"landscape_left",
			"portrait_upside_down",
			"landscape_right",
		]);
		expect(
			relativeAndroidPlaneStyle(
				{ width: 1080, height: 2424 },
				"portrait_upside_down",
			),
		).toEqual({
			rotationDegrees: 180,
			planeStyle: {
				width: "100%",
				height: "100%",
				transform: "translate(-50%, -50%) rotate(180deg)",
				transformOrigin: "center",
			},
		});
	});

	test("keeps exactly one visual transform owner around untransformed media and AX", async () => {
		const simulatorView = await Bun.file(
			new URL(
				"../../../../../web/components/simulator/simulator-view.tsx",
				import.meta.url,
			),
		).text();
		const workspace = await Bun.file(
			new URL(
				"../../../../../web/components/workspace/simulator-device-view.tsx",
				import.meta.url,
			),
		).text();
		expect(simulatorView).toContain("data-agentsims-presentation-plane");
		expect(simulatorView).toContain('transform: "none"');
		expect(simulatorView).toContain("{presentationOverlay}");
		expect(simulatorView).toContain(
			"const presentationScreenSize = relayMode && streamConfig ? streamConfig : screenSize;",
		);
		expect(simulatorView).toContain("if (hasPresentationPlane) return null;");
		expect(simulatorView).toContain(
			'position: hasPresentationPlane ? "absolute" : "relative"',
		);
		expect(simulatorView).toContain(
			"inset: hasPresentationPlane ? 0 : undefined",
		);
		expect(simulatorView).toContain("? (presentationRotationDegrees ?? 0)");
		expect(workspace).toContain(
			"presentationPlaneStyle={isAndroidDevice ? effectivePlane.planeStyle : undefined}",
		);
		expect(workspace).not.toContain("androidPresentationPendingRef.current");
	});

	test("carries current frame rotation through orientation and cutout r0-r3", () => {
		expect(
			[0, 1, 2, 3].map((rotation) =>
				androidPresentedOrientation(rotation as 0 | 1 | 2 | 3, 1080, 2424),
			),
		).toEqual([
			"portrait",
			"landscape_left",
			"portrait_upside_down",
			"landscape_right",
		]);
		expect(
			[0, 1, 2, 3].map((rotation) =>
				androidCutoutEdge(rotation as 0 | 1 | 2 | 3),
			),
		).toEqual(["top", "right", "bottom", "left"]);
	});

	test("keeps raw encoder dimensions out of canonical corner geometry", () => {
		const presentation = androidPresentation(
			{
				width: 1080,
				height: 2424,
				orientation: "portrait",
				cornerRadii: {
					topLeft: 132,
					topRight: 132,
					bottomRight: 132,
					bottomLeft: 132,
				},
			},
			{ width: 1080, height: 480, presentationGeneration: 1 },
		);
		expect(presentation.displayConfig).toEqual({
			width: 1080,
			height: 2424,
			orientation: "portrait",
			cornerRadii: {
				topLeft: 132,
				topRight: 132,
				bottomRight: 132,
				bottomLeft: 132,
			},
		});
	});
});
