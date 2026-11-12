import type { CSSProperties } from "react";
import { DeviceCanvas } from "./canvas";
import { Dock, NotesChip, targetProps } from "./dock";
import { Drawer } from "./drawer";
import { canvasLayout, type TourDesign } from "./layout";
import { ProductIcon } from "./product-icon";
import { canvasDevices, isDrawer, type TourState } from "./state";
import { T } from "./targets";

/**
 * The browser window around the product: the one-row browser bar of the
 * phones picture, with the address of a local workspace.
 */
export function TourWindow({ design, state }: { design: TourDesign; state: TourState }) {
	return (
		<div className="wt-window" style={{ height: design.height }}>
			<div className="wt-chrome" style={{ height: design.chromeH }}>
				<div className="wt-dots">
					<i />
					<i />
					<i />
				</div>
				<div className="wt-address">localhost:3200</div>
				<span className="wt-new-tab">＋</span>
			</div>
			<div className="wt-viewport" style={{ height: design.viewH }}>
				<Workspace design={design} state={state} />
			</div>
		</div>
	);
}

function Workspace({ design, state }: { design: TourDesign; state: TourState }) {
	const drawerOpen = isDrawer(state.panel);
	const devices = canvasDevices(state);
	const layout = canvasLayout(design, state, drawerOpen);
	return (
		<div
			className="wt-workspace"
			data-drawer={drawerOpen || undefined}
			style={{ "--wt-drawer-h": `${state.drawerH ?? design.drawerH}px` } as CSSProperties}
		>
			{/* The dot grid moves with a pan of the canvas. */}
			<div
				className="wt-grid"
				data-panning={state.canvas.panning || undefined}
				style={{ transform: `translateX(${state.canvas.pan}px)` }}
			/>
			<DeviceCanvas design={design} state={state} layout={layout} devices={devices} />
			{/* With the iPhone at the left edge, the brand, Arrange and Recenter would sit on its name bar and toolbar. */}
			{design.pair ? <span className="wt-brand">agentsims</span> : null}
			<div className="wt-lift">
				{design.pair ? (
					<div className="wt-canvas-view">
						<span className="wt-canvas-btn" {...targetProps(state, T.arrange)}>
							<ProductIcon name="arrange" size={17} />
						</span>
						<span className="wt-canvas-btn">
							<ProductIcon name="recenter" size={17} />
						</span>
					</div>
				) : null}
				<NotesChip state={state} />
				<Dock design={design} state={state} />
			</div>
			<Drawer design={design} state={state} />
			<Toast on={state.toast} />
		</div>
	);
}

/** The success toast of Copy prompt (components/ui/toast.tsx), top center as the product's Toaster puts it. */
function Toast({ on }: { on: boolean }) {
	return (
		<div className="wt-toast" data-on={on || undefined}>
			<svg className="shrink-0 text-emerald-400" width={18} height={18} viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="m17.999 10c0-1.097-.567-2.113-1.465-2.707.215-1.054-.103-2.174-.878-2.95-.775-.776-1.896-1.094-2.95-.878C12.113 2.568 11.097 2.001 10 2.001s-2.113.567-2.706 1.464c-1.053-.216-2.174.102-2.95.878s-1.093 1.896-.878 2.949C2.569 7.885 2.001 8.902 2.001 9.999s.567 2.113 1.465 2.707c-.215 1.054.103 2.174.878 2.95s1.898 1.092 2.95.878c.593.897 1.609 1.464 2.706 1.464s2.113-.568 2.706-1.465c1.059.214 2.176-.103 2.95-.878.776-.776 1.094-1.896.878-2.95.897-.593 1.465-1.609 1.465-2.707Zm-4.218-1.875-4 5a1 1 0 0 1-.726.374H9a.997.997 0 0 1-.707-.293l-2-2a1 1 0 0 1 1.414-1.414l1.21 1.21 3.302-4.127a1 1 0 0 1 1.562 1.249Z"
					fill="currentColor"
				/>
			</svg>
			<div className="min-w-0 flex-1 leading-tight">
				<div className="truncate text-[13px] font-semibold text-white">Prompt copied</div>
			</div>
		</div>
	);
}
