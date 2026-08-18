import { useCallback, useRef } from "react";
import { toast } from "sonner";
import type { DropKind } from "../../media/drop";

export type UploadToast = {
	id: string;
	name: string;
	kind: DropKind;
	status: "uploading" | "success" | "error";
	progress: number | null;
	message?: string;
};

export function useUploadToasts() {
	const uploads = useRef(new Map<string, Pick<UploadToast, "name" | "kind">>());

	const add = useCallback((name: string, kind: DropKind): string => {
		const id = crypto.randomUUID();
		uploads.current.set(id, { name, kind });
		toast.loading(`Uploading ${name}…`, { id });
		return id;
	}, []);

	const update = useCallback((id: string, patch: Partial<UploadToast>) => {
		const upload = uploads.current.get(id);
		if (!upload) return;
		if (patch.status === "success") {
			toast.success(
				upload.kind === "ipa"
					? `Installed ${upload.name}`
					: `Added ${upload.name} to Photos`,
				{ id, duration: 3000 },
			);
			uploads.current.delete(id);
			return;
		}
		if (patch.status === "error") {
			toast.error(`${upload.name}: ${patch.message ?? "Upload failed"}`, {
				id,
				duration: 3000,
			});
			uploads.current.delete(id);
			return;
		}
		toast.loading(
			upload.kind === "ipa"
				? `Installing ${upload.name}…`
				: `Adding ${upload.name}…`,
			{ id },
		);
	}, []);

	const setProgress = useCallback((id: string, progress: number | null) => {
		const upload = uploads.current.get(id);
		if (!upload) return;
		const message =
			progress === null
				? upload.kind === "ipa"
					? `Installing ${upload.name}…`
					: `Adding ${upload.name}…`
				: `Uploading ${upload.name}… ${Math.round(progress * 100)}%`;
		toast.loading(message, { id });
	}, []);

	return { add, update, setProgress };
}
