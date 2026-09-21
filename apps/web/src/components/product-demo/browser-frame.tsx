import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { motion } from "motion/react";
import { INTRO_FADE } from "../intro/use-intro";

export function BrowserFrame({
	lit,
	chrome,
	children,
}: {
	lit: boolean;
	chrome: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className="macbook-display select-none"
			data-screen={lit ? "lit" : "dark"}
		>
			<div
				className="relative z-[1] hidden min-h-10 items-center gap-4 bg-[#1c1c1e] px-3 py-2 max-md:flex"
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
				className="workspace-demo max-md:relative max-md:inset-auto max-md:h-auto max-md:w-full max-md:rounded-none max-md:px-4 max-md:pt-11 max-md:pb-10"
				data-chrome={chrome ? "shown" : "hidden"}
				aria-hidden="true"
				inert
			>
				<motion.div
					className="absolute top-[12%] left-[46%] z-[2] rounded-[6px] border border-white/5 bg-[#151517] px-[0.6rem] py-[0.4rem] font-mono text-[10px] font-semibold text-muted-foreground max-md:hidden"
					initial={{ opacity: 0 }}
					animate={{ opacity: chrome ? 1 : 0 }}
					transition={INTRO_FADE}
				>
					agentsims
				</motion.div>
				{children}
			</div>
			<img className="macbook-frame" src="/MacBook-Pro-14.svg" alt="" />
		</div>
	);
}
