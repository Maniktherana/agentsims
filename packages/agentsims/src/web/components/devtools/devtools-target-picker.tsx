import type { DevToolsTarget } from "../../devtools/client";
import { Select } from "../ui/select";

export function DevToolsTargetPicker({
	targets,
	selected,
	onSelectTarget,
}: {
	targets: DevToolsTarget[];
	selected: DevToolsTarget | null;
	onSelectTarget: (id: string) => void;
}) {
	return (
		<Select
			label="Browser page"
			value={selected?.id ?? ""}
			options={targets.map((target) => ({
				value: target.id,
				label: target.title || target.url || "Untitled page",
			}))}
			onChange={onSelectTarget}
			matchTriggerWidth
			className="w-full"
		/>
	);
}
