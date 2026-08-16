import { expect, test } from "bun:test";
import { iosSessions } from "../../ios/session/session";
import { startTestServer } from "../helpers/server";

const DEVICE = "server-scope-test-device";

test("server shutdown closes the session registry scope", async () => {
	const original = iosSessions.get(DEVICE);
	const { server } = await startTestServer({ previewAssets: {} });

	await server.stop();

	const replacement = iosSessions.get(DEVICE);
	expect(replacement).not.toBe(original);
	await iosSessions.close(DEVICE);
});
