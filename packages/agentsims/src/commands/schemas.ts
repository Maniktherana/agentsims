import { Schema } from "effect";

export const DeviceIdSchema = Schema.String.pipe(Schema.minLength(1));

export const DeviceListInputSchema = Schema.Struct({
	selectedDevice: Schema.optional(Schema.NullOr(DeviceIdSchema)),
	limit: Schema.optional(
		Schema.NullOr(Schema.Number.pipe(Schema.nonNegative())),
	),
	offset: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
});

export const DeviceStatusInputSchema = Schema.Struct({
	device: DeviceIdSchema,
});

export const DeviceStartInputSchema = Schema.Struct({
	device: DeviceIdSchema,
	port: Schema.Number.pipe(Schema.int(), Schema.between(1, 65_535)),
	basePath: Schema.optional(Schema.String),
});

export const DeviceObserveInputSchema = Schema.Struct({
	device: DeviceIdSchema,
	includeAccessibility: Schema.optional(Schema.Boolean),
});

export const DeviceActInputSchema = Schema.Struct({
	device: DeviceIdSchema,
	actions: Schema.Array(Schema.Unknown),
});

export const DeviceCommandSuccessSchema = Schema.Struct({
	ok: Schema.Literal(true),
});
export const DeviceStartOutputSchema = Schema.Struct({
	device: DeviceIdSchema,
});
export const DeviceObservationOutputSchema = Schema.Struct({
	device: DeviceIdSchema,
	platform: Schema.Literal("ios", "android"),
	capturedAt: Schema.Number,
	screenshot: Schema.Struct({
		mimeType: Schema.String,
		contentBase64: Schema.String,
		bytes: Schema.Number.pipe(Schema.nonNegative()),
	}),
	config: Schema.Unknown,
	accessibility: Schema.Unknown,
	warnings: Schema.Array(Schema.String),
});

export const MediaRouteActionSchema = Schema.Union(
	Schema.Struct({
		action: Schema.Literal("android-host-microphone"),
		enabled: Schema.Boolean,
	}),
	Schema.Struct({
		action: Schema.Literal("android-camera-source"),
		face: Schema.Literal("front", "back"),
		source: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("android-camera-sources"),
		front: Schema.String,
		back: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("ios-camera-source"),
		source: Schema.Literal("placeholder", "webcam", "image", "video"),
		deviceId: Schema.optional(Schema.String),
		path: Schema.optional(Schema.String),
	}),
	Schema.Struct({
		action: Schema.Literal("host-audio-input"),
		deviceId: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("host-audio-output"),
		deviceId: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("android-output-volume"),
		level: Schema.Number,
	}),
	Schema.Struct({
		action: Schema.Literal("audio-output-volume"),
		deviceId: Schema.optional(Schema.String),
		volume: Schema.Number,
	}),
	Schema.Struct({
		action: Schema.Literal("host-audio-output-volume"),
		deviceId: Schema.String,
		volume: Schema.Number,
	}),
	Schema.Struct({
		action: Schema.Literal("android-virtual-scene-image"),
		surface: Schema.Literal("wall", "table"),
		path: Schema.optional(Schema.String),
	}),
	Schema.Struct({ action: Schema.Literal("restart-device") }),
);
export const MediaReadInputSchema = Schema.Struct({ device: DeviceIdSchema });
export const MediaApplyInputSchema = Schema.Struct({
	device: DeviceIdSchema,
	action: Schema.Unknown,
	publicPort: Schema.Number.pipe(Schema.int(), Schema.between(1, 65_535)),
});
