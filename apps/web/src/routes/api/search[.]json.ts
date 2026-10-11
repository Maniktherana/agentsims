import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "../../docs/source";

const search = createFromSource(source, { language: "english" });

// The site is static, so the build prerenders this index and the browser
// searches it locally.
export const Route = createFileRoute("/api/search.json")({
	server: { handlers: { GET: () => search.staticGET() } },
});
