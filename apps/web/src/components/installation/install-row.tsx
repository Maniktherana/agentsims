import {
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
	type RefObject,
} from "react";
import { TextMorph } from "torph/react";
import { Chevron } from "@agentsims/ui/components/chevron";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@agentsims/ui/components/dropdown-menu";
import { AxMark } from "../ax-mark";
import { useCopy } from "../copy/use-copy";
import { CommandChip, InstallCommand } from "./command-block";
import { brewCommand, curlCommand, powershellCommand } from "./commands";
import { PromptChip } from "./copy-prompt-button";

/** The install command of each platform, as in docs/installation.md. */
const platforms = [
	{ platform: "macOS", method: "Homebrew", command: brewCommand },
	{ platform: "Linux", method: "curl", command: curlCommand },
	{ platform: "Windows", method: "PowerShell", command: powershellCommand },
];

/** The chevron cell is square: as wide as the 48px bar is tall. */
const TOGGLE_WIDTH = 48;

/**
 * One platform in the menu: the platform, the command, and a status that
 * says "Copied" for a short time after a click. Below 48rem the row shows
 * the install method in place of the command. The menu stays open.
 */
function PlatformItem({
	platform,
	method,
	command,
}: {
	platform: string;
	method: string;
	command: string;
}) {
	const { copied, copy } = useCopy();
	return (
		<DropdownMenuItem
			closeOnClick={false}
			onClick={() => copy(command)}
			aria-label={`Copy the ${platform} install command (${method})`}
			className="install-menu-item"
		>
			<span className="install-menu-platform">{platform}</span>
			<span className="install-menu-method">{method}</span>
			<code className="install-menu-command">{command}</code>
			<span className="install-menu-status" aria-hidden="true">
				<TextMorph>{copied ? "Copied" : "Copy"}</TextMorph>
			</span>
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied" : ""}
			</span>
		</DropdownMenuItem>
	);
}

/**
 * The menu of install commands. `label` is the text of the trigger before
 * its chevron. The menu opens under the trigger, moved left by
 * `alignOffset`.
 */
function InstallMenu({
	triggerClassName,
	label,
	alignOffset,
	sideOffset,
	style,
}: {
	triggerClassName: string;
	label?: ReactNode;
	alignOffset: number;
	sideOffset: number;
	style: CSSProperties;
}) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger
				aria-label={label ? undefined : "Install options"}
				className={triggerClassName}
			>
				{label}
				<Chevron open={open} />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				alignOffset={alignOffset}
				sideOffset={sideOffset}
				className="install-menu"
				style={style}
			>
				{platforms.map((item) => (
					<PlatformItem key={item.platform} {...item} />
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function useWidth(ref: RefObject<HTMLElement | null>) {
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => setWidth(element.offsetWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

// The head script sets data-install-platform before the first paint, so the
// commands for the platform show at once. The curl and PowerShell installers
// add the skill (docs/installation.md). After Homebrew, `agentsims skill`
// adds it.
const onMacOS = "hidden [:root[data-install-platform=macOS]_&]:flex";
const offMacOS = "flex [:root[data-install-platform=macOS]_&]:hidden";

/**
 * The install area of the hero. From 48rem it is the install bar with the
 * outline mark: the command, Copy, and a cell that opens every platform.
 * Below 48rem it is an Install button that opens the same menu. Then two
 * rows of chips share one label column: THEN has the commands to run after
 * the install, and OR has the install prompt for a coding agent.
 */
export function HeroInstall() {
	const areaRef = useRef<HTMLDivElement>(null);
	const barRef = useRef<HTMLSpanElement>(null);
	const areaWidth = useWidth(areaRef);
	const barWidth = useWidth(barRef);
	return (
		<div ref={areaRef} className="flex w-full flex-col gap-3">
			<AxMark reference="e14" square className="install-bar" ref={barRef}>
				<InstallCommand
					end={
						<InstallMenu
							triggerClassName="install-cell install-toggle"
							// The menu starts at the left edge of the bar, 8px under it.
							// The cell is inside the 1px border of the bar, so each
							// offset adds 1px.
							alignOffset={-(barWidth - TOGGLE_WIDTH - 1)}
							sideOffset={9}
							style={{ "--install-menu-min": `${barWidth}px` } as CSSProperties}
						/>
					}
				/>
			</AxMark>
			<AxMark reference="e14" square className="install-narrow">
				<InstallMenu
					triggerClassName="install-button"
					label="Install"
					alignOffset={0}
					sideOffset={8}
					style={{ "--install-menu-width": `${areaWidth}px` } as CSSProperties}
				/>
			</AxMark>
			<div className="install-next">
				<span className="t-label uppercase">Then</span>
				<span className={`${onMacOS} flex-wrap gap-2`}>
					<CommandChip command="agentsims skill" />
					<CommandChip command="agentsims start" />
				</span>
				<span className={`${offMacOS} flex-wrap gap-2`}>
					<CommandChip command="agentsims start" />
				</span>
				<span className="t-label uppercase">Or</span>
				<span className="flex flex-wrap gap-2">
					<PromptChip />
				</span>
			</div>
		</div>
	);
}
