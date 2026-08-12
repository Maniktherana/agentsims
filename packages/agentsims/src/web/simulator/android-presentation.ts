import type { CSSProperties } from "react";
import type { SimulatorOrientation, StreamConfig } from "../types.js";
import { streamDisplayGeometry } from "./orientation.js";

export type AndroidPresentedFrame = {
  width: number;
  height: number;
  presentationGeneration?: number;
};

export type AndroidPresentation = ReturnType<typeof streamDisplayGeometry> & {
  displayConfig: StreamConfig | null;
  planeStyle: CSSProperties;
  cutoutEdge: "top" | "right" | "bottom" | "left";
  canonicalJoined: boolean;
};

const ORIENTATIONS: readonly SimulatorOrientation[] = [
  "portrait",
  "landscape_left",
  "portrait_upside_down",
  "landscape_right",
];

export function retainedAndroidDisplayOrientation(
  previous: SimulatorOrientation | null,
  desired: SimulatorOrientation | null | undefined,
  canonical: SimulatorOrientation | null | undefined,
): SimulatorOrientation {
  return desired ?? previous ?? canonical ?? "portrait";
}

export function relativeAndroidOrientation(
  displayed: SimulatorOrientation | undefined,
  canonical: SimulatorOrientation | undefined,
): SimulatorOrientation {
  const displayedIndex = ORIENTATIONS.indexOf(displayed ?? "portrait");
  const canonicalIndex = ORIENTATIONS.indexOf(canonical ?? "portrait");
  return ORIENTATIONS[(displayedIndex - canonicalIndex + 4) % 4]!;
}

export function relativeAndroidPlaneStyle(
  displayConfig: Pick<StreamConfig, "width" | "height"> | null,
  relativeOrientation: SimulatorOrientation,
): { rotationDegrees: number; planeStyle: CSSProperties } {
  const rotationDegrees = [0, 90, 180, -90][
    ORIENTATIONS.indexOf(relativeOrientation)
  ]!;
  const odd = Math.abs(rotationDegrees) === 90;
  const displayRatio = displayConfig ? displayConfig.width / displayConfig.height : 1;
  return {
    rotationDegrees,
    planeStyle: {
      width: odd ? `${100 / displayRatio}%` : "100%",
      height: odd ? `${100 * displayRatio}%` : "100%",
      transform: `translate(-50%, -50%)${
        rotationDegrees === 0 ? "" : ` rotate(${rotationDegrees}deg)`
      }`,
      transformOrigin: "center",
    },
  };
}

export function androidPresentedOrientation(
  rotation: 0 | 1 | 2 | 3,
  rawWidth: number,
  rawHeight: number,
): SimulatorOrientation {
  const nativeOffset = rawWidth > rawHeight ? 1 : 0;
  return ORIENTATIONS[(rotation + nativeOffset) % 4]!;
}

export function androidCutoutEdge(
  rotation: 0 | 1 | 2 | 3,
): AndroidPresentation["cutoutEdge"] {
  return ["top", "right", "bottom", "left"][rotation] as AndroidPresentation["cutoutEdge"];
}

/** Exact mobile-use-devtool Android presentation contract. */
export function androidPresentation(
  config: StreamConfig | null,
  rawFrameSize?: AndroidPresentedFrame | null,
): AndroidPresentation {
  const canonicalGeometry = streamDisplayGeometry(config);
  const rawConfig = config
    ? {
        ...config,
        ...(rawFrameSize && rawFrameSize.width > 0 && rawFrameSize.height > 0
          ? { width: rawFrameSize.width, height: rawFrameSize.height }
          : {}),
      }
    : null;
  const geometry = streamDisplayGeometry(rawConfig);
  const displayConfig = canonicalGeometry.displayConfig;
  const sideways = geometry.needsCssRotation && Math.abs(geometry.rotationDegrees) === 90;
  const displayRatio = displayConfig ? displayConfig.width / displayConfig.height : 1;
  return {
    ...geometry,
    displayConfig,
    cutoutEdge: androidCutoutEdge(Math.max(
      0,
      ORIENTATIONS.indexOf(config?.orientation ?? "portrait"),
    ) as 0 | 1 | 2 | 3),
    canonicalJoined: true,
    planeStyle: {
      width: sideways ? `${100 / displayRatio}%` : "100%",
      height: sideways ? `${100 * displayRatio}%` : "100%",
      transform: `translate(-50%, -50%)${
        geometry.rotationDegrees === 0 ? "" : ` rotate(${geometry.rotationDegrees}deg)`
      }`,
    },
  };
}
