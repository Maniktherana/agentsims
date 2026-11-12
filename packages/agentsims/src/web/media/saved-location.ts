/** The longest directory that the saved-file toast shows before it shortens the middle. */
export const SAVED_LOCATION_MAX_CHARS = 40;

function parentDirectory(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const index = trimmed.lastIndexOf("/");
	if (index < 0) return ".";
	return index === 0 ? "/" : trimmed.slice(0, index);
}

/** Show the home directory as `~`. The browser does not know `$HOME`, so use the macOS and Linux layout. */
function withHomeShortcut(directory: string): string {
	return directory.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

function shortenMiddle(text: string, max: number): string {
	if (text.length <= max) return text;
	const keep = max - 1;
	const head = Math.ceil(keep / 2);
	return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/** `/Users/x/Downloads/recording-….mp4` becomes `Saved to ~/Downloads`. The file name is never shown. */
export function savedLocationLabel(
	path: string,
	max = SAVED_LOCATION_MAX_CHARS,
): string {
	return `Saved to ${shortenMiddle(withHomeShortcut(parentDirectory(path)), max)}`;
}
