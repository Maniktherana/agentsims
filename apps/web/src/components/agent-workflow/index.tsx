import type { ReactNode } from "react";
import {
	Accessibility as AccessibilityIcon,
	ChevronRight,
	Eye,
	MousePointer2,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import "./styles.css";

/*
 * Parts of the product inspector for the pictures of the Overview: the
 * element outlines on a Pixel screen, and the accessibility panel.
 */

type Box = { top: number; left: number; width: number; height: number };

/*
 * Every element on each screen, in percent of the screen, as in the original
 * Observe stage. The selected element matches the selected row of the
 * panel: Gmail on the home screen, Bluetooth in quick settings.
 */
const homeIcon = { top: 65.22, width: 20, height: 10.44 };
const homeDock = { top: 79.64, width: 15.9, height: 7.92 };
const homeSearch = { top: 89.06, height: 5.95 };
const screenBoxes: Record<"home" | "quick", { boxes: Box[]; selected: Box }> = {
	home: {
		boxes: [
			{ top: 7.05, left: 4.63, width: 90.74, height: 10.44 },
			{ top: 11.22, left: 6.39, width: 22.22, height: 2.1 },
			{ ...homeIcon, left: 4.63 },
			{ ...homeIcon, left: 28.24 },
			{ ...homeIcon, left: 51.85 },
			{ ...homeIcon, left: 75.46 },
			{ ...homeDock, left: 6.48 },
			{ ...homeDock, left: 30.44 },
			{ ...homeDock, left: 54.05 },
			{ ...homeDock, left: 77.66 },
			{ ...homeSearch, left: 7.2, width: 11.62 },
			{ ...homeSearch, left: 18.82, width: 50.9 },
			{ ...homeSearch, left: 69.72, width: 11.34 },
			{ ...homeSearch, left: 81.06, width: 11.87 },
		],
		selected: { ...homeIcon, left: 28.24 },
	},
	quick: {
		boxes: [
			{ top: 5.86, left: 3.89, width: 45.19, height: 7.8 },
			{ top: 5.86, left: 50.93, width: 45.19, height: 7.8 },
			{ top: 14.52, left: 3.89, width: 45.19, height: 7.8 },
			{ top: 14.52, left: 50.93, width: 45.19, height: 7.8 },
			{ top: 55.24, left: 3.89, width: 92.22, height: 14.48 },
		],
		selected: { top: 5.86, left: 50.93, width: 45.19, height: 7.8 },
	},
};

const boxStyle = (box: Box) => ({
	top: `${box.top}%`,
	left: `${box.left}%`,
	width: `${box.width}%`,
	height: `${box.height}%`,
});

/**
 * The element boxes of one screen: every element in the product's
 * "show all outlines" style, and the selected element on top in the
 * selected style.
 */
export function ScreenBoxes({ screen, visible }: { screen: "home" | "quick"; visible: boolean }) {
	const { boxes, selected } = screenBoxes[screen];
	return (
		<div className="wf-ax-boxes" data-visible={visible}>
			{boxes.map((box) => (
				<span
					key={`${box.top}-${box.left}`}
					className="wf-ax-box-outline"
					style={boxStyle(box)}
				/>
			))}
			<span className="wf-ax-box" style={boxStyle(selected)} />
		</div>
	);
}

export type TreeRow = {
	depth: number;
	expanded?: boolean;
	type: string;
	tone?: "structure";
	props?: string;
	selected?: boolean;
};

/**
 * The accessibility panel of the product: the header, the search field, and
 * the tree. `children` are the tree states.
 */
export function AccessibilityPanel({
	count,
	children,
}: {
	count: number;
	children: ReactNode;
}) {
	return (
		<div className="wf-ax-panel">
			<div className="wf-ax-header">
				<span className="wf-ax-icon">
					<AccessibilityIcon className="wf-icon-14" strokeWidth={1.9} />
				</span>
				<span className="wf-ax-identity">
					<span className="wf-ax-live" />
					<span className="wf-ax-name">Pixel 10</span>
				</span>
				<span className="wf-ax-actions">
					<span className="wf-ax-button">
						<MousePointer2 className="wf-icon-14" strokeWidth={2} />
					</span>
					{/* Every outline is shown, so the outline toggle is on. */}
					<span className="wf-ax-button" data-pressed="">
						<Eye className="wf-icon-14" strokeWidth={2} />
					</span>
					<span className="wf-ax-count">{count}</span>
					<span className="wf-ax-button">
						<RefreshCw className="wf-icon-14" strokeWidth={2} />
					</span>
				</span>
				<span className="wf-ax-button">
					<X className="wf-icon-14" strokeWidth={2} />
				</span>
			</div>
			<div className="wf-ax-search">
				<Search className="wf-icon-13" strokeWidth={1.8} />
				<span className="wf-ax-placeholder">Search tree</span>
			</div>
			<div className="wf-ax-tree">{children}</div>
		</div>
	);
}

export function TreeState({ rows, visible }: { rows: TreeRow[]; visible: boolean }) {
	return (
		<div className="wf-ax-state" data-visible={visible}>
			<span className="wf-ax-guide" />
			{rows.map((row) => (
				<div
					key={`${row.type}${row.props ?? ""}`}
					className="wf-ax-row"
					data-selected={row.selected === true}
				>
					{row.depth > 0 ? <span className="wf-ax-indent" /> : null}
					<span className="wf-ax-toggle">
						{row.expanded ? (
							<ChevronRight className="wf-icon-14" strokeWidth={1.8} />
						) : null}
					</span>
					<span className="wf-ax-content">
						<span className="wf-ax-type" data-tone={row.tone}>
							{row.type}
						</span>
						{row.props ? <span className="wf-ax-props">{row.props}</span> : null}
					</span>
				</div>
			))}
		</div>
	);
}
