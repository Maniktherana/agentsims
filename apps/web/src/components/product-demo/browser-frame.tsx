import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";

export function BrowserFrame({ children }: { children: ReactNode }) {
	return (
		<div className="macbook-display">
			<div className="safari-toolbar" aria-hidden="true">
				<div className="safari-lights">
					<i />
					<i />
					<i />
				</div>
				<div className="safari-address">
					<LockKeyhole />
					agentsims
				</div>
				<span className="safari-tabs">＋</span>
			</div>
			<div className="workspace-demo" aria-hidden="true" inert>
				<div className="workspace-wordmark">agentsims</div>
				{children}
			</div>
			<img className="macbook-frame" src="/MacBook-Pro-14.svg" alt="" />
		</div>
	);
}
