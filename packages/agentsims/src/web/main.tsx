import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "@fontsource/geist-mono/latin-600.css";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./app";
import "./global.css";

const rootHost = window as Window & { __AGENTSIMS_REACT_ROOT__?: Root };
const reactRoot = (rootHost.__AGENTSIMS_REACT_ROOT__ ??= createRoot(
	document.getElementById("root")!,
));
reactRoot.render(<App />);
