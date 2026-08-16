import { createConnection } from "node:net";
import { connect } from "node:http2";
import { execFileSync } from "node:child_process";
import {
	closeSync,
	ftruncateSync,
	openSync,
	readFileSync,
	readdirSync,
	unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const METHOD = "/android.emulation.control.EmulatorController/streamScreenshot";

function encodeVarint(value) {
	const bytes = [];
	let remaining = BigInt(value);
	while (remaining >= 0x80n) {
		bytes.push(Number((remaining & 0x7fn) | 0x80n));
		remaining >>= 7n;
	}
	bytes.push(Number(remaining));
	return Buffer.from(bytes);
}

function uint32Field(field, value) {
	return Buffer.concat([encodeVarint(field << 3), encodeVarint(value)]);
}

function bytesField(field, value) {
	return Buffer.concat([
		encodeVarint((field << 3) | 2),
		encodeVarint(value.length),
		value,
	]);
}

function stringField(field, value) {
	return bytesField(field, Buffer.from(value, "utf8"));
}

function grpcFrame(message) {
	const header = Buffer.allocUnsafe(5);
	header[0] = 0;
	header.writeUInt32BE(message.length, 1);
	return Buffer.concat([header, message]);
}

function readVarint(buffer, offset) {
	let value = 0n;
	let shift = 0n;
	let cursor = offset;
	while (cursor < buffer.length) {
		const byte = buffer[cursor++];
		value |= BigInt(byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) return { value, offset: cursor };
		shift += 7n;
	}
	throw new Error("Truncated protobuf varint");
}

function decodeFields(buffer) {
	const fields = new Map();
	let offset = 0;
	while (offset < buffer.length) {
		const tag = readVarint(buffer, offset);
		offset = tag.offset;
		const field = Number(tag.value >> 3n);
		const wire = Number(tag.value & 7n);
		let value;
		if (wire === 0) {
			const decoded = readVarint(buffer, offset);
			value = decoded.value;
			offset = decoded.offset;
		} else if (wire === 2) {
			const decoded = readVarint(buffer, offset);
			const length = Number(decoded.value);
			offset = decoded.offset;
			value = buffer.subarray(offset, offset + length);
			offset += length;
		} else if (wire === 1) {
			value = buffer.subarray(offset, offset + 8);
			offset += 8;
		} else if (wire === 5) {
			value = buffer.subarray(offset, offset + 4);
			offset += 4;
		} else {
			throw new Error(`Unsupported protobuf wire type ${wire}`);
		}
		fields.set(field, value);
	}
	return fields;
}

function emulatorController() {
	const running = join(homedir(), "Library/Caches/TemporaryItems/avd/running");
	const ini = readdirSync(running).find((name) => /^pid_\d+\.ini$/.test(name));
	if (!ini)
		throw new Error("No running Android emulator controller metadata found");
	const values = new Map(
		readFileSync(join(running, ini), "utf8")
			.split("\n")
			.filter((line) => line.includes("="))
			.map((line) => {
				const separator = line.indexOf("=");
				return [line.slice(0, separator), line.slice(separator + 1)];
			}),
	);
	return {
		pid: Number(ini.slice(4, -4)),
		port: Number(values.get("grpc.port")),
		token: values.get("grpc.token"),
	};
}

function imageFormat(width, height, mmapPath) {
	const fields = [
		uint32Field(1, 1),
		uint32Field(3, width),
		uint32Field(4, height),
	];
	if (mmapPath) {
		const transport = Buffer.concat([
			uint32Field(1, 1),
			stringField(2, `file://${mmapPath}`),
		]);
		fields.push(bytesField(6, transport));
	}
	return Buffer.concat(fields);
}

function parseImage(message) {
	const fields = decodeFields(message);
	const format = decodeFields(fields.get(1));
	return {
		width: Number(format.get(3) ?? fields.get(2) ?? 0n),
		height: Number(format.get(4) ?? fields.get(3) ?? 0n),
		bytes: fields.get(4)?.length ?? 0,
		seq: Number(fields.get(5) ?? 0n),
		timestampUs: Number(fields.get(6) ?? 0n),
	};
}

function inputEvent(x, y, pressure) {
	const touch = Buffer.concat([
		uint32Field(1, x),
		uint32Field(2, y),
		uint32Field(3, 1),
		uint32Field(4, pressure),
		uint32Field(7, 1),
	]);
	const touchEvent = bytesField(1, touch);
	return bytesField(2, touchEvent);
}

function processCpu(pid) {
	return Number(
		execFileSync("ps", ["-p", String(pid), "-o", "%cpu="], {
			encoding: "utf8",
		}).trim(),
	);
}

const { pid, port, token } = emulatorController();
const width = Number(process.argv[2] ?? 456);
const height = Number(process.argv[3] ?? 1024);
const seconds = Number(process.argv[4] ?? 5);
const drive = process.argv.includes("--drive");
const mmap = process.argv.includes("--mmap");
const mmapPath = mmap
	? `/private/tmp/agentsims-grpc-${process.pid}.rgba`
	: null;
if (mmapPath) {
	const file = openSync(mmapPath, "w");
	ftruncateSync(file, width * height * 4);
	closeSync(file);
}
const client = connect(`http://127.0.0.1:${port}`, {
	createConnection: () => createConnection({ host: "127.0.0.1", port }),
});
const request = client.request({
	":method": "POST",
	":path": METHOD,
	"content-type": "application/grpc",
	te: "trailers",
	authorization: `Bearer ${token}`,
});

const input = drive
	? client.request({
			":method": "POST",
			":path": "/android.emulation.control.EmulatorController/streamInputEvent",
			"content-type": "application/grpc",
			te: "trailers",
			authorization: `Bearer ${token}`,
		})
	: null;

let pending = Buffer.alloc(0);
let frames = 0;
let bytes = 0;
let first;
let latest;
const cpu = [];
const started = performance.now();

request.on("response", (headers) => {
	if (headers[":status"] !== 200) console.error("response", headers);
});
request.on("data", (chunk) => {
	pending = Buffer.concat([pending, chunk]);
	while (pending.length >= 5) {
		const compressed = pending[0];
		const length = pending.readUInt32BE(1);
		if (pending.length < 5 + length) break;
		if (compressed !== 0)
			throw new Error("Compressed gRPC messages are unsupported");
		const image = parseImage(pending.subarray(5, 5 + length));
		pending = pending.subarray(5 + length);
		first ??= image;
		latest = image;
		frames += 1;
		bytes += image.bytes;
	}
});
request.on("trailers", (trailers) => {
	if (trailers["grpc-status"] !== "0") console.error("trailers", trailers);
});
request.on("error", (error) => {
	console.error(error);
	process.exitCode = 1;
});

request.end(grpcFrame(imageFormat(width, height, mmapPath)));

let inputTimer;
if (input) {
	let step = 0;
	input.write(grpcFrame(inputEvent(540, 1900, 1024)));
	inputTimer = setInterval(() => {
		const progress = (step++ % 120) / 119;
		const y = Math.round(1900 - Math.sin(progress * Math.PI) * 900);
		input.write(grpcFrame(inputEvent(540, y, 1024)));
	}, 1000 / 60);
}
const cpuTimer = setInterval(() => cpu.push(processCpu(pid)), 500);

setTimeout(() => {
	const elapsed = (performance.now() - started) / 1000;
	clearInterval(cpuTimer);
	if (inputTimer) clearInterval(inputTimer);
	if (input) {
		input.write(grpcFrame(inputEvent(540, 1900, 0)));
		input.end();
	}
	request.close();
	client.close();
	if (mmapPath) unlinkSync(mmapPath);
	console.log(
		JSON.stringify(
			{
				pid,
				port,
				drive,
				mmap,
				requested: { width, height },
				elapsed: Number(elapsed.toFixed(2)),
				frames,
				fps: Number((frames / elapsed).toFixed(1)),
				megabytesPerSecond: Number((bytes / elapsed / 1024 / 1024).toFixed(1)),
				emulatorCpu: {
					average: Number(
						(cpu.reduce((sum, value) => sum + value, 0) / cpu.length).toFixed(
							1,
						),
					),
					max: Math.max(...cpu),
					samples: cpu,
				},
				first,
				latest,
			},
			null,
			2,
		),
	);
}, seconds * 1000);
