import {
	useEffect,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { LiveAnnotationStore } from "../../annotation/live-controller";
import type {
	LiveAnnotationController,
	LiveAnnotationOptions,
	LiveAnnotationSummaryController,
} from "../../annotation/live-contracts";
import { annotationIdentityKey } from "../../annotation/native-preview";

export function useLiveAnnotation(
	options: LiveAnnotationOptions,
): LiveAnnotationController {
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const storeRef = useRef<LiveAnnotationStore | null>(null);
	storeRef.current ??= new LiveAnnotationStore(() => optionsRef.current);
	const store = storeRef.current;
	const identityKey = annotationIdentityKey(options.identity);
	const previewIdentityKey = options.nativePreview
		? annotationIdentityKey(options.nativePreview.identity)
		: "";
	useLayoutEffect(store.syncOptions, [
		store,
		options.active,
		options.identity.device,
		options.send,
		identityKey,
		previewIdentityKey,
		options.nativePreview?.snapshot,
		options.nativePreview?.status,
		options.nativePreview?.connected,
		options.geometry,
		options.cache,
	]);
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const summaryRef = useRef<LiveAnnotationSummaryController | null>(null);
	useLayoutEffect(() => {
		const previous = summaryRef.current;
		if (
			previous &&
			previous.device === snapshot.device &&
			previous.editorId === (snapshot.editor?.id ?? null) &&
			previous.status === snapshot.status &&
			previous.copying === snapshot.copying &&
			previous.sending === snapshot.sending &&
			previous.canSend === snapshot.canSend &&
			previous.comments.length === snapshot.comments.length &&
			previous.comments.every(
				(note, index) => note === snapshot.comments[index],
			)
		)
			return;
		if (previous && previous.device !== snapshot.device)
			optionsRef.current.onSummaryChange?.(previous.device, null);
		const summary: LiveAnnotationSummaryController = {
			device: snapshot.device,
			editorId: snapshot.editor?.id ?? null,
			comments: snapshot.comments,
			status: snapshot.status,
			copying: snapshot.copying,
			sending: snapshot.sending,
			canSend: snapshot.canSend,
			editNote: store.editNote,
			closeEditor: store.closeEditor,
			endSelection: store.endSelection,
			removeNote: store.removeNote,
			clearCopiedNotes: store.clearCopiedNotes,
			prepareSendPayload: store.prepareSendPayload,
		};
		summaryRef.current = summary;
		optionsRef.current.onSummaryChange?.(summary.device, summary);
	});
	useEffect(
		() => () => {
			if (summaryRef.current)
				optionsRef.current.onSummaryChange?.(summaryRef.current.device, null);
		},
		[store],
	);
	return {
		...snapshot,
		hover: store.hover,
		select: store.select,
		setNote: store.setNote,
		saveDraft: store.saveDraft,
		retainDraft: store.retainDraft,
		closeEditor: store.closeEditor,
		escape: store.escape,
		endSelection: store.endSelection,
		editNote: store.editNote,
		removeNote: store.removeNote,
		clearCopiedNotes: store.clearCopiedNotes,
		toggleList: store.toggleList,
		noteViewportRect: store.noteViewportRect,
		copyPrompt: store.copyPrompt,
		sendPrompt: store.sendPrompt,
		prepareSendPayload: store.prepareSendPayload,
	};
}
