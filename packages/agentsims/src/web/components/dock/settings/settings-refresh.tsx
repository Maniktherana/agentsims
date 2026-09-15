import { createContext, useContext, useEffect, useRef } from "react";

export const SettingsRefreshContext = createContext(0);

/** Refetch this device's mounted section without resetting its local UI state. */
export function useSettingsRefresh(refresh: () => void | Promise<unknown>) {
	const revision = useContext(SettingsRefreshContext);
	const previous = useRef(revision);
	const callback = useRef(refresh);
	callback.current = refresh;
	useEffect(() => {
		if (previous.current === revision) return;
		previous.current = revision;
		void callback.current();
	}, [revision]);
}
