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
			className="h-7 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[12px] text-white/88 outline-none [transition-property:background-color,border-color] duration-100 hover:bg-white/[0.07] focus-visible:border-white/25 focus-visible:ring-2 focus-visible:ring-white/20"
		/>
	);
}
