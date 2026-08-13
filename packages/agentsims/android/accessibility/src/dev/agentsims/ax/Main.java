package dev.agentsims.ax;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeoutException;
import org.json.JSONObject;

/**
 * Small persistent accessibility bridge run as the Android shell user.
 *
 * The stock `uiautomator dump` command creates a new UiAutomation connection,
 * waits for global idle, walks the tree, and tears the connection down for
 * every snapshot. Keeping the connection and framework caches warm makes the
 * normal traversal a few milliseconds instead of seconds.
 */
public final class Main {
  private static final int MAX_NODES = 1000;
  private static final int MAX_DEPTH = 80;
  private static final long SETTLED_IDLE_MS = 100;
  private static final long SETTLED_TIMEOUT_MS = 2000;
  private static final long CHANGE_DEBOUNCE_MS = 12;
  private static final long CHANGE_MAX_LATENCY_MS = 50;
  private static final int RELEVANT_EVENT_TYPES =
    AccessibilityEvent.TYPE_VIEW_CLICKED |
    AccessibilityEvent.TYPE_VIEW_SELECTED |
    AccessibilityEvent.TYPE_VIEW_FOCUSED |
    AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED |
    AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED |
    AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED |
    AccessibilityEvent.TYPE_VIEW_SCROLLED |
    AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED |
    AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED |
    AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED |
    AccessibilityEvent.TYPE_WINDOWS_CHANGED;

  private static HandlerThread handlerThread;
  private static Handler changeHandler;
  private static UiAutomation automation;
  private static PrintWriter output;
  private static final Object outputLock = new Object();
  private static final Object changeLock = new Object();
  private static long firstPendingChangeAtMs;
  private static long changeSequence;
  private static int pendingEventTypes;
  private static boolean changeScheduled;
  private static volatile boolean snapshotInProgress;

  private static final Runnable emitPendingChange = new Runnable() {
    @Override
    public void run() {
      int eventTypes;
      long sequence;
      synchronized (changeLock) {
        if (!changeScheduled) return;
        changeScheduled = false;
        firstPendingChangeAtMs = 0;
        eventTypes = pendingEventTypes;
        pendingEventTypes = 0;
        sequence = ++changeSequence;
      }
      try {
        emit(new JSONObject()
          .put("event", "changed")
          .put("sequence", sequence)
          .put("eventTypes", eventTypes)
          .put("atMs", SystemClock.elapsedRealtime()));
      } catch (Throwable ignored) {}
    }
  };

  private Main() {}

  public static void main(String[] args) throws Exception {
    output = new PrintWriter(System.out, true);
    try {
      connect();
      emit(new JSONObject().put("ready", true));

      BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
      String line;
      while ((line = input.readLine()) != null) {
        if (line.isEmpty()) continue;
        JSONObject response = new JSONObject();
        try {
          JSONObject request = new JSONObject(line);
          long id = request.getLong("id");
          response.put("id", id);
          if (!"snapshot".equals(request.optString("op"))) {
            throw new IllegalArgumentException("Unsupported operation");
          }
          if (request.optBoolean("settled", false)) waitForIdle();
          long startedAt = SystemClock.elapsedRealtimeNanos();
          snapshotInProgress = true;
          try {
            response.put("xml", snapshotXml());
          } finally {
            snapshotInProgress = false;
          }
          response.put("ok", true);
          response.put("elapsedMs", (SystemClock.elapsedRealtimeNanos() - startedAt) / 1_000_000.0);
        } catch (Throwable error) {
          response.put("ok", false);
          response.put("error", errorMessage(error));
        }
        emit(response);
      }
    } finally {
      disconnect();
      output = null;
    }
  }

  private static void connect() throws Exception {
    handlerThread = new HandlerThread("AgentsimsAxServer");
    handlerThread.start();
    changeHandler = new Handler(handlerThread.getLooper());

    // UiAutomation's accessibility callback path expects a main Looper even
    // though the actual callbacks run on the HandlerThread above. app_process
    // does not prepare one for custom main classes.
    Looper.prepareMainLooper();

    Class<?> connectionType = Class.forName("android.app.UiAutomationConnection");
    Class<?> connectionInterface = Class.forName("android.app.IUiAutomationConnection");
    Object connection = connectionType.getDeclaredConstructor().newInstance();
    Constructor<UiAutomation> constructor = UiAutomation.class.getDeclaredConstructor(
      Looper.class,
      connectionInterface
    );
    constructor.setAccessible(true);
    automation = constructor.newInstance(handlerThread.getLooper(), connection);

    Method connect = UiAutomation.class.getDeclaredMethod("connect", int.class);
    connect.setAccessible(true);
    // The default UiAutomation connection suppresses every enabled
    // AccessibilityService. Agentsims must coexist with services used by the
    // app under review, so opt out before the first connection is made.
    connect.invoke(automation, UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);

    // UiAutomationConnection defaults to all events, view IDs, and important
    // plus unimportant views. Set those requirements explicitly and add
    // interactive-window retrieval so application dialogs/sheets do not hide
    // the base app window from review.
    AccessibilityServiceInfo serviceInfo = automation.getServiceInfo();
    if (serviceInfo != null) {
      serviceInfo.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
      serviceInfo.flags |=
        AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS |
        AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS |
        AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
      automation.setServiceInfo(serviceInfo);
    }
    automation.setOnAccessibilityEventListener(Main::onAccessibilityEvent);
  }

  private static void disconnect() {
    synchronized (changeLock) {
      if (changeHandler != null) changeHandler.removeCallbacks(emitPendingChange);
      changeScheduled = false;
      firstPendingChangeAtMs = 0;
      pendingEventTypes = 0;
    }
    if (automation != null) {
      try {
        automation.setOnAccessibilityEventListener(null);
        Method disconnect = UiAutomation.class.getDeclaredMethod("disconnect");
        disconnect.setAccessible(true);
        disconnect.invoke(automation);
      } catch (Throwable ignored) {}
      automation = null;
    }
    if (handlerThread != null) {
      handlerThread.quitSafely();
      handlerThread = null;
    }
    changeHandler = null;
  }

  private static void onAccessibilityEvent(AccessibilityEvent event) {
    int eventType = event.getEventType();
    if ((eventType & RELEVANT_EVENT_TYPES) == 0 || snapshotInProgress) return;
    Handler handler = changeHandler;
    if (handler == null) return;

    long now = SystemClock.uptimeMillis();
    long delay;
    synchronized (changeLock) {
      pendingEventTypes |= eventType;
      if (!changeScheduled) {
        changeScheduled = true;
        firstPendingChangeAtMs = now;
      } else {
        handler.removeCallbacks(emitPendingChange);
      }
      long remaining = Math.max(0, CHANGE_MAX_LATENCY_MS - (now - firstPendingChangeAtMs));
      delay = Math.min(CHANGE_DEBOUNCE_MS, remaining);
      handler.postDelayed(emitPendingChange, delay);
    }
  }

  private static void emit(JSONObject payload) {
    synchronized (outputLock) {
      if (output != null) output.println(payload.toString());
    }
  }

  private static void waitForIdle() {
    try {
      automation.waitForIdle(SETTLED_IDLE_MS, SETTLED_TIMEOUT_MS);
    } catch (TimeoutException ignored) {
      // A permanently animating app should still be observable. The settled
      // mode is a bounded best effort, never a ten-second UI blocker.
    }
  }

  private static String snapshotXml() {
    // Immediately after a UiAutomation connection is established Android can
    // transiently report neither windows nor an active root. Retry only that
    // empty-root condition; this is not an idle wait and costs nothing on the
    // warm path.
    for (int attempt = 0; attempt < 4; attempt++) {
      String xml = snapshotXmlIfAvailable();
      if (xml != null) return xml;
      if (attempt < 3) SystemClock.sleep(8);
    }
    throw new IllegalStateException("UiAutomation returned no active root");
  }

  private static String snapshotXmlIfAvailable() {
    StringBuilder xml = new StringBuilder(64 * 1024);
    xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    xml.append("<hierarchy rotation=\"0\">");
    int[] count = new int[] {0};
    int roots = appendInteractiveWindows(xml, count);
    if (roots == 0) {
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      if (root == null) return null;
      try {
        // A single-window Compose/RN sheet can mark the underlying app nodes
        // invisible without removing them. The helper returns the complete raw
        // hierarchy; browser hit-target eligibility is a UI concern.
        appendNode(xml, root, 0, count, true, null);
      } finally {
        root.recycle();
      }
    }
    xml.append("</hierarchy>");
    return xml.toString();
  }

  private static int appendInteractiveWindows(StringBuilder xml, int[] count) {
    List<AccessibilityWindowInfo> windows = automation.getWindows();
    if (windows == null || windows.isEmpty()) return 0;

    List<AccessibilityWindowInfo> ordered = new ArrayList<>(windows);
    Collections.sort(ordered, new Comparator<AccessibilityWindowInfo>() {
      @Override
      public int compare(AccessibilityWindowInfo left, AccessibilityWindowInfo right) {
        int layer = Integer.compare(left.getLayer(), right.getLayer());
        return layer != 0 ? layer : Integer.compare(left.getId(), right.getId());
      }
    });

    Set<String> rootsSeen = new HashSet<>();
    int roots = 0;
    try {
      for (AccessibilityWindowInfo window : ordered) {
        if (count[0] >= MAX_NODES) break;
        AccessibilityNodeInfo root = window.getRoot();
        if (root == null) continue;
        try {
          if (!shouldIncludeWindow(window, root)) continue;
          String signature = root.getWindowId() + ":" + root.hashCode();
          if (!rootsSeen.add(signature)) continue;
          WindowMetadata metadata = new WindowMetadata(window);
          // Preserve inactive base windows and invisible descendants within an
          // active app window. RN/Compose sheets frequently hide the underlying
          // semantics in-place; filtering here produced the 10-node
          // FrameLayout-only regression. Consumers retain visible-to-user and
          // decide which nodes are eligible for hover/hit testing themselves.
          boolean includeInvisible =
            window.getType() == AccessibilityWindowInfo.TYPE_APPLICATION;
          appendNode(xml, root, 0, count, includeInvisible, metadata);
          roots++;
        } finally {
          root.recycle();
        }
      }
    } finally {
      for (AccessibilityWindowInfo window : windows) window.recycle();
    }
    return roots;
  }

  private static boolean shouldIncludeWindow(
    AccessibilityWindowInfo window,
    AccessibilityNodeInfo root
  ) {
    int type = window.getType();
    if (type == AccessibilityWindowInfo.TYPE_APPLICATION) return true;
    if (type != AccessibilityWindowInfo.TYPE_SYSTEM || (!window.isActive() && !window.isFocused())) {
      return false;
    }
    CharSequence packageName = root.getPackageName();
    String name = packageName == null ? "" : packageName.toString();
    // A focused permission or system dialog is relevant; persistent chrome
    // and keyboards are not part of the reviewed application hierarchy.
    return !"com.android.systemui".equals(name) && !name.contains("inputmethod");
  }

  private static void appendNode(
    StringBuilder xml,
    AccessibilityNodeInfo node,
    int depth,
    int[] count,
    boolean includeInvisible,
    WindowMetadata window
  ) {
    if (
      node == null ||
      depth > MAX_DEPTH ||
      count[0] >= MAX_NODES ||
      (!includeInvisible && !node.isVisibleToUser())
    ) return;
    count[0]++;
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);

    xml.append("<node");
    if (depth == 0 && window != null) {
      attribute(xml, "window-id", window.id);
      attribute(xml, "window-layer", window.layer);
      attribute(xml, "window-type", window.type);
      attribute(xml, "window-active", window.active);
      attribute(xml, "window-focused", window.focused);
    }
    attribute(xml, "text", node.getText());
    attribute(xml, "resource-id", node.getViewIdResourceName());
    attribute(xml, "class", node.getClassName());
    attribute(xml, "package", node.getPackageName());
    attribute(xml, "content-desc", node.getContentDescription());
    attribute(xml, "checkable", node.isCheckable());
    attribute(xml, "checked", node.isChecked());
    attribute(xml, "clickable", node.isClickable());
    attribute(xml, "enabled", node.isEnabled());
    attribute(xml, "focusable", node.isFocusable());
    attribute(xml, "focused", node.isFocused());
    attribute(xml, "scrollable", node.isScrollable());
    attribute(xml, "long-clickable", node.isLongClickable());
    attribute(xml, "password", node.isPassword());
    attribute(xml, "selected", node.isSelected());
    attribute(xml, "visible-to-user", node.isVisibleToUser());
    attribute(xml, "bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]");
    xml.append('>');

    int childCount = node.getChildCount();
    for (int index = 0; index < childCount && count[0] < MAX_NODES; index++) {
      AccessibilityNodeInfo child = node.getChild(index);
      if (child == null) continue;
      try {
        appendNode(xml, child, depth + 1, count, includeInvisible, null);
      } finally {
        child.recycle();
      }
    }
    xml.append("</node>");
  }

  private static final class WindowMetadata {
    final int id;
    final int layer;
    final int type;
    final boolean active;
    final boolean focused;

    WindowMetadata(AccessibilityWindowInfo window) {
      id = window.getId();
      layer = window.getLayer();
      type = window.getType();
      active = window.isActive();
      focused = window.isFocused();
    }
  }

  private static void attribute(StringBuilder xml, String name, boolean value) {
    attribute(xml, name, value ? "true" : "false");
  }

  private static void attribute(StringBuilder xml, String name, int value) {
    attribute(xml, name, Integer.toString(value));
  }

  private static void attribute(StringBuilder xml, String name, CharSequence value) {
    attribute(xml, name, value == null ? "" : value.toString());
  }

  private static void attribute(StringBuilder xml, String name, String value) {
    xml.append(' ').append(name).append("=\"");
    appendEscaped(xml, value == null ? "" : value);
    xml.append('\"');
  }

  private static void appendEscaped(StringBuilder output, String value) {
    for (int index = 0; index < value.length(); index++) {
      char character = value.charAt(index);
      switch (character) {
        case '&': output.append("&amp;"); break;
        case '<': output.append("&lt;"); break;
        case '>': output.append("&gt;"); break;
        case '\"': output.append("&quot;"); break;
        case '\'': output.append("&apos;"); break;
        default:
          output.append(character < 0x20 && character != '\n' && character != '\r' && character != '\t'
            ? ' '
            : character);
      }
    }
  }

  private static String errorMessage(Throwable error) {
    Throwable cause = error;
    while (cause.getCause() != null) cause = cause.getCause();
    String message = cause.getMessage();
    return cause.getClass().getSimpleName() + (message == null || message.isEmpty() ? "" : ": " + message);
  }
}
