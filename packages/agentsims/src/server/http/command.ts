import type { ApplicationCommandError } from "../../commands/errors";

export function commandErrorStatus(error: ApplicationCommandError): number {
	switch (error._tag) {
		case "InvalidCommandInput":
			return 400;
		case "CommandNotFound":
			return 404;
		case "CommandConflict":
			return 409;
		case "CommandUnavailable":
			return 503;
		case "CommandFailure":
			return 500;
	}
}
