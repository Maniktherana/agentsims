// Protocol types used by the simulator UI.

export type SimulatorOrientation =
  | "portrait"
  | "portrait_upside_down"
  | "landscape_left"
  | "landscape_right";

export interface StreamConfig {
  width: number;
  height: number;
  /** Canonical Android presentation revision paired with AVCC generation metadata. */
  presentationGeneration?: number;
  /** Last orientation requested through agentsims, when known. */
  orientation?: SimulatorOrientation;
  /** Logical screen-space corner radii in source pixels. Undefined means unknown. */
  cornerRadii?: {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  };
}
