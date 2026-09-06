import { useEffect, useState } from "react";
function readViewport() {
	return {
		width: typeof window === "undefined" ? 1280 : window.innerWidth,
		height: typeof window === "undefined" ? 800 : window.innerHeight,
	};
}
export function useWorkspaceViewport() {
	const [viewport, setViewport] = useState(readViewport);
	useEffect(() => {
		const update = () => setViewport(readViewport());
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, []);
	return viewport;
}
