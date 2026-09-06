import { expect, test } from "bun:test";
import {
	animateView,
	moveView,
} from "../../../../web/hooks/workspace/use-canvas-pan";

function canvas(
	view: { x: number; y: number },
	scroll: { left: number; top: number },
) {
	const content = { style: { transform: "" }, getAnimations: () => [] };
	const element = {
		dataset: { canvasPanX: String(view.x), canvasPanY: String(view.y) },
		scrollLeft: scroll.left,
		scrollTop: scroll.top,
		style: { backgroundPosition: "" },
		querySelector: () => content,
		getAnimations: () => [],
		scrollTo(position: { left: number; top: number }) {
			this.scrollLeft = position.left;
			this.scrollTop = position.top;
		},
	};
	return { element: element as unknown as HTMLDivElement, content };
}

test("hiding a tall phone preserves screen position after native scroll clamps", () => {
	const view = { x: 104.6687, y: 27.8125 };
	const previousScroll = { left: 0, top: 452 };
	const { element, content } = canvas(view, { left: 0, top: 4 });
	const worldY = 237.1025;
	const oldScreenY = worldY + view.y - previousScroll.top;
	moveView(element, 0, 0, previousScroll);
	expect(Number(element.dataset.canvasPanX)).toBe(view.x);
	expect(Number(element.dataset.canvasPanY)).toBeCloseTo(-424.1875);
	expect(
		worldY + Number(element.dataset.canvasPanY) - element.scrollTop,
	).toBeCloseTo(oldScreenY);
	expect(content.style.transform).toBe("translate(104.6687px, -424.1875px)");
	expect(element.scrollTop).toBe(0);
});

test("folding the same view with zero scroll does not shift it twice", () => {
	const { element } = canvas({ x: 30, y: 40 }, { left: 120, top: 200 });
	moveView(element, 0, 0, { left: 120, top: 200 });
	expect(element.dataset).toEqual({ canvasPanX: "-90", canvasPanY: "-160" });
	moveView(element, 0, 0);
	expect(element.dataset).toEqual({ canvasPanX: "-90", canvasPanY: "-160" });
});

test("normal pan still folds live native scroll and applies its drag delta", () => {
	const { element } = canvas({ x: 30, y: 40 }, { left: 120, top: 200 });
	moveView(element, 15, -20);
	expect(element.dataset).toEqual({ canvasPanX: "-75", canvasPanY: "-180" });
	expect(element.scrollLeft).toBe(0);
	expect(element.scrollTop).toBe(0);
});

test("interrupting recenter continues from the displayed position, not its destination", () => {
	const { element, content } = canvas({ x: 400, y: 300 }, { left: 0, top: 0 });
	let canceled = false;
	const previousStyle = Object.getOwnPropertyDescriptor(
		globalThis,
		"getComputedStyle",
	);
	const previousMatrix = Object.getOwnPropertyDescriptor(
		globalThis,
		"DOMMatrixReadOnly",
	);
	Object.defineProperty(globalThis, "getComputedStyle", {
		configurable: true,
		value: () => ({ transform: "matrix(1, 0, 0, 1, 100, 75)" }),
	});
	Object.defineProperty(globalThis, "DOMMatrixReadOnly", {
		configurable: true,
		value: class {
			m41 = 100;
			m42 = 75;
		},
	});
	Object.assign(content, {
		getAnimations: () => [
			{
				playState: "running",
				cancel: () => {
					canceled = true;
				},
			},
		],
	});
	try {
		moveView(element, 10, -5);
		expect(canceled).toBe(true);
		expect(element.dataset).toEqual({ canvasPanX: "110", canvasPanY: "70" });
		expect(content.style.transform).toBe("translate(110px, 70px)");
	} finally {
		if (previousStyle)
			Object.defineProperty(globalThis, "getComputedStyle", previousStyle);
		else Reflect.deleteProperty(globalThis, "getComputedStyle");
		if (previousMatrix)
			Object.defineProperty(globalThis, "DOMMatrixReadOnly", previousMatrix);
		else Reflect.deleteProperty(globalThis, "DOMMatrixReadOnly");
	}
});

test.each([false, true])(
	"recenter commits its final view and respects reduced motion: %s",
	(reduced) => {
		const { element, content } = canvas(
			{ x: 40, y: 50 },
			{ left: 10, top: 20 },
		);
		const animations: unknown[] = [];
		Object.assign(content, {
			animate: (frames: unknown) => animations.push(frames),
		});
		Object.assign(element, {
			animate: (frames: unknown) => animations.push(frames),
		});
		const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { matchMedia: () => ({ matches: reduced }) },
		});
		try {
			animateView(element, 70, -10);
			expect(element.dataset).toEqual({ canvasPanX: "100", canvasPanY: "20" });
			expect(content.style.transform).toBe("translate(100px, 20px)");
			expect(animations).toHaveLength(reduced ? 0 : 2);
			if (!reduced)
				expect(animations[0]).toEqual({
					transform: ["translate(30px, 30px)", "translate(100px, 20px)"],
				});
		} finally {
			if (previous) Object.defineProperty(globalThis, "window", previous);
			else Reflect.deleteProperty(globalThis, "window");
		}
	},
);
