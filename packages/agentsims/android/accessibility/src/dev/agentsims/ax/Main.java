package dev.agentsims.ax;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.content.res.Resources;
import android.util.DisplayMetrics;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.json.JSONArray;
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
  private static final long SETTLED_IDLE_MS = 100;
  private static final long SETTLED_TIMEOUT_MS = 2000;
  private static final long CHANGE_DEBOUNCE_MS = 12;
  private static final long CHANGE_MAX_LATENCY_MS = 50;
  private static final int MAX_PENDING_SNAPSHOTS = 1;
  /** Parent steps that a field action reports. A field sits near its layout. */
  private static final int ANCESTOR_LIMIT = 12;
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
  private static ThreadPoolExecutor snapshotExecutor;
  private static PrintWriter output;
  private static final Object outputLock = new Object();
  private static final Object changeLock = new Object();
  private static long firstPendingChangeAtMs;
  private static long changeSequence;
  private static int pendingEventTypes;
  private static boolean changeScheduled;
  private static volatile boolean snapshotInProgress;
  private static long touchDownTimeMs;
  private static final Map<Integer, Long> keyDownTimesMs = new HashMap<>();

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
    if (args.length == 2 && "metadata".equals(args[0])) {
      output.println(appMetadata(args[1]).toString());
      return;
    }
    try {
      connect();
      snapshotExecutor = new ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(MAX_PENDING_SNAPSHOTS),
        new ThreadFactory() {
          @Override
          public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "AgentsimsAxSnapshot");
            thread.setDaemon(true);
            return thread;
          }
        }
      );
      emit(new JSONObject().put("ready", true));

      BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
      String line;
      while ((line = input.readLine()) != null) {
        if (line.isEmpty()) continue;
        JSONObject response = new JSONObject();
        try {
          JSONObject request = new JSONObject(line);
          String operation = request.optString("op");
          if ("touch".equals(operation)) {
            injectTouch(request);
            continue;
          }
          long id = request.getLong("id");
          response.put("id", id);
          if ("key".equals(operation)) {
            injectKey(request);
            response.put("ok", true);
            emit(response);
            continue;
          }
          Runnable work;
          if ("snapshot".equals(operation)) work = new SnapshotRequest(request, response);
          else if ("perform".equals(operation) || "focus".equals(operation)) {
            work = new NodeRequest(request, response);
          } else {
            throw new IllegalArgumentException("Unsupported operation");
          }
          try {
            snapshotExecutor.execute(work);
          } catch (RejectedExecutionException error) {
            response.put("ok", false);
            response.put("error", "Too many pending snapshot requests");
            emit(response);
          }
          continue;
        } catch (Throwable error) {
          response.put("ok", false);
          response.put("error", errorMessage(error));
        }
        emit(response);
      }
    } finally {
      stopSnapshotWorker();
      disconnect();
      output = null;
    }
  }

  private static void stopSnapshotWorker() {
    ThreadPoolExecutor executor = snapshotExecutor;
    snapshotExecutor = null;
    if (executor == null) return;
    // A timed-out framework traversal can remain blocked in Binder. Do not
    // keep app_process alive and retain the one system UiAutomation connection
    // after the host closes stdin to restart the helper.
    executor.shutdownNow();
  }

  private static final class SnapshotRequest implements Runnable {
    private final JSONObject request;
    private final JSONObject response;

    SnapshotRequest(JSONObject request, JSONObject response) {
      this.request = request;
      this.response = response;
    }

    @Override
    public void run() {
      try {
        if (request.optBoolean("settled", false)) waitForIdle();
        long startedAt = SystemClock.elapsedRealtimeNanos();
        snapshotInProgress = true;
        try {
          response.put("xml", snapshotXml());
        } finally {
          snapshotInProgress = false;
        }
        response.put("ok", true);
        response.put(
          "elapsedMs",
          (SystemClock.elapsedRealtimeNanos() - startedAt) / 1_000_000.0
        );
      } catch (Throwable error) {
        try {
          response.put("ok", false);
          response.put("error", errorMessage(error));
        } catch (Throwable ignored) {}
      }
      emit(response);
    }
  }

  private static final class NodeRequest implements Runnable {
    private final JSONObject request;
    private final JSONObject response;

    NodeRequest(JSONObject request, JSONObject response) {
      this.request = request;
      this.response = response;
    }

    @Override
    public void run() {
      AccessibilityNodeInfo node = null;
      try {
        boolean focusOnly = "focus".equals(request.optString("op"));
        if (focusOnly) {
          node = automation.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
          response.put("ok", true);
          response.put("node", node == null ? JSONObject.NULL : describeNode(node));
        } else {
          String reference = request.optString("node");
          node = resolveExpectedNode(reference, request);
          String action = request.optString("action");
          NodeIdentity identity = NodeIdentity.fromRequest(request);
          if (identity == null || !identity.matches(node)) throw changedField();
          JSONObject requested = describeNode(node);
          boolean performed =
            ("focus".equals(action) && hasInputFocus(identity)) ||
            perform(node, request);
          node.recycle();
          node = null;
          // A refused action is a proven no-op. Report it, so that the host can
          // tap the field once instead of failing the text operation.
          node = automation.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
          response.put("ok", true);
          response.put("performed", performed);
          // The host compares both nodes. Android can focus the editable node
          // inside the request, or the layout around it.
          response.put("requested", requested);
          response.put("node", node == null ? JSONObject.NULL : describeNode(node));
        }
      } catch (Throwable error) {
        try {
          response.put("ok", false);
          response.put("error", errorMessage(error));
        } catch (Throwable ignored) {}
      } finally {
        if (node != null) node.recycle();
      }
      emit(response);
    }
  }

  private static AccessibilityNodeInfo resolveExpectedNode(
    String reference,
    JSONObject request
  ) {
    AccessibilityNodeInfo node = resolveNode(reference);
    if (node == null) throw changedField();
    NodeIdentity expected = NodeIdentity.fromRequest(request);
    if (
      expected == null ||
      !expected.matches(node) ||
      (request.has("resourceId") &&
        !request.optString("resourceId").equals(text(node.getViewIdResourceName()))) ||
      (request.has("class") &&
        !request.optString("class").equals(text(node.getClassName())))
    ) {
      node.recycle();
      throw changedField();
    }
    return node;
  }

  private static boolean hasInputFocus(NodeIdentity expected) {
    AccessibilityNodeInfo focused = automation.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
    if (focused == null) return false;
    try {
      return expected.matches(focused);
    } finally {
      focused.recycle();
    }
  }

  private static IllegalStateException changedField() {
    return new IllegalStateException("Android field changed. Run observe again");
  }

  private static boolean perform(AccessibilityNodeInfo node, JSONObject request) {
    String action = request.optString("action");
    if ("set-text".equals(action)) {
      Bundle arguments = new Bundle();
      arguments.putCharSequence(
        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
        request.optString("text", "")
      );
      return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
    }
    if ("focus".equals(action)) return node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
    throw new IllegalArgumentException("Unsupported node action");
  }

  private static JSONObject describeNode(AccessibilityNodeInfo node) throws Exception {
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);
    return new JSONObject()
      .put("class", text(node.getClassName()))
      .put("resourceId", text(node.getViewIdResourceName()))
      .put("text", text(node.getText()))
      .put("contentDesc", text(node.getContentDescription()))
      .put("editable", node.isEditable())
      .put("hintText", showsHintText(node))
      .put("password", node.isPassword())
      .put("focused", node.isFocused())
      .put("enabled", node.isEnabled())
      .put("windowId", node.getWindowId())
      .put("sourceId", node.hashCode())
      .put("selectionStart", node.getTextSelectionStart())
      .put("selectionEnd", node.getTextSelectionEnd())
      .put("bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]")
      .put("ancestors", ancestorChain(node));
  }

  /** The parent chain. The host accepts focus inside or around a field. */
  private static JSONArray ancestorChain(AccessibilityNodeInfo node) throws Exception {
    JSONArray chain = new JSONArray();
    AccessibilityNodeInfo current = node.getParent();
    for (int depth = 0; current != null && depth < ANCESTOR_LIMIT; depth++) {
      chain.put(
        new JSONObject()
          .put("windowId", current.getWindowId())
          .put("sourceId", current.hashCode())
          .put("resourceId", text(current.getViewIdResourceName()))
          .put("class", text(current.getClassName()))
          .put("editable", current.isEditable())
      );
      AccessibilityNodeInfo parent = current.getParent();
      current.recycle();
      current = parent;
    }
    if (current != null) current.recycle();
    return chain;
  }

  private static final class NodeIdentity {
    final int windowId;
    final int sourceId;

    NodeIdentity(int windowId, int sourceId) {
      this.windowId = windowId;
      this.sourceId = sourceId;
    }

    static NodeIdentity fromRequest(JSONObject request) {
      if (!request.has("windowId") || !request.has("sourceId")) {
        return null;
      }
      return new NodeIdentity(
        request.optInt("windowId"),
        request.optInt("sourceId")
      );
    }

    boolean matches(AccessibilityNodeInfo node) {
      return
        windowId == node.getWindowId() &&
        sourceId == node.hashCode();
    }
  }

  /** An empty field reports its hint as text from API 26. That is not a value. */
  private static boolean showsHintText(AccessibilityNodeInfo node) {
    return android.os.Build.VERSION.SDK_INT >= 26 && node.isShowingHintText();
  }

  private static String text(CharSequence value) {
    return value == null ? "" : value.toString();
  }

  /** `focus`, or the dotted path of the snapshot that the host read. */
  private static AccessibilityNodeInfo resolveNode(String reference) {
    if ("focus".equals(reference)) {
      return automation.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
    }
    String[] parts = reference.split("\\.");
    int index;
    try {
      index = Integer.parseInt(parts[0]);
    } catch (NumberFormatException error) {
      throw new IllegalArgumentException("Node must be a snapshot path or focus");
    }
    List<RootWindow> roots = collectRoots();
    AccessibilityNodeInfo node = null;
    boolean includeInvisible = true;
    try {
      if (!roots.isEmpty()) {
        if (index < 0 || index >= roots.size()) return null;
        RootWindow window = roots.get(index);
        node = AccessibilityNodeInfo.obtain(window.root);
        includeInvisible = window.includeInvisible;
      }
    } finally {
      for (RootWindow window : roots) window.root.recycle();
    }
    if (node == null) {
      if (index != 0) return null;
      node = automation.getRootInActiveWindow();
    }
    List<AccessibilityNodeInfo> parents = new ArrayList<>();
    Set<AccessibilityNodeInfo> ancestors = new HashSet<>();
    try {
      for (int depth = 1; node != null && depth < parts.length; depth++) {
        parents.add(node);
        ancestors.add(node);
        node = childAt(node, parts[depth], includeInvisible, ancestors);
      }
    } finally {
      for (AccessibilityNodeInfo parent : parents) parent.recycle();
    }
    return node;
  }

  private static AccessibilityNodeInfo childAt(
    AccessibilityNodeInfo node,
    String part,
    boolean includeInvisible,
    Set<AccessibilityNodeInfo> ancestors
  ) {
    int wanted;
    try {
      wanted = Integer.parseInt(part);
    } catch (NumberFormatException error) {
      throw new IllegalArgumentException("Node must be a snapshot path or focus");
    }
    int emitted = 0;
    int childCount = node.getChildCount();
    for (int index = 0; index < childCount; index++) {
      AccessibilityNodeInfo child = node.getChild(index);
      if (child == null) continue;
      if (ancestors.contains(child) || !emits(child, includeInvisible)) {
        child.recycle();
        continue;
      }
      if (emitted == wanted) return child;
      emitted++;
      child.recycle();
    }
    return null;
  }

  private static JSONObject appMetadata(String packageName) throws Exception {
    Object manager = Class.forName("android.app.AppGlobals").getMethod("getPackageManager").invoke(null);
    ApplicationInfo application = (ApplicationInfo) invokePackageQuery(manager, "getApplicationInfo", packageName);
    PackageInfo pkg = (PackageInfo) invokePackageQuery(manager, "getPackageInfo", packageName);
    AssetManager assets = AssetManager.class.getDeclaredConstructor().newInstance();
    AssetManager.class.getMethod("addAssetPath", String.class).invoke(assets, application.sourceDir);
    DisplayMetrics metrics = new DisplayMetrics();
    metrics.setToDefaults();
    Resources resources = new Resources(assets, metrics, null);
    JSONObject result = new JSONObject().put("bundleId", packageName);
    if (application.labelRes != 0) result.put("displayName", resources.getText(application.labelRes).toString());
    else if (application.nonLocalizedLabel != null) result.put("displayName", application.nonLocalizedLabel.toString());
    if (pkg.versionName != null) result.put("shortVersion", pkg.versionName);
    result.put("bundleVersion", Long.toString(android.os.Build.VERSION.SDK_INT >= 28 ? pkg.getLongVersionCode() : pkg.versionCode));
    Drawable drawable = resources.getDrawable(application.icon, null);
    int width = Math.max(1, drawable.getIntrinsicWidth());
    int height = Math.max(1, drawable.getIntrinsicHeight());
    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    drawable.setBounds(0, 0, width, height);
    drawable.draw(new Canvas(bitmap));
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
    bitmap.recycle();
    result.put("iconDataUrl", "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
    return result;
  }

  private static Object invokePackageQuery(Object manager, String name, String packageName) throws Exception {
    for (Method method : manager.getClass().getMethods()) {
      if (!name.equals(method.getName())) continue;
      Class<?>[] types = method.getParameterTypes();
      if (types.length < 2 || types[0] != String.class) continue;
      Object[] arguments = new Object[types.length];
      arguments[0] = packageName;
      for (int i = 1; i < types.length; i++) {
        if (types[i] == int.class) arguments[i] = 0;
        else if (types[i] == long.class) arguments[i] = 0L;
        else arguments[i] = null;
      }
      return method.invoke(manager, arguments);
    }
    throw new NoSuchMethodException(name);
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
        releaseHeldKeys();
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

  private static void injectTouch(JSONObject request) throws Exception {
    String phase = request.getString("phase");
    int action;
    if ("begin".equals(phase)) action = MotionEvent.ACTION_DOWN;
    else if ("move".equals(phase)) action = MotionEvent.ACTION_MOVE;
    else if ("end".equals(phase)) action = MotionEvent.ACTION_UP;
    else if ("cancel".equals(phase)) action = MotionEvent.ACTION_CANCEL;
    else throw new IllegalArgumentException("Unsupported touch phase");

    long eventTimeMs = SystemClock.uptimeMillis();
    if (action == MotionEvent.ACTION_DOWN || touchDownTimeMs == 0) {
      touchDownTimeMs = eventTimeMs;
    }
    MotionEvent event = MotionEvent.obtain(
      touchDownTimeMs,
      eventTimeMs,
      action,
      (float) request.getDouble("x"),
      (float) request.getDouble("y"),
      0
    );
    event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    boolean accepted;
    try {
      accepted = automation.injectInputEvent(event, false);
    } finally {
      event.recycle();
    }
    if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
      touchDownTimeMs = 0;
    }
    if (!accepted) throw new IllegalStateException("Android rejected the touch event");
  }

  private static void injectKey(JSONObject request) throws Exception {
    String phase = request.getString("phase");
    int action;
    if ("down".equals(phase)) action = KeyEvent.ACTION_DOWN;
    else if ("up".equals(phase)) action = KeyEvent.ACTION_UP;
    else throw new IllegalArgumentException("Unsupported key phase");
    injectKeyEvent(action, request.getInt("keycode"));
  }

  private static void injectKeyEvent(int action, int keycode) {
    long eventTimeMs = SystemClock.uptimeMillis();
    Long heldDownTime = keyDownTimesMs.get(keycode);
    boolean newlyHeld = action == KeyEvent.ACTION_DOWN && heldDownTime == null;
    if (newlyHeld) {
      heldDownTime = eventTimeMs;
      keyDownTimesMs.put(keycode, heldDownTime);
    }
    if (heldDownTime == null) heldDownTime = eventTimeMs;

    int metaState = heldModifierMetaState();
    KeyEvent event = new KeyEvent(
      heldDownTime,
      eventTimeMs,
      action,
      keycode,
      0,
      KeyEvent.normalizeMetaState(metaState),
      KeyCharacterMap.VIRTUAL_KEYBOARD,
      0,
      KeyEvent.FLAG_FROM_SYSTEM | KeyEvent.FLAG_VIRTUAL_HARD_KEY,
      InputDevice.SOURCE_KEYBOARD
    );
    boolean accepted = automation.injectInputEvent(event, false);
    if (!accepted) {
      if (newlyHeld) keyDownTimesMs.remove(keycode);
      throw new IllegalStateException("Android rejected the key event");
    }
    if (action == KeyEvent.ACTION_UP) keyDownTimesMs.remove(keycode);
  }

  private static int heldModifierMetaState() {
    int state = 0;
    for (int keycode : keyDownTimesMs.keySet()) {
      switch (keycode) {
        case KeyEvent.KEYCODE_SHIFT_LEFT:
          state |= KeyEvent.META_SHIFT_ON | KeyEvent.META_SHIFT_LEFT_ON;
          break;
        case KeyEvent.KEYCODE_SHIFT_RIGHT:
          state |= KeyEvent.META_SHIFT_ON | KeyEvent.META_SHIFT_RIGHT_ON;
          break;
        case KeyEvent.KEYCODE_CTRL_LEFT:
          state |= KeyEvent.META_CTRL_ON | KeyEvent.META_CTRL_LEFT_ON;
          break;
        case KeyEvent.KEYCODE_CTRL_RIGHT:
          state |= KeyEvent.META_CTRL_ON | KeyEvent.META_CTRL_RIGHT_ON;
          break;
        case KeyEvent.KEYCODE_ALT_LEFT:
          state |= KeyEvent.META_ALT_ON | KeyEvent.META_ALT_LEFT_ON;
          break;
        case KeyEvent.KEYCODE_ALT_RIGHT:
          state |= KeyEvent.META_ALT_ON | KeyEvent.META_ALT_RIGHT_ON;
          break;
        case KeyEvent.KEYCODE_META_LEFT:
          state |= KeyEvent.META_META_ON | KeyEvent.META_META_LEFT_ON;
          break;
        case KeyEvent.KEYCODE_META_RIGHT:
          state |= KeyEvent.META_META_ON | KeyEvent.META_META_RIGHT_ON;
          break;
        default:
          break;
      }
    }
    return state;
  }

  private static void releaseHeldKeys() {
    List<Integer> keys = new ArrayList<>(keyDownTimesMs.keySet());
    for (int keycode : keys) {
      try {
        injectKeyEvent(KeyEvent.ACTION_UP, keycode);
      } catch (Throwable ignored) {}
    }
    keyDownTimesMs.clear();
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
    int roots = appendInteractiveWindows(xml);
    if (roots == 0) {
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      if (root == null) return null;
      try {
        // A single-window Compose/RN sheet can mark the underlying app nodes
        // invisible without removing them. The helper returns the complete raw
        // hierarchy; browser hit-target eligibility is a UI concern.
        appendNode(
          xml,
          root,
          true,
          null,
          new HashSet<AccessibilityNodeInfo>()
        );
      } finally {
        root.recycle();
      }
    }
    xml.append("</hierarchy>");
    return xml.toString();
  }

  private static int appendInteractiveWindows(StringBuilder xml) {
    List<RootWindow> roots = collectRoots();
    int appended = 0;
    try {
      for (RootWindow window : roots) {
        if (appendNode(
          xml,
          window.root,
          window.includeInvisible,
          window.metadata,
          new HashSet<AccessibilityNodeInfo>()
        )) appended++;
      }
    } finally {
      for (RootWindow window : roots) window.root.recycle();
    }
    return appended;
  }

  /** The window order that gives every node its snapshot path. */
  private static List<RootWindow> collectRoots() {
    List<RootWindow> roots = new ArrayList<>();
    List<AccessibilityWindowInfo> windows = automation.getWindows();
    if (windows == null || windows.isEmpty()) return roots;

    List<AccessibilityWindowInfo> ordered = new ArrayList<>(windows);
    Collections.sort(ordered, new Comparator<AccessibilityWindowInfo>() {
      @Override
      public int compare(AccessibilityWindowInfo left, AccessibilityWindowInfo right) {
        int layer = Integer.compare(left.getLayer(), right.getLayer());
        return layer != 0 ? layer : Integer.compare(left.getId(), right.getId());
      }
    });

    Set<AccessibilityNodeInfo> rootsSeen = new HashSet<>();
    try {
      for (AccessibilityWindowInfo window : ordered) {
        AccessibilityNodeInfo root = window.getRoot();
        if (root == null) continue;
        boolean includeInvisible =
          window.getType() == AccessibilityWindowInfo.TYPE_APPLICATION;
        if (
          !shouldIncludeWindow(window, root) ||
          !rootsSeen.add(root) ||
          !emits(root, includeInvisible)
        ) {
          root.recycle();
          continue;
        }
        // Preserve inactive base windows and invisible descendants within an
        // active app window. RN/Compose sheets frequently hide the underlying
        // semantics in-place; filtering here produced the 10-node
        // FrameLayout-only regression. Consumers retain visible-to-user and
        // decide which nodes are eligible for hover/hit testing themselves.
        roots.add(new RootWindow(
          root,
          new WindowMetadata(window),
          includeInvisible
        ));
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

  private static boolean appendNode(
    StringBuilder xml,
    AccessibilityNodeInfo node,
    boolean includeInvisible,
    WindowMetadata window,
    Set<AccessibilityNodeInfo> ancestors
  ) {
    if (!emits(node, includeInvisible) || !ancestors.add(node)) return false;
    try {
      Rect bounds = new Rect();
      node.getBoundsInScreen(bounds);
      xml.append("<node");
      attribute(xml, "window-id", node.getWindowId());
      if (window != null) {
        attribute(xml, "window-layer", window.layer);
        attribute(xml, "window-type", window.type);
        attribute(xml, "window-active", window.active);
        attribute(xml, "window-focused", window.focused);
      }
      attribute(xml, "text", node.getText());
      attribute(xml, "resource-id", node.getViewIdResourceName());
      attribute(xml, "source-id", node.hashCode());
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
      attribute(xml, "hint-text", showsHintText(node));
      attribute(xml, "editable", node.isEditable());
      attribute(xml, "selected", node.isSelected());
      attribute(xml, "visible-to-user", node.isVisibleToUser());
      attribute(xml, "bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]");
      xml.append('>');

      int childCount = node.getChildCount();
      for (int index = 0; index < childCount; index++) {
        AccessibilityNodeInfo child = node.getChild(index);
        if (child == null) continue;
        try {
          appendNode(
            xml,
            child,
            includeInvisible,
            null,
            ancestors
          );
        } finally {
          child.recycle();
        }
      }
      xml.append("</node>");
      return true;
    } finally {
      ancestors.remove(node);
    }
  }

  /** One rule for which nodes the snapshot prints and which paths resolve. */
  private static boolean emits(
    AccessibilityNodeInfo node,
    boolean includeInvisible
  ) {
    return node != null && (includeInvisible || node.isVisibleToUser());
  }

  private static final class RootWindow {
    final AccessibilityNodeInfo root;
    final WindowMetadata metadata;
    final boolean includeInvisible;

    RootWindow(AccessibilityNodeInfo root, WindowMetadata metadata, boolean includeInvisible) {
      this.root = root;
      this.metadata = metadata;
      this.includeInvisible = includeInvisible;
    }
  }

  private static final class WindowMetadata {
    final int layer;
    final int type;
    final boolean active;
    final boolean focused;

    WindowMetadata(AccessibilityWindowInfo window) {
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
