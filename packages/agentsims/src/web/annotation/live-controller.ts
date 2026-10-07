import type {
	AnnotationPoint,
	AnnotationSelection,
	AnnotationSpatialSnapshot,
} from "./contracts";
import type { AxSnapshot } from "../../core/tools/observe/accessibility-model";
import type {
	AnnotationContextClient,
	LiveAnnotationNote,
	LiveAnnotationOptions,
	LiveAnnotationSnapshot,
} from "./live-contracts";
import { ANNOTATION_NOTE_CHARACTER_LIMIT } from "./live-contracts";
import { annotationContextClient, copyAnnotationPayload } from "./client";
import {
	annotationNoteViewportRect,
	captureAnnotationEvidence,
	exportAnnotationNotes,
	freezeAnnotationValue,
} from "./evidence";
import { selectAnnotationAtPoint } from "./selection";
import {
	annotationIdentityKey,
	nativeAnnotationPreviewAvailable,
	prepareNativeAnnotationPreview,
	selectNativeAnnotationPreview,
} from "./native-preview";

const defaultWorkspace = `annotation-${crypto.randomUUID()}`;
const contextSyncMessage =
	"Context sync failed. Use Copy prompt. Your notes are retained.";
const noteLimitMessage =
	"Shorten this note to 4,096 characters before saving. Your text is retained.";
interface DeviceNotes {
	entries: readonly LiveAnnotationNote[];
	editorId: string | null;
	listOpen: boolean;
	status: string;
	copying: boolean;
	sending: boolean;
	hover: AnnotationSelection | null;
	hoverPoint: AnnotationPoint | null;
	selectingEnded: boolean;
}
interface ContextReceipt {
	client: AnnotationContextClient;
	workspace: string;
	created: Promise<string | null>;
	tail: Promise<unknown>;
	remoteId: string | null;
	syncedNote: string | null;
	saved: boolean;
	failed: boolean;
	pending: number;
}

/** State changes never change stream state or request a later screenshot. */
export class LiveAnnotationStore {
	private devices = new Map<string, DeviceNotes>();
	private receipts = new Map<string, ContextReceipt>();
	private removals = new Map<string, LiveAnnotationNote>();
	private listeners = new Set<() => void>();
	private snapshot: LiveAnnotationSnapshot;
	private lastActive: boolean;
	private lastDevice: string;
	private lastCanSend: boolean;
	private lastIdentity: string;
	private lastPreviewSnapshot: AxSnapshot | null;
	private lastTargetState: string;
	private blockedPreviewSnapshot: AxSnapshot | null = null;
	private spatialSnapshot: AxSnapshot | null = null;
	private spatialPreview: AnnotationSpatialSnapshot | null = null;

	constructor(private readonly options: () => LiveAnnotationOptions) {
		this.lastActive = options().active;
		this.lastDevice = options().identity.device;
		this.lastCanSend = !!options().send;
		this.lastIdentity = annotationIdentityKey(options().identity);
		this.lastPreviewSnapshot = options().nativePreview?.snapshot ?? null;
		this.lastTargetState = this.targetState();
		this.snapshot = this.view();
	}

	private device(device = this.options().identity.device): DeviceNotes {
		let value = this.devices.get(device);
		if (!value) {
			value = {
				entries: [],
				editorId: null,
				listOpen: false,
				status: "",
				copying: false,
				sending: false,
				hover: null,
				hoverPoint: null,
				selectingEnded: false,
			};
			this.devices.set(device, value);
		}
		return value;
	}

	private targetState(): string {
		const options = this.options();
		return JSON.stringify([
			annotationIdentityKey(options.identity),
			options.nativePreview?.identity,
			options.nativePreview?.status,
			options.nativePreview?.connected,
			options.geometry,
		]);
	}

	private nativeTarget(point: AnnotationPoint): AnnotationSelection | null {
		const { nativePreview, identity, geometry } = this.options();
		if (
			!geometry ||
			!nativeAnnotationPreviewAvailable(nativePreview, identity) ||
			nativePreview!.snapshot === this.blockedPreviewSnapshot
		)
			return null;
		if (this.spatialSnapshot !== nativePreview!.snapshot) {
			this.spatialSnapshot = nativePreview!.snapshot;
			this.spatialPreview = prepareNativeAnnotationPreview(nativePreview!);
		}
		return selectNativeAnnotationPreview(
			nativePreview,
			identity,
			geometry,
			point,
			this.spatialPreview,
		);
	}

	private view(): LiveAnnotationSnapshot {
		const options = this.options();
		const state = this.device();
		const editor =
			state.entries.find((entry) => entry.id === state.editorId) ?? null;
		const selecting =
			options.active && !state.selectingEnded && !editor && !state.listOpen;
		return {
			device: options.identity.device,
			active: options.active,
			inputDisabled: options.active && !state.selectingEnded,
			selecting,
			selectingEnded: state.selectingEnded,
			hoverTarget: selecting ? state.hover : null,
			notes: state.entries.filter((entry) => entry.state === "saved"),
			comments: state.entries.filter((entry) => entry.note.trim()),
			draft: state.entries.find((entry) => entry.state === "draft") ?? null,
			editor,
			listOpen: state.listOpen,
			status: state.status,
			copying: state.copying,
			sending: state.sending,
			canSend: !!options.send,
		};
	}

	private hoverSelection(
		point: AnnotationPoint | null,
	): AnnotationSelection | null {
		const options = this.options();
		if (!point || !options.geometry) return null;
		const selected = selectAnnotationAtPoint({
			...options,
			geometry: options.geometry,
			point,
			now: options.now?.() ?? Date.now(),
		});
		return selected?.kind === "element" ? selected : this.nativeTarget(point);
	}

	private publish() {
		this.snapshot = this.view();
		for (const listener of this.listeners) listener();
	}

	private pruneEmptyDevices() {
		for (const [id, state] of this.devices) {
			if (
				id !== this.options().identity.device &&
				!state.entries.length &&
				!state.copying &&
				!state.sending
			)
				this.devices.delete(id);
		}
	}

	syncOptions = () => {
		const options = this.options();
		const changedDevice = this.lastDevice !== options.identity.device;
		const identityKey = annotationIdentityKey(options.identity);
		const changedIdentity = identityKey !== this.lastIdentity;
		const nextPreview = options.nativePreview?.snapshot ?? null;
		const targetState = this.targetState();
		const targetChanged =
			targetState !== this.lastTargetState ||
			nextPreview !== this.lastPreviewSnapshot;
		if (
			identityKey !== this.lastIdentity &&
			nextPreview === this.lastPreviewSnapshot
		)
			this.blockedPreviewSnapshot = nextPreview;
		else if (nextPreview !== this.lastPreviewSnapshot)
			this.blockedPreviewSnapshot = null;
		this.lastIdentity = identityKey;
		this.lastPreviewSnapshot = nextPreview;
		this.lastTargetState = targetState;
		if (targetChanged) {
			const current = this.device();
			if (changedIdentity) current.hoverPoint = null;
			current.hover = this.hoverSelection(current.hoverPoint);
		}
		if (changedDevice || (this.lastActive && !options.active)) {
			const previous = this.device(this.lastDevice);
			previous.editorId = null;
			previous.listOpen = false;
			previous.hover = null;
			previous.hoverPoint = null;
		}
		if (
			changedDevice ||
			targetChanged ||
			options.active !== this.lastActive ||
			!!options.send !== this.lastCanSend
		) {
			if (options.active && (changedDevice || !this.lastActive)) {
				const current = this.device();
				current.selectingEnded = false;
			}
			this.lastDevice = options.identity.device;
			this.lastActive = options.active;
			this.lastCanSend = !!options.send;
			this.publish();
			this.pruneEmptyDevices();
		}
	};

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	getSnapshot = () => this.snapshot;

	hover = (point: AnnotationPoint | null) => {
		if (!this.view().selecting) return;
		this.device().hoverPoint = point;
		const next = this.hoverSelection(point);
		const previous = this.device().hover;
		if (!previous && !next) return;
		if (
			previous &&
			next &&
			previous.kind === next.kind &&
			JSON.stringify(previous.identity) === JSON.stringify(next.identity) &&
			JSON.stringify(previous.viewportRect) ===
				JSON.stringify(next.viewportRect) &&
			((previous.kind === "element" &&
				next.kind === "element" &&
				previous.key === next.key &&
				previous.metadata.revision === next.metadata.revision) ||
				(previous.kind === "region" &&
					next.kind === "region" &&
					previous.reason === next.reason &&
					JSON.stringify(previous.rect) === JSON.stringify(next.rect)))
		)
			return;
		this.device().hover = next;
		this.publish();
	};

	select = (point: AnnotationPoint) => {
		if (!this.view().selecting) return;
		const options = this.options();
		if (!options.geometry) return;
		const state = this.device();
		if (
			[...this.devices.values()].reduce(
				(total, device) => total + device.entries.length,
				0,
			) +
				this.removals.size >=
			32
		) {
			state.status = "Remove a note before adding another.";
			this.publish();
			return;
		}
		const now = options.now?.() ?? Date.now();
		// Select again at click. A previous hover never supplies a stale target.
		const selected = selectAnnotationAtPoint({
			...options,
			geometry: options.geometry,
			point,
			now,
		});
		const selection =
			selected?.kind === "element"
				? selected
				: (this.nativeTarget(point) ?? selected);
		if (!selection) return;
		try {
			// This callback and evidence conversion run before the first promise.
			const capture = options.capturePresentedSurface();
			if (!capture)
				throw new Error("Wait for the live screen, then select a target.");
			const evidence = captureAnnotationEvidence(
				selection,
				options.geometry,
				capture,
				now,
			);
			const retainedBytes =
				[...this.devices.values()].reduce(
					(sum, device) =>
						sum +
						device.entries.reduce(
							(bytes, entry) =>
								bytes + entry.evidence.image.base64.length * 0.75,
							0,
						),
					0,
				) +
				[...this.removals.values()].reduce(
					(bytes, entry) => bytes + entry.evidence.image.base64.length * 0.75,
					0,
				);
			if (retainedBytes + capture.blob.size > 64 * 1024 * 1024)
				throw new Error("Remove a note before adding another image.");
			const note = freezeAnnotationValue({
				id: crypto.randomUUID(),
				deviceName: options.deviceName?.trim() || undefined,
				state: "draft" as const,
				note: "",
				selection,
				imageSize: { ...options.geometry.image },
				evidence,
			});
			state.entries = [...state.entries, note];
			state.editorId = note.id;
			state.hover = null;
			state.hoverPoint = null;
			state.status = "";
			this.publish();
			this.createContext(note, options);
		} catch (error) {
			state.status =
				error instanceof Error
					? error.message
					: "The screen could not be captured.";
			this.publish();
		}
	};

	private createContext(
		note: LiveAnnotationNote,
		options: LiveAnnotationOptions,
	) {
		const client =
			options.contextClient ?? annotationContextClient(options.basePath);
		const workspace = options.workspace ?? defaultWorkspace;
		const receipt: ContextReceipt = {
			client,
			workspace,
			created: Promise.resolve(null),
			tail: Promise.resolve(),
			remoteId: null,
			syncedNote: null,
			saved: false,
			failed: false,
			pending: 0,
		};
		const created = Promise.resolve()
			.then(() => client.create(workspace, note.evidence, note.id))
			.then((item) => {
				if (
					typeof item.id !== "string" ||
					!item.id.trim() ||
					item.id.length > 256
				)
					throw new Error("Missing context receipt.");
				receipt.remoteId = item.id;
				receipt.syncedNote = note.evidence.note;
				return item.id;
			})
			.catch(() => {
				receipt.failed = true;
				const state = this.device(note.evidence.device);
				if (state.entries.some((entry) => entry.id === note.id)) {
					state.status = contextSyncMessage;
					this.publish();
				}
				return null;
			});
		receipt.created = created;
		receipt.tail = created;
		this.receipts.set(note.id, receipt);
	}

	private persist(note: LiveAnnotationNote, save: boolean) {
		if (note.note.length > ANNOTATION_NOTE_CHARACTER_LIMIT) {
			this.device(note.evidence.device).status = noteLimitMessage;
			return;
		}
		const receipt = this.receipts.get(note.id);
		if (!receipt) return;
		receipt.pending++;
		receipt.saved = false;
		receipt.tail = receipt.tail
			.then(async () => {
				const id = await receipt.created;
				if (!id) throw new Error("Missing context receipt.");
				await receipt.client.update(receipt.workspace, id, note.note);
				receipt.syncedNote = note.note;
				if (save) await receipt.client.save(receipt.workspace, id);
				receipt.saved = save;
				receipt.failed = false;
			})
			.catch(() => {
				receipt.failed = true;
				receipt.saved = false;
				this.device(note.evidence.device).status = contextSyncMessage;
				this.publish();
			})
			.finally(() => {
				receipt.pending--;
			});
	}

	setNote = (value: string) => {
		const state = this.device();
		// Match A03's UTF-16 string-length limit, including surrogate pairs.
		const characters = value.length;
		if (characters > 16_384) {
			state.status =
				"This text exceeds the editor limit. Paste a shorter note. Your previous text is retained.";
			this.publish();
			return;
		}
		const note = value;
		if (characters > ANNOTATION_NOTE_CHARACTER_LIMIT)
			state.status = noteLimitMessage;
		else if (state.status === noteLimitMessage) state.status = "";
		state.entries = state.entries.map((entry) =>
			entry.id === state.editorId
				? freezeAnnotationValue({ ...entry, note })
				: entry,
		);
		this.publish();
	};

	saveDraft = () => {
		const state = this.device();
		const current = state.entries.find((entry) => entry.id === state.editorId);
		if (!current?.note.trim()) return;
		if (current.note.length > ANNOTATION_NOTE_CHARACTER_LIMIT) {
			state.status = noteLimitMessage;
			this.publish();
			return;
		}
		const saved = freezeAnnotationValue({
			...current,
			state: "saved" as const,
			note: current.note.trim(),
		});
		state.entries = state.entries.map((entry) =>
			entry.id === saved.id ? saved : entry,
		);
		state.editorId = null;
		state.status = "";
		this.persist(saved, true);
		this.publish();
	};

	retainDraft = () => {
		const state = this.device();
		const note = state.entries.find((entry) => entry.id === state.editorId);
		if (note) this.persist(note, note.state === "saved");
		state.editorId = null;
		state.hover = null;
		state.selectingEnded = true;
		this.options().onEndSelection();
		this.publish();
	};

	closeEditor = () => {
		const state = this.device();
		const note = state.entries.find((entry) => entry.id === state.editorId);
		state.editorId = null;
		state.hover = null;
		if (note?.note.trim()) this.persist(note, note.state === "saved");
		else if (note?.state === "draft") this.removeNote(note.id);
		this.publish();
	};

	escape = () => {
		if (this.device().editorId) this.closeEditor();
		else this.endSelection();
	};

	endSelection = () => {
		this.retainDraft();
		this.device().listOpen = false;
		this.publish();
	};

	editNote = (id: string) => {
		const state = this.device();
		if (!state.entries.some((entry) => entry.id === id)) return;
		state.editorId = id;
		state.listOpen = false;
		state.hover = null;
		this.publish();
	};

	removeNote = (id: string) => this.removeEntry(id, true);

	clearCopiedNotes = (notes: readonly LiveAnnotationNote[]) => {
		const entries = this.device().entries;
		for (const copied of notes) {
			const current = entries.find((entry) => entry.id === copied.id);
			if (
				current &&
				current.note === copied.note &&
				current.evidence === copied.evidence
			)
				this.removeEntry(copied.id, false);
		}
	};

	private removeEntry(id: string, restoreOnFailure: boolean) {
		const state = this.device();
		const note = state.entries.find((entry) => entry.id === id);
		if (!note) return;
		state.entries = state.entries.filter((entry) => entry.id !== id);
		if (state.editorId === id) state.editorId = null;
		this.publish();
		const receipt = this.receipts.get(id);
		this.receipts.delete(id);
		if (receipt) {
			this.removals.set(id, note);
			void receipt.tail
				.then(async () => {
					const remoteId = await receipt.created;
					if (remoteId)
						await receipt.client.remove(receipt.workspace, remoteId);
				})
				.catch(() => {
					this.removals.delete(id);
					if (!restoreOnFailure) return;
					const device = this.device(note.evidence.device);
					device.entries = [...device.entries, note];
					device.status = "The note could not be removed. Try again.";
					this.receipts.set(id, receipt);
					this.publish();
				})
				.finally(() => {
					this.removals.delete(id);
					this.pruneEmptyDevices();
				});
		} else this.pruneEmptyDevices();
	}

	toggleList = () => {
		const state = this.device();
		state.listOpen = !state.listOpen;
		state.hover = null;
		this.publish();
	};

	noteViewportRect = (note: LiveAnnotationNote) => {
		const options = this.options();
		return options.geometry
			? annotationNoteViewportRect(
					note,
					options.cache,
					options.identity,
					options.geometry,
					options.now?.() ?? Date.now(),
				)
			: null;
	};

	copyPrompt = async () => {
		const options = this.options();
		const state = this.device();
		if (state.copying) return;
		const notes = state.entries.filter((entry) => entry.note.trim());
		if (!notes.length) return;
		state.copying = true;
		state.status = "";
		this.publish();
		try {
			await (options.copy ?? copyAnnotationPayload)(
				exportAnnotationNotes(notes),
			);
			state.status = "Prompt and images copied.";
		} catch {
			state.status =
				"Copy failed. Check clipboard access, then select Copy prompt again. Your notes are retained.";
		} finally {
			state.copying = false;
			this.publish();
			this.pruneEmptyDevices();
		}
	};

	prepareSendPayload = async () => {
		const state = this.device();
		const notes = state.entries.filter((entry) => entry.note.trim());
		if (!notes.length || state.sending) return null;
		state.sending = true;
		state.status = "";
		this.publish();
		try {
			for (const note of notes) {
				const receipt = this.receipts.get(note.id);
				if (
					receipt &&
					!receipt.failed &&
					(!receipt.pending || note.state === "draft") &&
					(!receipt.saved || receipt.syncedNote !== note.note)
				)
					this.persist(note, true);
			}
			const receipts = notes.map((note) => this.receipts.get(note.id));
			await Promise.all(receipts.map((receipt) => receipt?.tail));
			if (
				receipts.some(
					(receipt, index) =>
						!receipt ||
						receipt.failed ||
						receipt.pending ||
						!receipt.saved ||
						!receipt.remoteId ||
						receipt.syncedNote !== notes[index]!.note ||
						this.receipts.get(notes[index]!.id) !== receipt ||
						!state.entries.some(
							(entry) =>
								entry.id === notes[index]!.id &&
								entry.note === notes[index]!.note,
						),
				)
			) {
				state.status =
					"Context sync is incomplete. Use Copy prompt. Your notes are retained.";
				return null;
			}
			const workspace = receipts[0]!.workspace;
			const ids = receipts.map((receipt) => receipt!.remoteId!);
			if (
				receipts.some((receipt) => receipt!.workspace !== workspace) ||
				new Set(ids).size !== ids.length
			) {
				state.status =
					"These notes cannot be sent together. Use Copy prompt. Your notes are retained.";
				return null;
			}
			const local = exportAnnotationNotes(notes);
			return freezeAnnotationValue({
				...local,
				retainedContext: { workspace, ids, prompt: local.prompt },
			});
		} catch {
			state.status = contextSyncMessage;
			return null;
		} finally {
			state.sending = false;
			this.publish();
			this.pruneEmptyDevices();
		}
	};

	sendPrompt = async () => {
		const options = this.options();
		const state = this.device();
		if (state.sending) return;
		if (!options.send) {
			state.status = "Send is unavailable. You can copy the prompt.";
			this.publish();
			return;
		}
		const payload = await this.prepareSendPayload();
		if (!payload) return;
		state.sending = true;
		this.publish();
		try {
			const result = await options.send(payload);
			state.status =
				result.status === "sent"
					? "Sent. Your notes are retained."
					: result.status === "unknown"
						? "Send status is unknown. Check the conversation before sending again."
						: result.message ||
							"Send failed. Use Copy prompt. Your notes are retained.";
		} catch {
			state.status =
				"Send status is unknown. Check the conversation before sending again.";
		} finally {
			state.sending = false;
			this.publish();
			this.pruneEmptyDevices();
		}
	};
}
