import type { ReactNode } from "react";

function Code({ children }: { children: ReactNode }) {
	return (
		<code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.8125rem] whitespace-nowrap text-foreground">
			{children}
		</code>
	);
}

function DocsLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a
			href={href}
			className="text-foreground underline decoration-border underline-offset-4 transition-[text-decoration-color] duration-150 ease-out hover:decoration-foreground"
		>
			{children}
		</a>
	);
}

const features: { title: string; description: ReactNode }[] = [
	{
		title: "Command traces",
		description: (
			<>
				Every operation is recorded with its captured evidence. Open the trace
				panel, or run <Code>agentsims trace start</Code>. See{" "}
				<DocsLink href="/docs/cli#record-a-trace">traces</DocsLink>.
			</>
		),
	},
	{
		title: "App and device logs",
		description: (
			<>
				iOS, Android, and React Native logs in one panel, with search, filters,
				and pause. In a terminal: <Code>agentsims app-logs --follow</Code>.
			</>
		),
	},
	{
		title: "Simulator settings",
		description: (
			<>
				Set appearance and location on iOS. Set network, battery, locale,
				density, and emulator snapshots on Android. See{" "}
				<DocsLink href="/docs/workspace#change-device-settings">
					settings
				</DocsLink>
				.
			</>
		),
	},
	{
		title: "Camera injection",
		description: (
			<>
				Send a host webcam to the device camera to test scan and capture flows.
				See{" "}
				<DocsLink href="/docs/cli#test-the-camera-and-app-permissions">
					camera input
				</DocsLink>
				.
			</>
		),
	},
	{
		title: "App permissions",
		description: (
			<>
				Grant, revoke, and reset runtime permissions on both platforms:{" "}
				<Code>agentsims permissions grant camera</Code>.
			</>
		),
	},
	{
		title: "Screen recording",
		description: (
			<>
				Record any device to video. A rotation starts a new segment:{" "}
				<Code>agentsims record start --out run.mp4</Code>.
			</>
		),
	},
	{
		title: "Annotations",
		description: (
			<>
				Select a target on a phone and write a note beside it. Copy the notes as
				one prompt for your agent. See{" "}
				<DocsLink href="/docs/workspace#send-notes-to-an-agent">
					annotations
				</DocsLink>
				.
			</>
		),
	},
	{
		title: "React Native source",
		description: (
			<>
				With the optional Metro integration, accessibility elements show
				component names and source locations. See the{" "}
				<DocsLink href="/docs/react-native">setup guide</DocsLink>.
			</>
		),
	},
];

export function MoreFeatures() {
	return (
		<section
			className="mx-auto max-w-[82rem] px-[clamp(1.25rem,4vw,4rem)] pb-[clamp(6rem,8vw,8rem)]"
			aria-labelledby="more-features-title"
		>
			<h2
				id="more-features-title"
				className="m-0 text-xs font-medium tracking-[0.16em] text-subtle-foreground uppercase"
			>
				More
			</h2>
			<dl className="mt-8 grid grid-cols-2 gap-x-[clamp(2rem,5vw,5rem)] gap-y-12 max-md:grid-cols-1 max-md:gap-y-9">
				{features.map((feature) => (
					<div key={feature.title}>
						<dt className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
							{feature.title}
						</dt>
						<dd className="m-0 mt-2.5 max-w-[34rem] text-base leading-7 text-pretty text-muted-foreground">
							{feature.description}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}
