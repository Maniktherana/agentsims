import { Button } from "@agentsims/ui/components/button";

/** Shown over the last frame while another tab holds the device. */
export function ViewerPausedOverlay({ onClaim }: { onClaim: () => void }) {
	return (
		<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 p-4 text-center">
			<p className="text-[13px] text-muted-foreground">
				This device is active in another tab.
			</p>
			<Button size="sm" onClick={onClaim}>
				Use it here
			</Button>
		</div>
	);
}
