import { useEffect, useState } from "react";

/**
 * Returns the id of the heading that the reader is at. The side nav marks it
 * in the outline of the current page.
 *
 * The reading line travels with the scroll position: at the top of the page
 * it is at the top of the window, and at the bottom of the page it is at the
 * bottom of the window. The active heading is the last one whose top is at or
 * above the line, or the first heading when none is. So the first item is
 * active at the top, the last item is active at the bottom, and the items
 * become active in order.
 *
 * After a click on an outline link, that heading stays active until the
 * reader scrolls again, because the jump can land a short section above the
 * line.
 */
export function useActiveHeading(ids: readonly string[]) {
	const [active, setActive] = useState<string | null>(null);
	const key = ids.join(" ");

	useEffect(() => {
		const list = key ? key.split(" ") : [];
		if (list.length === 0) {
			setActive(null);
			return;
		}
		let frame = 0;
		let chosen: string | null = null;

		const update = () => {
			frame = 0;
			if (chosen) {
				setActive(chosen);
				return;
			}
			const root = document.documentElement;
			const range = root.scrollHeight - window.innerHeight;
			const progress =
				range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
			const line = progress * window.innerHeight;
			let current = list[0] ?? null;
			for (const id of list) {
				const element = document.getElementById(id);
				if (element && element.getBoundingClientRect().top <= line)
					current = id;
			}
			setActive(current);
		};
		const schedule = () => {
			if (!frame) frame = window.requestAnimationFrame(update);
		};

		// A click on an outline link selects its heading. Reader input ends it.
		const onClick = (event: MouseEvent) => {
			const link = (event.target as Element | null)?.closest?.("a[href^='#']");
			const id = link?.getAttribute("href")?.slice(1);
			if (id && list.includes(id)) {
				chosen = id;
				schedule();
			}
		};
		const release = () => {
			if (!chosen) return;
			chosen = null;
			schedule();
		};

		// Heading positions change when fonts, images, and demos load.
		const resize = new ResizeObserver(schedule);
		resize.observe(document.body);
		void document.fonts?.ready.then(schedule);

		update();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		window.addEventListener("load", schedule);
		document.addEventListener("click", onClick);
		window.addEventListener("wheel", release, { passive: true });
		window.addEventListener("touchstart", release, { passive: true });
		window.addEventListener("keydown", release);
		return () => {
			window.cancelAnimationFrame(frame);
			resize.disconnect();
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			window.removeEventListener("load", schedule);
			document.removeEventListener("click", onClick);
			window.removeEventListener("wheel", release);
			window.removeEventListener("touchstart", release);
			window.removeEventListener("keydown", release);
		};
	}, [key]);

	return active;
}
