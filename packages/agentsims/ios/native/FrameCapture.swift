import Foundation
import CoreVideo
import CoreMedia
import CoreGraphics
import IOSurface
import ObjectiveC

struct NativeFrameTiming: Sendable {
    let sequence: UInt64
    let timestampUs: UInt64
}

/// Headless simulator frame capture via direct IOSurface access.
///
/// Uses SimulatorKit frame callbacks (via objc_msgSend on the IO port descriptor)
/// for event-driven capture with zero jitter. Frames are copied and emitted only
/// while a consumer wants them, and only when the surface seed changes.
///
/// Pipeline: IOSurface (shared memory) → CVPixelBuffer (copy) → encoders
actor FrameCapture {
    private let queue = DispatchSerialQueue(label: "frame-capture", qos: .userInteractive)
    nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

    private var photocopier = Photocopier()
    private var onFrame: ((CVPixelBuffer, CMTime, NativeFrameTiming?) -> Void)?
    private var onIdle: (() -> Void)?
    private var onSize: ((Int, Int) -> Void)?
    private var frameCount: UInt64 = 0
    private var nativeFrameSequence: UInt64 = 0
    private(set) var capturedWidth: Int = 0
    private(set) var capturedHeight: Int = 0
    private var idleTimer: Task<Void, Never>?
    private var lastCaptureTime: ContinuousClock.Instant = .now
    private var lastSeeds: [ObjectIdentifier: UInt32] = [:]
    private var rewireTickCount: Int = 0
    private var surfaceSeen = false
    /// True while any consumer wants frames. Without demand a callback only
    /// tracks the surface size and returns before the copy.
    private var demand = false
    /// True while an MJPEG consumer exists. See `idleInterval`.
    private var idleReemit = false
    /// At most one capture waits on `queue`; callbacks that arrive meanwhile
    /// coalesce into it.
    private var capturePending = false
    /// While an MJPEG consumer exists, the idle timer asks the engine to send
    /// the last frame again (already encoded) at this interval. Browsers that
    /// render `<img src="…/stream.mjpeg">` paint a multipart chunk only when
    /// the NEXT boundary arrives, so a single static frame never paints.
    /// H.264 consumers do not need this: a static screen sends nothing.
    private static let idleInterval: ContinuousClock.Duration = .milliseconds(200)

    private var descriptors: [NSObject] = []
    private var callbackUUIDs: [ObjectIdentifier: UUID] = [:]
    private var ioClient: NSObject?
    private var deviceUDID: String?

    func start(
        deviceUDID: String,
        onFrame: @escaping @Sendable (CVPixelBuffer, CMTime, NativeFrameTiming?) -> Void,
        onIdle: @escaping @Sendable () -> Void,
        onSize: @escaping @Sendable (Int, Int) -> Void
    ) throws {
        self.onFrame = onFrame
        self.onIdle = onIdle
        self.onSize = onSize

        SimFrameworks.load()
        guard let device = Self.findSimDevice(udid: deviceUDID) else {
            throw makeError(1, "Device \(deviceUDID) not found")
        }

        let state = device.value(forKey: "stateString") as? String ?? "unknown"
        guard state == "Booted" else {
            throw makeError(2, "Device not booted (state: \(state))")
        }

        guard let io = device.perform(NSSelectorFromString("io"))?.takeUnretainedValue() as? NSObject else {
            throw makeError(3, "Failed to get device IO")
        }
        self.ioClient = io
        self.deviceUDID = deviceUDID

        do {
            try wireUpFramebuffer()
        } catch let error as NSError where error.domain == "FrameCapture" && error.code == 5 {
            // A booted device can publish its display port later, for example
            // right after an external `simctl boot`. The idle timer rewires.
            print("[capture] No display descriptor yet; waiting for it.")
        }
        startIdleTimer()
    }

    /// Find all framebuffer display descriptors, register callbacks on each,
    /// and cache them. Safe to re-call if the cached descriptors become stale.
    ///
    /// The simulator exposes multiple `com.apple.framebuffer.display` ports
    /// (main screen + secondary planes/overlays). We can't reliably tell which
    /// one is the primary up-front, so we listen on all of them and let
    /// `captureFrame()` pick whichever currently has the largest live surface.
    private func wireUpFramebuffer() throws {
        guard let io = ioClient else {
            throw makeError(3, "No IO client")
        }

        // Refresh ports — descriptors are created lazily.
        io.perform(NSSelectorFromString("updateIOPorts"))

        let candidates = try findFramebufferDescriptors(io: io)

        // Tear down old callbacks.
        let unregSel = NSSelectorFromString("unregisterScreenCallbacksWithUUID:")
        for oldDesc in descriptors {
            if let uuid = callbackUUIDs[ObjectIdentifier(oldDesc)],
               oldDesc.responds(to: unregSel) {
                oldDesc.perform(unregSel, with: uuid)
            }
        }
        callbackUUIDs.removeAll()
        lastSeeds.removeAll()
        descriptors = candidates

        // Registering screen callbacks is what causes SimulatorKit to wire the
        // display pipeline to our client and populate `framebufferSurface`.
        for desc in candidates {
            try registerFrameCallbacks(desc: desc)
        }

        if let surface = currentSurface() {
            let w = IOSurfaceGetWidth(surface)
            let h = IOSurfaceGetHeight(surface)
            // A rewire after start can be the first time the size is known.
            if w > 0, h > 0, (w != capturedWidth || h != capturedHeight) {
                capturedWidth = w
                capturedHeight = h
                onSize?(w, h)
            }
        }

        captureFrame()
    }

    private func currentSurface() -> IOSurface? {
        guard let desc = pickBestDescriptor() else { return nil }
        let surfSel = NSSelectorFromString("framebufferSurface")
        guard let surfObj = desc.perform(surfSel)?.takeUnretainedValue() else { return nil }
        return unsafeBitCast(surfObj, to: IOSurface.self)
    }

    private func findFramebufferDescriptors(io: NSObject) throws -> [NSObject] {
        guard let ports = io.value(forKey: "deviceIOPorts") as? [NSObject] else {
            throw makeError(4, "Failed to get IO ports")
        }

        let pidSel = NSSelectorFromString("portIdentifier")
        let descSel = NSSelectorFromString("descriptor")
        let surfSel = NSSelectorFromString("framebufferSurface")

        var candidates: [NSObject] = []
        for port in ports {
            guard port.responds(to: pidSel),
                  let pid = port.perform(pidSel)?.takeUnretainedValue(),
                  "\(pid)" == "com.apple.framebuffer.display",
                  port.responds(to: descSel),
                  let desc = port.perform(descSel)?.takeUnretainedValue() as? NSObject,
                  desc.responds(to: surfSel)
            else { continue }
            candidates.append(desc)
        }

        if candidates.isEmpty {
            throw makeError(5, "No framebuffer display descriptor found")
        }
        return candidates
    }

    /// Return the descriptor whose live surface has the largest area.
    /// Secondary planes/overlays are typically smaller than the main screen.
    private func pickBestDescriptor() -> NSObject? {
        let surfSel = NSSelectorFromString("framebufferSurface")
        var best: NSObject?
        var bestArea: Int = 0
        for desc in descriptors {
            guard let surfObj = desc.perform(surfSel)?.takeUnretainedValue() else { continue }
            let surf = unsafeBitCast(surfObj, to: IOSurface.self)
            let area = IOSurfaceGetWidth(surf) * IOSurfaceGetHeight(surf)
            if area > bestArea {
                best = desc
                bestArea = area
            }
        }
        return best
    }

    // MARK: - Frame callbacks via objc_msgSend

    private func registerFrameCallbacks(desc: AnyObject) throws {
        let regSel = #selector(FramebufferDescriptor.registerScreenCallbacks)
        guard desc.responds(to: regSel) else {
            throw makeError(8, "Descriptor doesn't support registerScreenCallbacks")
        }

        let uuid = UUID()
        callbackUUIDs[ObjectIdentifier(desc)] = uuid

        desc.registerScreenCallbacks(
            uuid: uuid,
            callbackQueue: queue,
            frameCallback: { [self] in assumeIsolated { $0.scheduleCapture() } },
            surfacesChangedCallback: { [self] in assumeIsolated { $0.scheduleCapture() } },
            propertiesChangedCallback: {}
        )
    }

    private func startIdleTimer() {
        self.idleTimer = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.onIdleTimerTick()
                try? await Task.sleep(for: Self.idleInterval)
            }
        }
    }

    private func onIdleTimerTick() {
        // Self-heal: if no surface was ever readable, the cached descriptor
        // is likely stale. Re-wire the pipeline every ~1s until one appears.
        if !surfaceSeen {
            captureFrame()
            rewireTickCount += 1
            // Every ~5 s also fetch the device and IO object again in case
            // the cached ones predate the boot.
            if rewireTickCount % 25 == 0, let deviceUDID,
               let device = Self.findSimDevice(udid: deviceUDID),
               let io = device.perform(NSSelectorFromString("io"))?.takeUnretainedValue() as? NSObject {
                ioClient = io
            }
            if rewireTickCount % 5 == 0 {
                try? wireUpFramebuffer()
            }
        }
        guard demand else { return }
        // Seed check only: catches a missed callback and costs nothing when
        // the screen is static.
        captureFrame()
        let now = ContinuousClock.now
        if idleReemit, now - lastCaptureTime >= Self.idleInterval {
            lastCaptureTime = now
            onIdle?()
        }
    }

    /// Set what consumers want. When demand starts, emit the current frame
    /// at once so the first consumer does not wait for a screen change.
    func setDemand(frames: Bool, idleReemit: Bool) {
        let started = frames && !demand
        demand = frames
        self.idleReemit = frames && idleReemit
        if started { captureFrame(force: true) }
    }

    /// Emit the current frame even when the seed has not changed.
    func captureNow() {
        captureFrame(force: true)
    }

    // MARK: - Frame capture

    private func scheduleCapture() {
        guard !capturePending else { return }
        capturePending = true
        queue.async { [self] in
            assumeIsolated {
                $0.capturePending = false
                $0.captureFrame()
            }
        }
    }

    private func captureFrame(force: Bool = false) {
        // SimulatorKit XPC replies leave autoreleased temporaries; drain per capture.
        autoreleasepool { captureFrameBody(force: force) }
    }

    private func captureFrameBody(force: Bool) {
        guard let desc = pickBestDescriptor() else { return }

        let surfSel = NSSelectorFromString("framebufferSurface")
        guard let surfObj = desc.perform(surfSel)?.takeUnretainedValue() else { return }
        let surface = unsafeBitCast(surfObj, to: IOSurface.self)

        let w = IOSurfaceGetWidth(surface)
        let h = IOSurfaceGetHeight(surface)
        guard w > 0, h > 0 else { return }
        surfaceSeen = true

        if capturedWidth != w || capturedHeight != h {
            capturedWidth = w
            capturedHeight = h
            print("[capture] Surface size changed: \(w)x\(h)")
            onSize?(w, h)
        }

        guard demand else { return }

        // Seed-skip: when the framebuffer content has not changed, do not copy
        // or encode the same pixels again.
        let key = ObjectIdentifier(desc)
        let seed = IOSurfaceGetSeed(surface)
        let seedChanged = lastSeeds[key] != seed
        if frameCount > 0, !seedChanged, !force { return }
        lastSeeds[key] = seed

        var pixelBuffer: Unmanaged<CVPixelBuffer>?
        let status = CVPixelBufferCreateWithIOSurface(
            kCFAllocatorDefault, surface,
            [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary,
            &pixelBuffer
        )
        guard status == kCVReturnSuccess, let pb = pixelBuffer?.takeRetainedValue() else { return }

        lastCaptureTime = .now
        frameCount += 1
        let timestamp = CMTime(value: CMTimeValue(frameCount), timescale: 60)
        let nativeTiming: NativeFrameTiming?
        if seedChanged {
            nativeFrameSequence += 1
            nativeTiming = NativeFrameTiming(
                sequence: nativeFrameSequence,
                timestampUs: DispatchTime.now().uptimeNanoseconds / 1_000
            )
        } else {
            nativeTiming = nil
        }
        guard let copy = photocopier.copy(pb) else { return }
        onFrame?(copy, timestamp, nativeTiming)
    }

    /// Copy the framebuffer as it is now. SimulatorKit recycles the surface in
    /// place, so the caller gets a private copy.
    func snapshot() -> CVPixelBuffer? {
        autoreleasepool { () -> CVPixelBuffer? in
            guard let surface = currentSurface(),
                  IOSurfaceGetWidth(surface) > 0, IOSurfaceGetHeight(surface) > 0
            else { return nil }
            var pixelBuffer: Unmanaged<CVPixelBuffer>?
            let status = CVPixelBufferCreateWithIOSurface(
                kCFAllocatorDefault, surface,
                [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary,
                &pixelBuffer
            )
            guard status == kCVReturnSuccess, let pb = pixelBuffer?.takeRetainedValue() else { return nil }
            return photocopier.copy(pb)
        }
    }

    func getScreenSize() -> (width: Int, height: Int)? {
        guard capturedWidth > 0, capturedHeight > 0 else { return nil }
        return (capturedWidth, capturedHeight)
    }

    func stop() {
        idleTimer?.cancel()
        idleTimer = nil

        let unregSel = NSSelectorFromString("unregisterScreenCallbacksWithUUID:")
        for desc in descriptors {
            if let uuid = callbackUUIDs[ObjectIdentifier(desc)],
               desc.responds(to: unregSel) {
                desc.perform(unregSel, with: uuid)
            }
        }
        callbackUUIDs.removeAll()
        descriptors.removeAll()
        lastSeeds.removeAll()
        onFrame = nil
        onIdle = nil
        onSize = nil
        deviceUDID = nil
        demand = false
        idleReemit = false
        surfaceSeen = false
        ioClient = nil
        capturedWidth = 0
        capturedHeight = 0
        frameCount = 0
        nativeFrameSequence = 0
        rewireTickCount = 0

    }

    // MARK: - Helpers

    private func makeError(_ code: Int, _ msg: String) -> NSError {
        NSError(domain: "FrameCapture", code: code,
                userInfo: [NSLocalizedDescriptionKey: msg])
    }

    static func findSimDevice(udid: String) -> NSObject? {
        guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else { return nil }
        let developerDir = Xcode.developerDir()
        let sharedSel = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        guard let context = contextClass.perform(sharedSel, with: developerDir, with: nil)?
                .takeUnretainedValue() as? NSObject else { return nil }
        let deviceSetSel = NSSelectorFromString("defaultDeviceSetWithError:")
        guard let deviceSet = context.perform(deviceSetSel, with: nil)?
                .takeUnretainedValue() as? NSObject else { return nil }
        guard let devices = deviceSet.value(forKey: "devices") as? [NSObject] else { return nil }
        return devices.first(where: {
            ($0.value(forKey: "UDID") as? NSUUID)?.uuidString == udid
        })
    }
}

@objc protocol FramebufferDescriptor {
    @objc(registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:)
    func registerScreenCallbacks(
        uuid: UUID,
        callbackQueue: DispatchQueue,
        frameCallback: @convention(block) @escaping () -> Void,
        surfacesChangedCallback: @convention(block) @escaping () -> Void,
        propertiesChangedCallback: @convention(block) @escaping () -> Void
    )
}
