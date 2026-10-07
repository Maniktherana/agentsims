# Android retained-history capture

This fixture comes from the managed runtime's live `/logs/snapshot` response.
The browser rejected the 47-record response on 2026-10-05.
The fixture keeps the first and last records from two older occurrence epochs.
The response cursor uses a third epoch. All epochs belong to the same device.
Record sequences remain below or equal to the response sequence.

Native message, app, process, and tag text is redacted. Epoch UUIDs are deterministic
replacements. Original cursor relationships, sequences, numeric fields, source,
source time, and wire structure remain intact. No runtime credential is included.

`LogStore.markSourceGap` changes the response epoch and preserves retained
occurrences. The browser must validate each occurrence's device epoch separately.
It must not rewrite occurrence IDs or cursors to match the response epoch.
