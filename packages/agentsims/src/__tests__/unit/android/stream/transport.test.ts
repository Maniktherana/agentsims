import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import {
	androidTransportKindForSerial,
	isAndroidEmulatorSerial,
} from "../../../../android/stream/transport";
import {
	AndroidAvccFrameCoordinator,
	encodeSimulatorFrameTiming,
	parseImageMetadata,
} from "../../../../android/stream/emulator-controller";
import {
	androidStreamOrientation,
	checkedScrcpyVersion,
	h264ConfigToAvcC,
	packetToAvcc,
	scrcpyServerCandidates,
	scrcpyVideoOptions,
	scrcpyVideoPoint,
} from "../../../../android/stream/scrcpy";

describe("Android stream transport", () => {
	test("decodes exact rotation from emulator screenshot metadata", () => {
		// Image { format: ImageFormat { format: RGBA8888, rotation:
		// Rotation { rotation: REVERSE_PORTRAIT }, width: 2560, height: 1600 } }
		const image = Buffer.from([
			0x0a, 0x0c, 0x08, 0x01, 0x12, 0x02, 0x08, 0x02, 0x18, 0x80, 0x14, 0x20,
			0xc0, 0x0c,
		]);
		expect(parseImageMetadata(image)).toEqual({
			width: 2560,
			height: 1600,
			rotation: 2,
			sequence: 0,
			timestampUs: 0,
		});
	});

	test("accepts only native emulator serials for live Android sessions", () => {
		expect(isAndroidEmulatorSerial("emulator-5554")).toBe(true);
		expect(isAndroidEmulatorSerial("R5CW1234ABC")).toBe(false);
		expect(isAndroidEmulatorSerial("192.168.1.8:5555")).toBe(false);
	});

	test("selects native emulator transport and scrcpy physical-device transport", () => {
		expect(androidTransportKindForSerial("emulator-5554")).toBe(
			"emulator-controller",
		);
		expect(androidTransportKindForSerial("R5CW1234ABC")).toBe("scrcpy");
		expect(androidTransportKindForSerial("192.168.1.8:5555")).toBe("scrcpy");
	});

	test("publishes toolbar-compatible stream orientations", () => {
		expect(androidStreamOrientation(1080, 2424)).toBe("portrait");
		expect(androidStreamOrientation(2424, 1080)).toBe("landscape_left");
	});

	test("treats host scrcpy as an optional physical-device dependency", () => {
		expect(
			scrcpyServerCandidates(
				{ AGENTSIMS_SCRCPY_SERVER_PATH: "/custom/scrcpy-server" },
				"/host-prefix",
			).slice(0, 2),
		).toEqual([
			"/custom/scrcpy-server",
			"/host-prefix/share/scrcpy/scrcpy-server",
		]);
	});

	test("rejects a host scrcpy older than the framing this transport parses", () => {
		expect(checkedScrcpyVersion("3.1")).toBe("3.1");
		expect(checkedScrcpyVersion("10.0.1")).toBe("10.0.1");
		expect(() => checkedScrcpyVersion("2.7")).toThrow(
			"requires scrcpy 3.0 or newer",
		);
	});

	test("caps physical-device capture unless the host overrides it", () => {
		expect(scrcpyVideoOptions({})).toEqual({
			maxSize: 1920,
			bitRate: 8_000_000,
			maxFps: 60,
		});
		expect(
			scrcpyVideoOptions({
				AGENTSIMS_SCRCPY_MAX_SIZE: "1600",
				AGENTSIMS_SCRCPY_BIT_RATE: "8000000",
				AGENTSIMS_SCRCPY_MAX_FPS: "30",
			}),
		).toEqual({ maxSize: 1600, bitRate: 8_000_000, maxFps: 30 });
		// A malformed override must not disable the cap.
		expect(
			scrcpyVideoOptions({ AGENTSIMS_SCRCPY_MAX_SIZE: "huge" }).maxSize,
		).toBe(1920);
	});

	test("rescales input into the encoded video's coordinate space", () => {
		const video = { width: 858, height: 1920 };
		expect(scrcpyVideoPoint(video, 540, 1206, 1080, 2412)).toEqual({
			x: 429,
			y: 960,
			width: 858,
			height: 1920,
		});
		// Corners stay pinned so a tap at the edge cannot land off-screen.
		expect(scrcpyVideoPoint(video, 1080, 2412, 1080, 2412)).toEqual({
			x: 858,
			y: 1920,
			width: 858,
			height: 1920,
		});
		// Without a caller-supplied space the point is already video-relative.
		expect(scrcpyVideoPoint(video, 100, 200)).toEqual({
			x: 100,
			y: 200,
			width: 858,
			height: 1920,
		});
		// Nothing can be mapped before the first session packet names the size.
		expect(scrcpyVideoPoint(null, 10, 10, 100, 100)).toBeNull();
	});

	test("rewrites scrcpy Annex-B packets as the browser's AVCC samples", () => {
		const sps = Buffer.from([0x67, 0x64, 0x00, 0x28, 0xac]);
		const pps = Buffer.from([0x68, 0xee, 0x3c, 0x80]);
		const config = Buffer.concat([
			Buffer.from([0, 0, 0, 1]),
			sps,
			Buffer.from([0, 0, 0, 1]),
			pps,
		]);

		const description = h264ConfigToAvcC(config)!;
		// avcC: version, profile/constraints/level from the SPS, then the
		// parameter sets the WebCodecs decoder is configured with.
		expect(description.subarray(0, 6)).toEqual(
			Buffer.from([0x01, 0x64, 0x00, 0x28, 0xff, 0xe1]),
		);
		expect(description.readUInt16BE(6)).toBe(sps.length);
		expect(description.subarray(8, 8 + sps.length)).toEqual(sps);
		// An already-formed avcC record passes through untouched.
		expect(h264ConfigToAvcC(description)).toEqual(description);

		const frame = Buffer.from([0x65, 0x88, 0x84]);
		const sample = packetToAvcc(
			Buffer.concat([
				Buffer.from([0, 0, 0, 1]),
				sps,
				Buffer.from([0, 0, 0, 1]),
				pps,
				Buffer.from([0, 0, 0, 1]),
				frame,
			]),
		);
		// Parameter sets travel in the description, so the sample carries only the
		// picture NAL, length-prefixed.
		expect(sample).toEqual(
			Buffer.concat([Buffer.from([0, 0, 0, frame.length]), frame]),
		);
	});

	test("encodes only while an AVCC client is attached", () => {
		const orchestration: string[] = [];
		const configs: unknown[] = [];
		const writes: Buffer[] = [];
		const capture = {
			requestKeyframe: () => orchestration.push("keyframe"),
			frame: (width: number, height: number) =>
				orchestration.push(`frame:${width}x${height}`),
		};
		const coordinator = new AndroidAvccFrameCoordinator(
			capture,
			(config) => configs.push(config),
			(count) => orchestration.push(`subscribers:${count}`),
		);

		// Controller metadata remains available to config/input before video is
		// attached, without paying the 60fps RGBA → H.264 cost.
		coordinator.observeFrameMetadata({
			width: 1080,
			height: 2424,
			rotation: 0,
		});
		expect(configs).toEqual([
			{ width: 1080, height: 2424, orientation: "portrait", rotation: 0 },
		]);
		expect(coordinator.currentConfig).toEqual(configs[0]);
		expect(orchestration).toEqual([]);

		const response = Object.assign(new EventEmitter(), {
			writableEnded: false,
			destroyed: false,
			writableLength: 0,
			write(chunk: Buffer) {
				writes.push(chunk);
				return true;
			},
			end() {},
		}) as unknown as ServerResponse;
		coordinator.attach(response);
		expect(orchestration).toEqual([
			"subscribers:1",
			"keyframe",
			"frame:1080x2424",
		]);

		expect(writes).toHaveLength(1);
		expect(writes[0]![4]).toBe(0x05);
		expect(JSON.parse(writes[0]!.subarray(5).toString("utf8"))).toEqual({
			generation: 1,
		});

		const keyframe = Buffer.from([0, 0, 0, 1, 0x02, 0x2a]);
		coordinator.publish(keyframe);
		expect(writes).toEqual([writes[0], keyframe]);

		response.emit("close");
		coordinator.observeFrameMetadata({
			width: 2424,
			height: 1080,
			rotation: 1,
		});
		expect(configs.at(-1)).toEqual({
			width: 2424,
			height: 1080,
			orientation: "landscape_left",
			rotation: 1,
		});
		expect(coordinator.currentConfig).toEqual(configs.at(-1));
		expect(orchestration).toEqual([
			"subscribers:1",
			"keyframe",
			"frame:1080x2424",
			"subscribers:0",
		]);
	});

	test("reports a 180-degree rotation even when frame dimensions do not change", () => {
		const configs: unknown[] = [];
		const coordinator = new AndroidAvccFrameCoordinator(
			{ requestKeyframe: () => {}, frame: () => {} },
			(config) => configs.push(config),
		);

		coordinator.observeFrameMetadata({
			width: 2560,
			height: 1600,
			rotation: 0,
		});
		coordinator.observeFrameMetadata({
			width: 2560,
			height: 1600,
			rotation: 2,
		});

		expect(configs).toEqual([
			{ width: 2560, height: 1600, orientation: "landscape_left", rotation: 0 },
			{ width: 2560, height: 1600, orientation: "landscape_left", rotation: 2 },
		]);
	});

	test("forwards native emulator timing without waiting for encoded output", () => {
		const writes: Buffer[] = [];
		const response = Object.assign(new EventEmitter(), {
			writableEnded: false,
			destroyed: false,
			writableLength: 0,
			write(chunk: Buffer) {
				writes.push(chunk);
				return true;
			},
			end() {},
		}) as unknown as ServerResponse;
		const coordinator = new AndroidAvccFrameCoordinator(
			{ requestKeyframe: () => {}, frame: () => {} },
			() => {},
		);
		coordinator.observeFrameMetadata({
			width: 1080,
			height: 2424,
			rotation: 0,
		});
		coordinator.attach(response);

		coordinator.observeFrameMetadata({
			width: 1080,
			height: 2424,
			rotation: 0,
			sequence: 42,
			timestampUs: 1_234_567,
		});
		expect(writes.at(-1)).toEqual(encodeSimulatorFrameTiming(42, 1_234_567));
		expect(writes.at(-1)?.[4]).toBe(0x06);
		expect(writes.at(-1)?.readBigUInt64BE(5)).toBe(42n);
		expect(writes.at(-1)?.readBigUInt64BE(13)).toBe(1_234_567n);

		const writesAfterTiming = writes.length;
		const keyframe = Buffer.from([0, 0, 0, 1, 0x02, 0x2a]);
		const delta = Buffer.from([0, 0, 0, 1, 0x03, 0x2a]);
		coordinator.publish(keyframe);
		coordinator.publish(delta);
		expect(writes).toHaveLength(writesAfterTiming + 2);

		coordinator.submitIdleFrame(200, 2_000);
		expect(writes).toHaveLength(writesAfterTiming + 2);
	});
});
