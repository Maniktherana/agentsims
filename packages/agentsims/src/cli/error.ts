export class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.name = "CliError";
		this.exitCode = exitCode;
	}
}

/** Commander actions report one error without turning a failed command into an unhandled rejection. */
export function cliAction<Args extends unknown[]>(
	action: (...args: Args) => unknown | Promise<unknown>,
) {
	return async (...args: Args): Promise<void> => {
		try {
			await action(...args);
		} catch (error) {
			console.error(
				`agentsims: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exitCode = 1;
		}
	};
}
