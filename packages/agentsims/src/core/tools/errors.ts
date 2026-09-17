import { Data } from "effect";

/**
 * How far an input action got. `none` means the tool refused it before any
 * frame reached the device. `unknown` means the tool sent it and lost the
 * answer, so the caller must read the device before it acts again.
 */
export type ActionEffect = "none" | "unknown";

type CommandErrorFields = {
	readonly message: string;
	readonly cause?: unknown;
	readonly effect?: ActionEffect;
};

export type DeviceGoneDetails = {
	readonly device: string;
	readonly currentDeviceIds: readonly string[];
	readonly recovery: string;
};

export class InvalidCommandInput extends Data.TaggedError(
	"InvalidCommandInput",
)<CommandErrorFields> {}

export class CommandNotFound extends Data.TaggedError(
	"CommandNotFound",
)<CommandErrorFields> {}

export class CommandConflict extends Data.TaggedError(
	"CommandConflict",
)<CommandErrorFields> {}

export class CommandUnavailable extends Data.TaggedError(
	"CommandUnavailable",
)<CommandErrorFields> {}

export class CommandFailure extends Data.TaggedError(
	"CommandFailure",
)<CommandErrorFields> {}

export class DeviceGone extends Data.TaggedError("DeviceGone")<
	CommandErrorFields & {
		readonly code: "device_gone";
		readonly details: DeviceGoneDetails;
	}
> {}

export type ApplicationCommandError =
	| InvalidCommandInput
	| CommandNotFound
	| CommandConflict
	| CommandUnavailable
	| CommandFailure
	| DeviceGone;

export function isApplicationCommandError(
	value: unknown,
): value is ApplicationCommandError {
	if (
		!value ||
		typeof value !== "object" ||
		!("_tag" in value) ||
		!("message" in value)
	) {
		return false;
	}
	return (
		value._tag === "InvalidCommandInput" ||
		value._tag === "CommandNotFound" ||
		value._tag === "CommandConflict" ||
		value._tag === "CommandUnavailable" ||
		value._tag === "CommandFailure" ||
		value._tag === "DeviceGone"
	);
}

function errorMessages(cause: unknown): string[] {
	const messages: string[] = [];
	const seen = new Set<unknown>();
	let current: unknown = cause;
	while (current !== undefined && current !== null && !seen.has(current)) {
		seen.add(current);
		if (current instanceof Error) messages.push(current.message);
		else if (typeof current === "string") messages.push(current);
		if (typeof current !== "object" || !("cause" in current)) break;
		current = current.cause;
	}
	return messages;
}

export function isConfirmedDeviceGone(cause: unknown, device: string): boolean {
	if (cause instanceof DeviceGone) return true;
	const platformId = device.startsWith("android:")
		? device.slice("android:".length)
		: device.startsWith("ios:")
			? device.slice("ios:".length)
			: device;
	const android = `device '${platformId}' not found`;
	const ios = new Set([`Device ${device} not found`, `Device ${platformId} not found`]);
	return errorMessages(cause).some((message) =>
		message.split("\n").some((line) => {
			const value = line.trim();
			return value === android || value.endsWith(`: ${android}`) || ios.has(value);
		}),
	);
}

export function commandFailure(cause: unknown): ApplicationCommandError {
	if (
		cause instanceof InvalidCommandInput ||
		cause instanceof CommandNotFound ||
		cause instanceof CommandConflict ||
		cause instanceof CommandUnavailable ||
		cause instanceof CommandFailure ||
		cause instanceof DeviceGone
	) {
		return cause;
	}
	const message = cause instanceof Error ? cause.message : String(cause);
	if (message === "Invalid or missing device")
		return new InvalidCommandInput({ message, cause });
	if (message === "Device is shutting down")
		return new CommandConflict({ message });
	return new CommandFailure({ message, cause });
}

export function withActionEffect(
	cause: unknown,
	effect: ActionEffect,
): ApplicationCommandError {
	const error = commandFailure(cause);
	const fields = { message: error.message, cause: error.cause, effect };
	switch (error._tag) {
		case "InvalidCommandInput":
			return new InvalidCommandInput(fields);
		case "CommandNotFound":
			return new CommandNotFound(fields);
		case "CommandConflict":
			return new CommandConflict(fields);
		case "CommandUnavailable":
			return new CommandUnavailable(fields);
		case "CommandFailure":
			return new CommandFailure(fields);
		case "DeviceGone":
			return new DeviceGone({
				...fields,
				code: error.code,
				details: error.details,
			});
	}
}
