declare module "virtual:changelog" {
	import type { ChangelogRelease } from "./types";
	/** The releases in `CHANGELOG.md`, newest first. */
	const releases: ChangelogRelease[];
	export default releases;
}
