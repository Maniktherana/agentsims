import { mock } from "bun:test";

let cleanup: Promise<void> | undefined;
mock.module("../../server/http/server", () => ({
	servePreview: async () => ({
		port: 12345,
		stop: () => {
			cleanup ??= (async () => {
				process.stdout.write("cleanup-started\n");
				await Bun.sleep(200);
				process.stdout.write("cleanup-complete\n");
			})();
			return cleanup;
		},
	}),
}));

// Load the CLI after installing the isolated transport fixture.
const { runLocalServer } = require("../../cli/local-server");
await runLocalServer({
	host: "127.0.0.1",
	port: 12345,
	basePath: "/",
	codec: "auto",
	json: true,
});
