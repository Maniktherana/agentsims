// Protocol types used by the simulator UI.

export type SimulatorOrientation =
  | "portrait"
  | "portrait_upside_down"
  | "landscape_left"
  | "landscape_right";

export interface StreamConfig {
  width: number;
  height: number;
  /** Last orientation requested through agentsims, when known. */
  orientation?: SimulatorOrientation;
}
