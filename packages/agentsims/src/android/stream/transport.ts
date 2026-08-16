import type { ServerResponse } from "http";
import { AndroidEmulatorSession, type AndroidEmulatorConfig, type AvccSubscriberSink } from "./emulator-controller";

export type AndroidTransportConfig = AndroidEmulatorConfig;
export type AndroidTouchPhase = "begin" | "move" | "end" | "cancel";
export type AndroidButtonPhase = "down" | "up" | "press";

export interface AndroidTransport {
  readonly backend: "emulator-controller";
  readonly wireTransport: "mmap-ffmpeg-h264";
  readonly closed: boolean;
  readonly running: boolean;
  readonly subscriberCount: number;
  readonly inputReady: boolean;

  start(): Promise<void>;
  close(): void;
  attachAvcc(res: ServerResponse): Promise<void>;
  attachAvccSink(sink: AvccSubscriberSink): Promise<() => void>;
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

export function isAndroidEmulatorSerial(serial: string): boolean {
  return /^emulator-\d+$/.test(serial);
}

export function createAndroidTransport(
  serial: string,
  physicalScreen: { width: number; height: number; presentationGeneration?: number },
  onConfig: (config: AndroidTransportConfig) => void,
  onSubscriberCountChange: (count: number) => void,
): AndroidTransport {
  if (!isAndroidEmulatorSerial(serial)) {
    throw new Error(`Agentsims live Android sessions require an emulator: ${serial}`);
  }
  return new AndroidEmulatorSession(serial, physicalScreen, onConfig, onSubscriberCountChange);
}
