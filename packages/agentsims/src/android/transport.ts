import type { ServerResponse } from "http";
import { AndroidEmulatorSession, type AndroidEmulatorConfig } from "./emulator-controller";
import {
  AndroidScrcpySession,
  type AndroidButtonPhase,
  type AndroidScrcpyConfig,
  type AndroidTouchPhase,
} from "./scrcpy";

export type AndroidTransportConfig = AndroidEmulatorConfig | AndroidScrcpyConfig;

export interface AndroidTransport {
  readonly backend: "emulator-controller" | "scrcpy";
  readonly wireTransport: "mmap-ffmpeg-h264" | "scrcpy-h264";
  readonly closed: boolean;
  readonly running: boolean;
  readonly subscriberCount: number;
  readonly inputReady: boolean;

  start(): Promise<void>;
  close(): void;
  attachAvcc(res: ServerResponse): Promise<void>;
  resetVideo(): boolean;
  setPresentationGeneration?(generation: number): void;
  injectTouch(
    phase: AndroidTouchPhase,
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): boolean;
  injectMultiTouch(
    phase: AndroidTouchPhase,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width?: number,
    height?: number,
  ): boolean;
  injectScroll?(
    x: number,
    y: number,
    hScroll: number,
    vScroll: number,
    width?: number,
    height?: number,
  ): boolean;
  injectKeycode?(keycode: number, phase?: AndroidButtonPhase): boolean;
  rotateDevice?(): boolean;
}

export function androidTransportKindForSerial(serial: string): AndroidTransport["backend"] {
  return /^emulator-\d+$/.test(serial) ? "emulator-controller" : "scrcpy";
}

export function createAndroidTransport(
  serial: string,
  physicalScreen: { width: number; height: number; presentationGeneration?: number },
  onConfig: (config: AndroidTransportConfig) => void,
  onSubscriberCountChange: (count: number) => void,
): AndroidTransport {
  if (androidTransportKindForSerial(serial) === "emulator-controller") {
    return new AndroidEmulatorSession(serial, physicalScreen, onConfig, onSubscriberCountChange);
  }
  return new AndroidScrcpySession(serial, onConfig, onSubscriberCountChange);
}
