import { BunContext } from "@effect/platform-bun";
import { Layer, ManagedRuntime } from "effect";
import { HostTools, HostToolsLive } from "./host-tools";

const runtime = ManagedRuntime.make(
	HostToolsLive.pipe(Layer.provide(BunContext.layer)),
);

export async function hostCommandText(
	command: string,
	...args: string[]
): Promise<string> {
	const tools = await runtime.runPromise(HostTools);
	return runtime.runPromise(tools.text(command, args));
}

export async function hostSleep(milliseconds: number): Promise<void> {
	const tools = await runtime.runPromise(HostTools);
	await runtime.runPromise(tools.sleep(milliseconds));
}
