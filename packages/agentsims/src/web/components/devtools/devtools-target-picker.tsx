import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@agentsims/ui/components/select";
import type { DevToolsTarget } from "../../devtools/client";

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
			value={selected?.id ?? ""}
			onValueChange={(next) => {
				if (next !== null) onSelectTarget(next);
			}}
		>
			<SelectTrigger aria-label="Browser page" className="w-full">
				<SelectValue>
					{selected?.title || selected?.url || "Untitled page"}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{targets.map((target) => (
					<SelectItem key={target.id} value={target.id}>
						{target.title || target.url || "Untitled page"}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
