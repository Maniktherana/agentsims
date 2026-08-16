import { Data } from "effect";

export class InvalidCommandInput extends Data.TaggedError("InvalidCommandInput")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CommandNotFound extends Data.TaggedError("CommandNotFound")<{
  readonly message: string;
}> {}

export class CommandConflict extends Data.TaggedError("CommandConflict")<{
  readonly message: string;
}> {}

export class CommandUnavailable extends Data.TaggedError("CommandUnavailable")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CommandFailure extends Data.TaggedError("CommandFailure")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ApplicationCommandError =
  | InvalidCommandInput
  | CommandNotFound
  | CommandConflict
  | CommandUnavailable
  | CommandFailure;

export function isApplicationCommandError(value: unknown): value is ApplicationCommandError {
  if (!value || typeof value !== "object" || !("_tag" in value) || !("message" in value)) {
    return false;
  }
  return value._tag === "InvalidCommandInput" ||
    value._tag === "CommandNotFound" ||
    value._tag === "CommandConflict" ||
    value._tag === "CommandUnavailable" ||
    value._tag === "CommandFailure";
}

export function commandFailure(cause: unknown): ApplicationCommandError {
  if (
    cause instanceof InvalidCommandInput ||
    cause instanceof CommandNotFound ||
    cause instanceof CommandConflict ||
    cause instanceof CommandUnavailable ||
    cause instanceof CommandFailure
  ) {
    return cause;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message === "Invalid or missing device") return new InvalidCommandInput({ message, cause });
  if (message === "Device is shutting down") return new CommandConflict({ message });
  return new CommandFailure({ message, cause });
}
