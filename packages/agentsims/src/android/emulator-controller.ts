import { connect, type ClientHttp2Session, type ClientHttp2Stream } from "node:http2";
import { closeSync, ftruncateSync, openSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { NativeAndroidCapture } from "../ios/native";

const SCREENSHOT_METHOD = "/android.emulation.control.EmulatorController/streamScreenshot";
const INPUT_METHOD = "/android.emulation.control.EmulatorController/streamInputEvent";
// Keep capture at the emulator's native resolution. Asking streamScreenshot
// to resize every animated RGBA frame makes the emulator do a full software
// scale before writing MMAP; VideoToolbox can encode the native framebuffer
// directly without that per-frame emulator cost.
const MAX_STREAM_DIMENSION = 4096;
const MAX_SUBSCRIBER_BUFFER_BYTES = 512 * 1024;
const AVCC_TAG_DESCRIPTION = 0x01;
const AVCC_TAG_KEYFRAME = 0x02;
const AVCC_TAG_DELTA = 0x03;

export type AndroidEmulatorConfig = {
  width: number;
  height: number;
  orientation: "portrait" | "landscape_left";
};

type ControllerMetadata = {
  pid: number;
  port: number;
  token: string;
};

type AvccSubscriber = {
  res: ServerResponse;
  waitingForKeyframe: boolean;
  needsKeyframe: boolean;
};

function encodeVarint(value: number | bigint): Buffer {
  const bytes: number[] = [];
  let remaining = BigInt(value);
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function varintField(field: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeVarint(field << 3), encodeVarint(value)]);
}

function bytesField(field: number, value: Uint8Array): Buffer {
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(value.length), value]);
}

function stringField(field: number, value: string): Buffer {
  return bytesField(field, Buffer.from(value, "utf8"));
}

function grpcFrame(message: Uint8Array): Buffer {
  const header = Buffer.allocUnsafe(5);
  header[0] = 0;
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

function readVarint(buffer: Uint8Array, offset: number): { value: bigint; offset: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor++]!;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    shift += 7n;
  }
  throw new Error("Truncated protobuf varint");
}

function decodeFields(buffer: Uint8Array): Map<number, bigint | Uint8Array> {
  const fields = new Map<number, bigint | Uint8Array>();
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (wire === 0) {
      const decoded = readVarint(buffer, offset);
      fields.set(field, decoded.value);
      offset = decoded.offset;
      continue;
    }
    if (wire === 2) {
      const decoded = readVarint(buffer, offset);
      const length = Number(decoded.value);
      offset = decoded.offset;
      fields.set(field, buffer.subarray(offset, offset + length));
      offset += length;
      continue;
    }
    const byteLength = wire === 1 ? 8 : wire === 5 ? 4 : 0;
    if (!byteLength) throw new Error(`Unsupported protobuf wire type ${wire}`);
    fields.set(field, buffer.subarray(offset, offset + byteLength));
    offset += byteLength;
  }
  return fields;
}

function numericField(fields: Map<number, bigint | Uint8Array>, field: number): number {
  const value = fields.get(field);
  return typeof value === "bigint" ? Number(value) : 0;
}

function parseImageDimensions(message: Uint8Array): { width: number; height: number } {
  const image = decodeFields(message);
  const encodedFormat = image.get(1);
  if (encodedFormat instanceof Uint8Array) {
    const format = decodeFields(encodedFormat);
    const width = numericField(format, 3);
    const height = numericField(format, 4);
    if (width && height) return { width, height };
  }
  return { width: numericField(image, 2), height: numericField(image, 3) };
}

function parseIni(path: string): Map<string, string> {
  return new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function controllerMetadata(serial: string): ControllerMetadata {
  const serialPort = serial.match(/^emulator-(\d+)$/)?.[1];
  if (!serialPort) throw new Error(`${serial} is not an Android emulator`);
  const running = join(homedir(), "Library/Caches/TemporaryItems/avd/running");
  for (const name of readdirSync(running)) {
    const match = name.match(/^pid_(\d+)\.ini$/);
    if (!match) continue;
    const values = parseIni(join(running, name));
    if (values.get("port.serial") !== serialPort) continue;
    const port = Number(values.get("grpc.port"));
    const token = values.get("grpc.token");
    if (!port || !token) break;
    return { pid: Number(match[1]), port, token };
  }
  throw new Error(`No emulator gRPC controller found for ${serial}`);
}

function targetDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_STREAM_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
}

function screenshotRequest(width: number, height: number, mmapPath: string): Buffer {
  const transport = Buffer.concat([
    varintField(1, 1),
    stringField(2, `file://${mmapPath}`),
  ]);
  return Buffer.concat([
    varintField(1, 1),
    varintField(3, width),
    varintField(4, height),
    bytesField(6, transport),
  ]);
}

function touchInputEvent(
  touches: Array<{ x: number; y: number; identifier: number; pressure: number }>,
): Buffer {
  const touchEvent = Buffer.concat(touches.map((touch) => bytesField(1, Buffer.concat([
    varintField(1, Math.max(0, Math.round(touch.x))),
    varintField(2, Math.max(0, Math.round(touch.y))),
    varintField(3, touch.identifier),
    varintField(4, touch.pressure),
    varintField(7, 1),
  ]))));
  return bytesField(2, touchEvent);
}

function orientation(width: number, height: number): AndroidEmulatorConfig["orientation"] {
  return width > height ? "landscape_left" : "portrait";
}

function requestHeaders(method: string, token: string) {
  return {
    ":method": "POST",
    ":path": method,
    "content-type": "application/grpc",
    te: "trailers",
    authorization: `Bearer ${token}`,
  } as const;
}

export class AndroidEmulatorSession {
  readonly backend = "emulator-controller" as const;
  readonly wireTransport = "mmap-videotoolbox-h264" as const;
  private readonly metadata: ControllerMetadata;
  private readonly requested: { width: number; height: number };
  private readonly mmapPath: string;
  private client: ClientHttp2Session | null = null;
  private screenshots: ClientHttp2Stream | null = null;
  private input: ClientHttp2Stream | null = null;
  private capture: NativeAndroidCapture | null = null;
  private unsubscribeCapture: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private stopped = false;
  private pendingGrpc = Buffer.alloc(0);
  private subscribers = new Set<AvccSubscriber>();
  private lastDescription: Buffer | null = null;
  private currentConfig: AndroidEmulatorConfig | null = null;

  constructor(
    private readonly serial: string,
    private readonly physicalScreen: { width: number; height: number },
    private readonly onConfig: (config: AndroidEmulatorConfig) => void,
    private readonly onSubscriberCountChange?: (count: number) => void,
  ) {
    this.metadata = controllerMetadata(serial);
    this.requested = targetDimensions(physicalScreen.width, physicalScreen.height);
    this.mmapPath = join(tmpdir(), `agentsims-${this.metadata.pid}-${process.pid}.rgba`);
  }

  get running(): boolean {
    return !!this.screenshots && !this.screenshots.destroyed && !this.stopped;
  }

  get closed(): boolean {
    return this.stopped;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  get inputReady(): boolean {
    return !!this.input && !this.input.destroyed && !this.stopped;
  }

  async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.startImpl().catch((error) => {
        this.close();
        throw error;
      });
    }
    return this.startPromise;
  }

  async attachAvcc(res: ServerResponse): Promise<void> {
    await this.start();
    const subscriber: AvccSubscriber = {
      res,
      waitingForKeyframe: true,
      needsKeyframe: false,
    };
    this.subscribers.add(subscriber);
    this.onSubscriberCountChange?.(this.subscribers.size);
    if (this.lastDescription) this.writeSubscriber(subscriber, this.lastDescription);
    this.capture?.requestKeyframe();
    if (this.currentConfig) this.capture?.frame(this.currentConfig.width, this.currentConfig.height);

    let attached = true;
    const cleanup = () => {
      if (!attached) return;
      attached = false;
      this.subscribers.delete(subscriber);
      this.onSubscriberCountChange?.(this.subscribers.size);
    };
    const resume = () => {
      if (!this.subscribers.has(subscriber) || !subscriber.needsKeyframe) return;
      subscriber.needsKeyframe = false;
      this.capture?.requestKeyframe();
      if (this.currentConfig) this.capture?.frame(this.currentConfig.width, this.currentConfig.height);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
    res.on("drain", resume);
  }

  resetVideo(): boolean {
    this.capture?.requestKeyframe();
    return !!this.capture;
  }

  injectTouch(
    phase: "begin" | "move" | "end" | "cancel",
    x: number,
    y: number,
    _width?: number,
    _height?: number,
  ): boolean {
    return this.writeTouches(phase, [{ x, y, identifier: 1 }]);
  }

  injectMultiTouch(
    phase: "begin" | "move" | "end" | "cancel",
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    _width?: number,
    _height?: number,
  ): boolean {
    return this.writeTouches(phase, [
      { x: x1, y: y1, identifier: 1 },
      { x: x2, y: y2, identifier: 2 },
    ]);
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const subscriber of this.subscribers) {
      try { subscriber.res.end(); } catch {}
    }
    this.subscribers.clear();
    this.onSubscriberCountChange?.(0);
    this.unsubscribeCapture?.();
    this.unsubscribeCapture = null;
    this.capture?.stop();
    this.capture = null;
    this.input?.end();
    this.input?.close();
    this.screenshots?.close();
    this.client?.close();
    this.input = null;
    this.screenshots = null;
    this.client = null;
    try { unlinkSync(this.mmapPath); } catch {}
  }

  private async startImpl(): Promise<void> {
    console.log(`[DEBUG-grpc-start] ${this.serial} opening MMAP capture`);
    const file = openSync(this.mmapPath, "w");
    ftruncateSync(file, this.requested.width * this.requested.height * 4);
    closeSync(file);

    this.capture = new NativeAndroidCapture(this.mmapPath);
    this.unsubscribeCapture = await this.capture.subscribeAvcc(async (frame) => {
      const chunk = Buffer.from(frame.data);
      if (frame.isDescription) {
        this.lastDescription = chunk;
      }
      this.broadcast(chunk);
    });
    console.log(`[DEBUG-grpc-start] ${this.serial} native encoder subscribed`);

    this.client = connect(`http://127.0.0.1:${this.metadata.port}`);
    this.client.on("error", () => this.close());
    this.input = this.client.request(requestHeaders(INPUT_METHOD, this.metadata.token));
    this.input.on("error", () => {
      this.input = null;
    });

    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      const fail = (error: Error) => {
        if (!resolved) reject(error);
        else this.close();
      };
      this.screenshots = this.client!.request(requestHeaders(SCREENSHOT_METHOD, this.metadata.token));
      this.screenshots.on("response", (headers) => {
        if (headers[":status"] !== 200) fail(new Error(`Emulator gRPC HTTP ${headers[":status"]}`));
      });
      this.screenshots.on("data", (chunk: Buffer) => {
        this.pendingGrpc = Buffer.concat([this.pendingGrpc, chunk]);
        while (this.pendingGrpc.length >= 5) {
          const compressed = this.pendingGrpc[0];
          const length = this.pendingGrpc.readUInt32BE(1);
          if (this.pendingGrpc.length < 5 + length) break;
          if (compressed !== 0) {
            fail(new Error("Compressed emulator gRPC frames are unsupported"));
            return;
          }
          const dimensions = parseImageDimensions(this.pendingGrpc.subarray(5, 5 + length));
          this.pendingGrpc = this.pendingGrpc.subarray(5 + length);
          if (!dimensions.width || !dimensions.height) continue;
          const config: AndroidEmulatorConfig = {
            ...dimensions,
            orientation: orientation(dimensions.width, dimensions.height),
          };
          if (
            !this.currentConfig ||
            config.width !== this.currentConfig.width ||
            config.height !== this.currentConfig.height
          ) {
            this.currentConfig = config;
            this.onConfig(config);
          }
          this.capture?.frame(dimensions.width, dimensions.height);
          if (!resolved) {
            resolved = true;
            console.log(`[DEBUG-grpc-start] ${this.serial} first frame ${dimensions.width}x${dimensions.height}`);
            resolve();
          }
        }
      });
      this.screenshots.on("trailers", (trailers) => {
        if (trailers["grpc-status"] !== "0") {
          fail(new Error(String(trailers["grpc-message"] ?? "Emulator screenshot stream failed")));
        }
      });
      this.screenshots.on("error", fail);
      this.screenshots.end(grpcFrame(screenshotRequest(
        this.requested.width,
        this.requested.height,
        this.mmapPath,
      )));
    });
    console.log(`[DEBUG-grpc-start] ${this.serial} ready`);
  }

  private writeTouches(
    phase: "begin" | "move" | "end" | "cancel",
    touches: Array<{ x: number; y: number; identifier: number }>,
  ): boolean {
    if (!this.input || this.input.destroyed || this.stopped) return false;
    const pressure = phase === "end" || phase === "cancel" ? 0 : 1024;
    try {
      this.input.write(grpcFrame(touchInputEvent(touches.map((touch) => ({ ...touch, pressure })))))
      return true;
    } catch {
      return false;
    }
  }

  private writeSubscriber(subscriber: AvccSubscriber, chunk: Buffer): void {
    if (subscriber.res.writableEnded || subscriber.res.destroyed) return;
    const tag = chunk[4];
    if (subscriber.res.writableLength >= MAX_SUBSCRIBER_BUFFER_BYTES) {
      if (tag === AVCC_TAG_KEYFRAME || tag === AVCC_TAG_DELTA) {
        subscriber.waitingForKeyframe = true;
        subscriber.needsKeyframe = true;
      }
      return;
    }
    if (subscriber.waitingForKeyframe) {
      if (tag === AVCC_TAG_DESCRIPTION) {
        subscriber.res.write(chunk);
      } else if (tag === AVCC_TAG_KEYFRAME) {
        subscriber.waitingForKeyframe = false;
        subscriber.res.write(chunk);
      }
      return;
    }
    subscriber.res.write(chunk);
  }

  private broadcast(chunk: Buffer): void {
    for (const subscriber of this.subscribers) this.writeSubscriber(subscriber, chunk);
  }
}
