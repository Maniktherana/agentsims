import { AgentControlDemo } from "../agent-control";
import { SkillSteps } from "../agent-workflow/skill-steps";
import { ProductDemo } from "../product-demo";
import { ProductStage } from "../product-stage";
import { WorkspaceTour } from "../workspace-tour";

/* The product pictures of the site. Each page imports its pictures from here. */

export function HeroPicture() {
	return (
		<ProductStage
			interactive
			align="start"
			label="Claude Code puts iPhone 17 in dark mode, then changes the Home Screen icons. The phone changes with each command."
		>
			<AgentControlDemo />
		</ProductStage>
	);
}

/** The workspace: an iPhone and a Pixel, and the dock that boots the Pixel. */
export function WorkspacePicture() {
	return (
		<ProductStage
			grid
			label="The workspace with iPhone 17. The pointer opens Devices in the dock and boots a Pixel 10 beside the iPhone, then shuts it down."
		>
			<ProductDemo />
		</ProductStage>
	);
}

/** The whole workspace in a browser: a pointer boots a Pixel 10, inspects, writes a note, and opens a trace. */
export function WorkspaceTourPicture() {
	return <WorkspaceTour />;
}

/** The loop of the skill: Observe, Act, and Verify, with one pane. */
export function WorkflowPicture() {
	return <SkillSteps />;
}
