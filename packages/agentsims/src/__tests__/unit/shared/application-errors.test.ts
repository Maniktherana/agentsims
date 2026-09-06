import { describe, expect, test } from "bun:test";
import {
	CommandConflict,
	CommandFailure,
	InvalidCommandInput,
} from "../../../shared/application-errors";
import { commandErrorStatus } from "../../../server/http/command";

describe("application command contracts", () => {
	test("maps tagged errors to one HTTP status policy", () => {
		expect(
			commandErrorStatus(new InvalidCommandInput({ message: "bad" })),
		).toBe(400);
		expect(commandErrorStatus(new CommandConflict({ message: "busy" }))).toBe(
			409,
		);
		expect(commandErrorStatus(new CommandFailure({ message: "failed" }))).toBe(
			500,
		);
	});
});
