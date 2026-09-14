import { expect, test } from "bun:test";
import { androidAvccResponse } from "../../../../../server/http/routes/helpers";

test("Android stream responses do not wait for capture startup", async () => {
	let finishStartup: ((unsubscribe: () => void) => void) | undefined;
	const startup = new Promise<() => void>((resolve) => {
		finishStartup = resolve;
	});

	const response = androidAvccResponse("emulator-5554", () => startup);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe("application/octet-stream");

	finishStartup?.(() => {});
	await response.body?.cancel();
});
