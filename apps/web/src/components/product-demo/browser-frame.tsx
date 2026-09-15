import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";

export function BrowserFrame({ children }: { children: ReactNode }) {
	return (
		<div className="macbook-display select-none">
			<div
				className="relative z-[1] hidden min-h-10 items-center gap-4 bg-[#1c1c1e] px-3 py-2 max-xl:flex"
				aria-hidden="true"
			>
				<div className="flex gap-[0.3rem] [&>i]:size-1.5 [&>i]:rounded-full [&>i]:bg-[#55555a]">
					<i />
					<i />
					<i />
				</div>
				<div className="flex flex-1 items-center justify-center gap-[0.3rem] rounded-[0.3rem] bg-[#2c2c2f] p-[0.3rem] text-[0.5625rem] text-[#b4b4bd] [&>svg]:size-2">
					<LockKeyhole />
					agentsims
				</div>
				<span className="text-base text-muted-foreground">＋</span>
			</div>
			<div
				className="workspace-demo max-xl:relative max-xl:inset-auto max-xl:h-auto max-xl:w-full max-xl:rounded-none max-xl:px-6 max-xl:pt-11 max-xl:pb-10 max-sm:px-4"
				aria-hidden="true"
				inert
			>
				<div className="absolute top-[12%] left-[46%] z-[2] rounded-[6px] border border-white/5 bg-[#151517] px-[0.6rem] py-[0.4rem] font-mono text-[10px] font-semibold text-muted-foreground max-xl:hidden">
					agentsims
				</div>
				{children}
			</div>
			<img className="macbook-frame" src="/MacBook-Pro-14.svg" alt="" />
		</div>
	);
}
