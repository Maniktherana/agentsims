import { describe, expect, test } from "bun:test";
import {
  createDeviceReviewStore,
  reduceReviewForDevice,
  selectDeviceReview,
} from "../annotations/web/state/device-review-store";
import {
  reviewReducer,
} from "../annotations/web/state/review-reducer";
import {
  selectCapturesSimulatorPointer,
  selectNeedsAxSnapshot,
  selectReviewDraftId,
  selectReviewPointerCapture,
  selectReviewTool,
  selectSelectedAxKeys,
  selectShowsAllAccessibilityNodes,
} from "../annotations/web/state/review-selectors";
import {
  createAnnotateReviewState,
  createClosedReviewState,
  type ReviewState,
} from "../annotations/web/state/review-state";

function reduce(
  state: ReviewState,
  ...events: Parameters<typeof reviewReducer>[1][]
): ReviewState {
  return events.reduce(reviewReducer, state);
}

describe("reviewReducer accessibility", () => {
  test("opens accessibility review with independent picking and all-node overlay", () => {
    const state = reviewReducer(createClosedReviewState(), {
      type: "REVIEW_ACCESSIBILITY_OPENED",
      picking: false,
      showAllNodes: true,
    });

    expect(state).toEqual({
      kind: "accessibility",
      picking: false,
      showAllNodes: true,
      highlightedKey: null,
      highlightedOrigin: null,
      selectedKey: null,
      phoneSelectionRevealToken: 0,
      recoverableDraftId: null,
    });
    expect(selectReviewPointerCapture(state)).toBe("none");
    expect(selectShowsAllAccessibilityNodes(state)).toBe(true);
    expect(selectNeedsAxSnapshot(state)).toBe(true);
  });

  test("opens accessibility passively with meaningful outlines by default", () => {
    const state = reviewReducer(createClosedReviewState(), {
      type: "REVIEW_ACCESSIBILITY_OPENED",
    });
    expect(state.kind).toBe("accessibility");
    expect(selectCapturesSimulatorPointer(state)).toBe(false);
    expect(selectShowsAllAccessibilityNodes(state)).toBe(true);
  });

  test("phone pick replaces a broad selection and exits picking", () => {
    const state = reduce(
      createClosedReviewState(),
      { type: "REVIEW_ACCESSIBILITY_OPENED", picking: true },
      {
        type: "ACCESSIBILITY_TARGET_SELECTED",
        key: "root@0",
        origin: "phone",
      },
      {
        type: "ACCESSIBILITY_TARGET_SELECTED",
        key: "nested-button@0.1.2",
        origin: "phone",
      },
      { type: "ACCESSIBILITY_PICKING_CHANGED", picking: false },
    );

    expect(state).toMatchObject({
      kind: "accessibility",
      picking: false,
      selectedKey: "nested-button@0.1.2",
      highlightedKey: null,
      phoneSelectionRevealToken: 2,
    });
    expect(selectCapturesSimulatorPointer(state)).toBe(false);
  });

  test("Escape disables picking before it closes accessibility review", () => {
    const open = reviewReducer(createClosedReviewState("draft-a"), {
      type: "REVIEW_ACCESSIBILITY_OPENED",
      picking: true,
    });
    expect(selectReviewPointerCapture(open)).toBe("accessibility");

    const pickingOff = reviewReducer(open, { type: "ESCAPE_REQUESTED" });
    expect(pickingOff.kind).toBe("accessibility");
    expect(selectCapturesSimulatorPointer(pickingOff)).toBe(false);
    expect(selectReviewDraftId(pickingOff)).toBe("draft-a");

    const closed = reviewReducer(pickingOff, { type: "ESCAPE_REQUESTED" });
    expect(closed).toEqual({
      kind: "closed",
      recoverableDraftId: "draft-a",
    });
  });

  test("tree selection is separate from picking", () => {
    const state = reduce(
      createClosedReviewState(),
      { type: "REVIEW_ACCESSIBILITY_OPENED", picking: false },
      {
        type: "ACCESSIBILITY_TARGET_SELECTED",
        key: "button@/0/2",
        origin: "tree",
      },
    );
    expect(selectSelectedAxKeys(state)).toEqual(["button@/0/2"]);
    expect(selectCapturesSimulatorPointer(state)).toBe(false);
  });

  test("emits one phone reveal token per phone commit, including the same key", () => {
    const open = reduce(
      createClosedReviewState(),
      { type: "REVIEW_ACCESSIBILITY_OPENED" },
      {
        type: "ACCESSIBILITY_TARGET_SELECTED",
        key: "button@0.2",
        origin: "tree",
      },
    );
    expect(open.kind === "accessibility"
      ? open.phoneSelectionRevealToken
      : -1).toBe(0);

    const firstPhoneCommit = reviewReducer(open, {
      type: "ACCESSIBILITY_TARGET_SELECTED",
      key: "button@0.2",
      origin: "phone",
    });
    const repeatedPhoneCommit = reviewReducer(firstPhoneCommit, {
      type: "ACCESSIBILITY_TARGET_SELECTED",
      key: "button@0.2",
      origin: "phone",
    });
    expect(firstPhoneCommit.kind === "accessibility"
      ? firstPhoneCommit.phoneSelectionRevealToken
      : -1).toBe(1);
    expect(repeatedPhoneCommit.kind === "accessibility"
      ? repeatedPhoneCommit.phoneSelectionRevealToken
      : -1).toBe(2);
  });

  test("ignores crossed delayed hover leaves from the superseded origin", () => {
    const open = reviewReducer(createClosedReviewState(), {
      type: "REVIEW_ACCESSIBILITY_OPENED",
    });
    const phoneThenTree = reduce(
      open,
      { type: "AX_TARGET_HOVERED", key: "phone@0.1", origin: "phone" },
      { type: "AX_TARGET_HOVERED", key: "tree@0.2", origin: "tree" },
      { type: "AX_TARGET_HOVERED", key: null, origin: "phone" },
    );
    expect(phoneThenTree).toMatchObject({
      highlightedKey: "tree@0.2",
      highlightedOrigin: "tree",
    });

    const treeThenPhone = reduce(
      open,
      { type: "AX_TARGET_HOVERED", key: "tree@0.2", origin: "tree" },
      { type: "AX_TARGET_HOVERED", key: "phone@0.1", origin: "phone" },
      { type: "AX_TARGET_HOVERED", key: null, origin: "tree" },
    );
    expect(treeThenPhone).toMatchObject({
      highlightedKey: "phone@0.1",
      highlightedOrigin: "phone",
    });
  });
});

describe("reviewReducer annotation phases", () => {
  test("element targeting composes, preserves its draft on Escape, then closes", () => {
    const targeting = reviewReducer(createClosedReviewState(), {
      type: "REVIEW_ANNOTATE_OPENED",
      tool: "element",
    });
    expect(selectReviewPointerCapture(targeting)).toBe("annotation-element");

    const composing = reviewReducer(targeting, {
      type: "ANNOTATION_ELEMENT_SELECTED",
      key: "cta@/0/4",
      draftId: "draft-element",
    });
    expect(composing.kind).toBe("annotate");
    expect(composing.kind === "annotate" ? composing.phase : null).toBe("composing");
    expect(selectSelectedAxKeys(composing)).toEqual(["cta@/0/4"]);
    expect(selectReviewPointerCapture(composing)).toBe("none");

    const dismissed = reviewReducer(composing, { type: "ESCAPE_REQUESTED" });
    expect(dismissed.kind === "annotate" ? dismissed.phase : null).toBe("targeting");
    expect(selectReviewDraftId(dismissed)).toBe("draft-element");

    const closed = reviewReducer(dismissed, { type: "ESCAPE_REQUESTED" });
    expect(closed).toEqual({
      kind: "closed",
      recoverableDraftId: "draft-element",
    });
  });

  test("a recoverable draft can resume by ID and be explicitly discarded", () => {
    const state = reduce(
      createAnnotateReviewState({
        tool: "element",
        recoverableDraftId: "draft-resume",
      }),
      {
        type: "ANNOTATION_DRAFT_RESUMED",
        draftId: "draft-resume",
        tool: "element",
        selectedKeys: ["field@/0/1"],
      },
    );
    expect(state.kind === "annotate" ? state.phase : null).toBe("composing");
    expect(selectReviewDraftId(state)).toBe("draft-resume");
    expect(selectSelectedAxKeys(state)).toEqual(["field@/0/1"]);

    const discarded = reviewReducer(state, {
      type: "ANNOTATION_DRAFT_DISCARDED",
      draftId: "draft-resume",
    });
    expect(selectReviewDraftId(discarded)).toBeNull();
    expect(discarded.kind === "annotate" ? discarded.phase : null).toBe("targeting");
  });

  test("area dragging accepts only its pointer and Escape cancels only the drag", () => {
    const area = reviewReducer(createClosedReviewState(), {
      type: "REVIEW_ANNOTATE_OPENED",
      tool: "area",
    });
    const dragging = reviewReducer(area, {
      type: "ANNOTATION_AREA_DRAG_STARTED",
      pointerId: 7,
      point: { x: 10, y: 20 },
    });
    expect(dragging.kind === "annotate" ? dragging.phase : null).toBe("area-dragging");

    const ignoredMove = reviewReducer(dragging, {
      type: "ANNOTATION_AREA_DRAG_MOVED",
      pointerId: 8,
      point: { x: 80, y: 90 },
    });
    expect(ignoredMove).toBe(dragging);

    const moved = reviewReducer(dragging, {
      type: "ANNOTATION_AREA_DRAG_MOVED",
      pointerId: 7,
      point: { x: 80, y: 90 },
    });
    expect(moved.kind === "annotate" && moved.phase === "area-dragging"
      ? moved.current
      : null).toEqual({ x: 80, y: 90 });

    const cancelled = reviewReducer(moved, { type: "ESCAPE_REQUESTED" });
    expect(cancelled.kind === "annotate" ? cancelled.phase : null).toBe("targeting");
    expect(selectReviewTool(cancelled)).toBe("area");
    expect(selectReviewPointerCapture(cancelled)).toBe("annotation-area");
  });

  test("completing an area drag enters composing with no AX selection", () => {
    const composing = reduce(
      createAnnotateReviewState({ tool: "area" }),
      {
        type: "ANNOTATION_AREA_DRAG_STARTED",
        pointerId: 4,
        point: { x: 4, y: 6 },
      },
      {
        type: "ANNOTATION_AREA_DRAG_COMPLETED",
        pointerId: 4,
        draftId: "draft-area",
      },
    );
    expect(composing.kind === "annotate" ? composing.phase : null).toBe("composing");
    expect(selectReviewDraftId(composing)).toBe("draft-area");
    expect(selectSelectedAxKeys(composing)).toEqual([]);
  });

  test("multi-select Escape clears the set before exiting review", () => {
    const selected = reduce(
      createAnnotateReviewState({ tool: "multi" }),
      { type: "ANNOTATION_MULTI_TARGET_TOGGLED", key: "one@/1" },
      { type: "ANNOTATION_MULTI_TARGET_TOGGLED", key: "two@/2" },
    );
    expect(selectSelectedAxKeys(selected)).toEqual(["one@/1", "two@/2"]);

    const cleared = reviewReducer(selected, { type: "ESCAPE_REQUESTED" });
    expect(cleared.kind).toBe("annotate");
    expect(selectSelectedAxKeys(cleared)).toEqual([]);

    const closed = reviewReducer(cleared, { type: "ESCAPE_REQUESTED" });
    expect(closed.kind).toBe("closed");
  });

  test("multi compose requires a non-empty selection", () => {
    const empty = createAnnotateReviewState({ tool: "multi" });
    const ignored = reviewReducer(empty, {
      type: "ANNOTATION_MULTI_COMPOSE_REQUESTED",
      draftId: "draft-multi",
    });
    expect(ignored).toBe(empty);

    const composing = reduce(
      empty,
      { type: "ANNOTATION_MULTI_TARGET_TOGGLED", key: "one@/1" },
      {
        type: "ANNOTATION_MULTI_COMPOSE_REQUESTED",
        draftId: "draft-multi",
      },
    );
    expect(composing.kind === "annotate" ? composing.phase : null).toBe("composing");
    expect(selectSelectedAxKeys(composing)).toEqual(["one@/1"]);
  });

  test("screen targeting never captures simulator input", () => {
    const screen = createAnnotateReviewState({ tool: "screen" });
    expect(selectReviewPointerCapture(screen)).toBe("none");
    expect(selectNeedsAxSnapshot(screen)).toBe(false);

    const composing = reviewReducer(screen, {
      type: "ANNOTATION_SCREEN_COMPOSE_REQUESTED",
      draftId: "draft-screen",
    });
    expect(composing.kind === "annotate" ? composing.phase : null).toBe("composing");
  });

  test("accepts a generic composer transition from an existing target adapter", () => {
    const composing = reviewReducer(
      createAnnotateReviewState({ tool: "area" }),
      {
        type: "ANNOTATION_COMPOSER_OPENED",
        draftId: "draft-adapter",
        tool: "area",
      },
    );
    expect(composing.kind === "annotate" ? composing.phase : null).toBe("composing");
    expect(selectReviewDraftId(composing)).toBe("draft-adapter");
  });

  test("annotation detail Escape returns to targeting before closing", () => {
    const detail = reduce(
      createAnnotateReviewState({ tool: "multi", selectedKeys: ["one@/1"] }),
      { type: "ANNOTATION_DETAIL_OPENED", annotationId: "annotation-1" },
    );
    expect(detail.kind === "annotate" ? detail.phase : null).toBe("annotation-detail");

    const targeting = reviewReducer(detail, { type: "ESCAPE_REQUESTED" });
    expect(targeting.kind === "annotate" ? targeting.phase : null).toBe("targeting");
    expect(selectSelectedAxKeys(targeting)).toEqual(["one@/1"]);
  });

  test("submitting is explicit and Escape restores input while preserving the draft ID", () => {
    const submitting = reduce(
      createAnnotateReviewState({ tool: "element" }),
      {
        type: "ANNOTATION_ELEMENT_SELECTED",
        key: "button@/1",
        draftId: "draft-submit",
      },
      {
        type: "ANNOTATION_SUBMISSION_STARTED",
        draftId: "draft-submit",
      },
    );
    expect(submitting.kind === "annotate" ? submitting.phase : null).toBe("submitting");
    expect(selectCapturesSimulatorPointer(submitting)).toBe(false);

    const closed = reviewReducer(submitting, { type: "ESCAPE_REQUESTED" });
    expect(closed).toEqual({
      kind: "closed",
      recoverableDraftId: "draft-submit",
    });

    const saved = reviewReducer(closed, {
      type: "ANNOTATION_SUBMISSION_SUCCEEDED",
      draftId: "draft-submit",
    });
    expect(saved).toEqual(createClosedReviewState());
  });

  test("submission failure returns to the same composer selection", () => {
    const submitting = reduce(
      createAnnotateReviewState({ tool: "multi", selectedKeys: ["one@/1"] }),
      {
        type: "ANNOTATION_MULTI_COMPOSE_REQUESTED",
        draftId: "draft-failed",
      },
      {
        type: "ANNOTATION_SUBMISSION_STARTED",
        draftId: "draft-failed",
      },
    );
    const failed = reviewReducer(submitting, {
      type: "ANNOTATION_SUBMISSION_FAILED",
      draftId: "draft-failed",
    });
    expect(failed.kind === "annotate" ? failed.phase : null).toBe("composing");
    expect(selectSelectedAxKeys(failed)).toEqual(["one@/1"]);
  });

  test("events that are invalid for the active tool are ignored", () => {
    const element = createAnnotateReviewState({ tool: "element" });
    expect(reviewReducer(element, {
      type: "ANNOTATION_AREA_DRAG_STARTED",
      pointerId: 1,
      point: { x: 0, y: 0 },
    })).toBe(element);
    expect(reviewReducer(element, {
      type: "ANNOTATION_SCREEN_COMPOSE_REQUESTED",
      draftId: "wrong-tool",
    })).toBe(element);

    const composing = reviewReducer(element, {
      type: "ANNOTATION_ELEMENT_SELECTED",
      key: "one@/1",
      draftId: "draft-locked",
    });
    expect(reviewReducer(composing, {
      type: "ANNOTATION_TOOL_CHANGED",
      tool: "area",
    })).toBe(composing);
  });
});

describe("per-device review store", () => {
  test("reduces only the addressed device", () => {
    let store = createDeviceReviewStore();
    store = reduceReviewForDevice(store, "ios-1", {
      type: "REVIEW_ANNOTATE_OPENED",
      tool: "element",
    });
    const iosState = selectDeviceReview(store, "ios-1");

    store = reduceReviewForDevice(store, "android-1", {
      type: "REVIEW_ACCESSIBILITY_OPENED",
      picking: false,
    });

    expect(selectDeviceReview(store, "ios-1")).toBe(iosState);
    expect(selectDeviceReview(store, "ios-1").kind).toBe("annotate");
    expect(selectDeviceReview(store, "android-1").kind).toBe("accessibility");
    expect(selectDeviceReview(store, "missing")).toEqual(createClosedReviewState());
  });

  test("draft IDs remain isolated when focus-level events address another device", () => {
    let store = createDeviceReviewStore();
    store = reduceReviewForDevice(store, "ios-1", {
      type: "REVIEW_ANNOTATE_OPENED",
      tool: "element",
    });
    store = reduceReviewForDevice(store, "ios-1", {
      type: "ANNOTATION_ELEMENT_SELECTED",
      key: "ios-button@/1",
      draftId: "ios-draft",
    });
    store = reduceReviewForDevice(store, "android-1", {
      type: "REVIEW_ANNOTATE_OPENED",
      tool: "area",
    });
    store = reduceReviewForDevice(store, "android-1", {
      type: "ESCAPE_REQUESTED",
    });

    expect(selectReviewDraftId(selectDeviceReview(store, "ios-1"))).toBe("ios-draft");
    expect(selectDeviceReview(store, "android-1").kind).toBe("closed");
  });
});
