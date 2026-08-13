import CoreAudio
import Foundation

struct HostAudioSnapshot: Codable {
    struct Device: Codable {
        let uid: String
        let name: String
        let inputChannels: Int
        let outputChannels: Int
        let outputVolume: Float32?
        let outputVolumeSettable: Bool
    }

    let devices: [Device]
    let defaultInputUID: String?
    let defaultOutputUID: String?
}

enum HostAudio {
    enum RouteKind: String {
        case input
        case output
    }

    enum Error: LocalizedError {
        case coreAudio(OSStatus, String)
        case deviceNotFound(String)
        case unsupportedRoute(String, RouteKind)
        case invalidRouteKind(String)
        case noDefaultOutput
        case outputRoutingRequiresMacOS14_2

        var errorDescription: String? {
            switch self {
            case let .coreAudio(status, operation):
                return "\(operation) failed with CoreAudio status \(status)"
            case let .deviceNotFound(uid):
                return "Audio device not found: \(uid)"
            case let .unsupportedRoute(name, kind):
                return "\(name) does not support \(kind.rawValue)"
            case let .invalidRouteKind(kind):
                return "Unsupported audio route kind: \(kind)"
            case .noDefaultOutput:
                return "No Mac audio output is available"
            case .outputRoutingRequiresMacOS14_2:
                return "Live audio output routing requires macOS 14.2 or newer"
            }
        }
    }

    private static let outputRouteLock = NSLock()
    @available(macOS 14.2, *)
    private static var outputRoute: HostAudioOutputRoute?

    static func snapshotJSON() throws -> String {
        let devices = try allDeviceIDs().compactMap { id -> HostAudioSnapshot.Device? in
            // Private aggregate destruction is asynchronous. CoreAudio can
            // briefly return the retired ID from the device list even though
            // its properties are already gone; omit that transient object
            // instead of failing the entire media inventory.
            guard let uid = try? stringProperty(id, selector: kAudioDevicePropertyDeviceUID),
                  !uid.isEmpty,
                  !uid.hasPrefix("dev.agentsims.audio-route."),
                  let name = try? stringProperty(id, selector: kAudioObjectPropertyName)
            else { return nil }
            let volume = outputVolumeInfo(id)
            return HostAudioSnapshot.Device(
                uid: uid,
                name: name.isEmpty ? uid : name,
                inputChannels: (try? channelCount(id, scope: kAudioDevicePropertyScopeInput)) ?? 0,
                outputChannels: (try? channelCount(id, scope: kAudioDevicePropertyScopeOutput)) ?? 0,
                outputVolume: volume.value,
                outputVolumeSettable: volume.settable
            )
        }
        let snapshot = HostAudioSnapshot(
            devices: devices,
            defaultInputUID: try defaultDeviceUID(selector: kAudioHardwarePropertyDefaultInputDevice),
            defaultOutputUID: try defaultDeviceUID(selector: kAudioHardwarePropertyDefaultOutputDevice)
        )
        let data = try JSONEncoder().encode(snapshot)
        return String(decoding: data, as: UTF8.self)
    }

    static func setDefault(kind rawKind: String, uid: String) throws -> Bool {
        guard let kind = RouteKind(rawValue: rawKind) else {
            throw Error.invalidRouteKind(rawKind)
        }
        let devices = try allDeviceIDs()
        guard let deviceID = try devices.first(where: {
            try stringProperty($0, selector: kAudioDevicePropertyDeviceUID) == uid
        }) else {
            throw Error.deviceNotFound(uid)
        }
        let scope = kind == .input ? kAudioDevicePropertyScopeInput : kAudioDevicePropertyScopeOutput
        guard try channelCount(deviceID, scope: scope) > 0 else {
            let name = try stringProperty(deviceID, selector: kAudioObjectPropertyName)
            throw Error.unsupportedRoute(name, kind)
        }

        if kind == .input {
            try setSystemDevice(deviceID, selector: kAudioHardwarePropertyDefaultInputDevice)
        } else {
            try setSystemDevice(deviceID, selector: kAudioHardwarePropertyDefaultOutputDevice)
            try? setSystemDevice(deviceID, selector: kAudioHardwarePropertyDefaultSystemOutputDevice)
        }
        return true
    }

    /// Keep already-open simulator/emulator audio streams audible on the newly
    /// selected Mac output. Changing CoreAudio's default device alone only
    /// affects streams opened after that change; running simulators keep their
    /// original device open.
    static func routeOutput(to uid: String) throws -> Bool {
        guard #available(macOS 14.2, *) else {
            throw Error.outputRoutingRequiresMacOS14_2
        }

        outputRouteLock.lock()
        defer { outputRouteLock.unlock() }

        let targetID = try outputDeviceID(uid: uid)
        let sourceUID: String?
        if let activeSourceUID = outputRoute?.sourceUID {
            sourceUID = activeSourceUID
        } else {
            sourceUID = try defaultDeviceUID(
                selector: kAudioHardwarePropertyDefaultOutputDevice
            )
        }
        guard let sourceUID else { throw Error.noDefaultOutput }

        if outputRoute?.targetUID == uid {
            try setOutputDefaults(targetID)
            return true
        }

        if sourceUID == uid {
            try setOutputDefaults(targetID)
            outputRoute = nil
            return true
        }

        let previousTargetUID = outputRoute?.targetUID
        outputRoute = nil
        do {
            let replacement = try HostAudioOutputRoute(sourceUID: sourceUID, targetUID: uid)
            try setOutputDefaults(targetID)
            outputRoute = replacement
        } catch {
            if let previousTargetUID, previousTargetUID != sourceUID {
                outputRoute = try? HostAudioOutputRoute(
                    sourceUID: sourceUID,
                    targetUID: previousTargetUID
                )
            }
            throw error
        }
        return true
    }

    static func setOutputVolume(uid: String, volume: Double) throws -> Bool {
        guard volume.isFinite, (0 ... 1).contains(volume) else {
            throw Error.coreAudio(kAudio_ParamError, "Setting output volume")
        }
        let deviceID = try outputDeviceID(uid: uid)
        let addresses = outputVolumeAddresses(deviceID)
        let settable = addresses.filter { address in
            var mutableAddress = address
            var result = DarwinBoolean(false)
            return AudioObjectIsPropertySettable(deviceID, &mutableAddress, &result) == noErr
                && result.boolValue
        }
        guard !settable.isEmpty else {
            let name = try stringProperty(deviceID, selector: kAudioObjectPropertyName)
            throw Error.unsupportedRoute("\(name) volume", .output)
        }

        var scalar = Float32(volume)
        // A writable main element controls the whole device. Otherwise update
        // every writable channel so stereo devices stay balanced.
        if let main = settable.first(where: { $0.mElement == kAudioObjectPropertyElementMain }) {
            var address = main
            try check(
                AudioObjectSetPropertyData(
                    deviceID,
                    &address,
                    0,
                    nil,
                    UInt32(MemoryLayout<Float32>.size),
                    &scalar
                ),
                "Setting output volume"
            )
        } else {
            for candidate in settable {
                var address = candidate
                try check(
                    AudioObjectSetPropertyData(
                        deviceID,
                        &address,
                        0,
                        nil,
                        UInt32(MemoryLayout<Float32>.size),
                        &scalar
                    ),
                    "Setting output channel volume"
                )
            }
        }
        return true
    }

    private static func outputDeviceID(uid: String) throws -> AudioDeviceID {
        let devices = try allDeviceIDs()
        guard let deviceID = try devices.first(where: {
            try stringProperty($0, selector: kAudioDevicePropertyDeviceUID) == uid
        }) else {
            throw Error.deviceNotFound(uid)
        }
        guard try channelCount(deviceID, scope: kAudioDevicePropertyScopeOutput) > 0 else {
            let name = try stringProperty(deviceID, selector: kAudioObjectPropertyName)
            throw Error.unsupportedRoute(name, .output)
        }
        return deviceID
    }

    private static func outputVolumeInfo(
        _ deviceID: AudioDeviceID
    ) -> (value: Float32?, settable: Bool) {
        let addresses = outputVolumeAddresses(deviceID)
        var channelValues: [Float32] = []
        let canSet = addresses.contains { candidate in
            var address = candidate
            var settable = DarwinBoolean(false)
            return AudioObjectIsPropertySettable(deviceID, &address, &settable) == noErr
                && settable.boolValue
        }

        for candidate in addresses {
            var address = candidate
            var value = Float32.zero
            var size = UInt32(MemoryLayout<Float32>.size)
            guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &value) == noErr else {
                continue
            }
            if address.mElement == kAudioObjectPropertyElementMain {
                return (value, canSet)
            }
            channelValues.append(value)
        }

        guard !channelValues.isEmpty else { return (nil, canSet) }
        return (channelValues.reduce(0, +) / Float32(channelValues.count), canSet)
    }

    private static func outputVolumeAddresses(
        _ deviceID: AudioDeviceID
    ) -> [AudioObjectPropertyAddress] {
        let channelTotal = (try? channelCount(
            deviceID,
            scope: kAudioDevicePropertyScopeOutput
        )) ?? 0
        let elements = [kAudioObjectPropertyElementMain]
            + (channelTotal > 0 ? (1 ... channelTotal).map(AudioObjectPropertyElement.init) : [])
        return elements.compactMap { element in
            var address = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyVolumeScalar,
                mScope: kAudioDevicePropertyScopeOutput,
                mElement: element
            )
            return AudioObjectHasProperty(deviceID, &address) ? address : nil
        }
    }

    private static func setOutputDefaults(_ deviceID: AudioDeviceID) throws {
        try setSystemDevice(deviceID, selector: kAudioHardwarePropertyDefaultOutputDevice)
        try? setSystemDevice(deviceID, selector: kAudioHardwarePropertyDefaultSystemOutputDevice)
    }

    private static func allDeviceIDs() throws -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        try check(
            AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size),
            "Reading audio device list size"
        )
        var devices = [AudioDeviceID](
            repeating: kAudioObjectUnknown,
            count: Int(size) / MemoryLayout<AudioDeviceID>.size
        )
        try check(
            AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices),
            "Reading audio device list"
        )
        return devices
    }

    private static func stringProperty(
        _ objectID: AudioObjectID,
        selector: AudioObjectPropertySelector
    ) throws -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: CFString = "" as CFString
        var size = UInt32(MemoryLayout<CFString>.size)
        try check(
            AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &value),
            "Reading audio device property"
        )
        return value as String
    }

    private static func channelCount(
        _ deviceID: AudioDeviceID,
        scope: AudioObjectPropertyScope
    ) throws -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        try check(
            AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size),
            "Reading audio stream configuration size"
        )
        guard size > 0 else { return 0 }
        let storage = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { storage.deallocate() }
        try check(
            AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, storage),
            "Reading audio stream configuration"
        )
        let list = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
        return UnsafeMutableAudioBufferListPointer(list).reduce(0) {
            $0 + Int($1.mNumberChannels)
        }
    }

    private static func defaultDeviceUID(selector: AudioObjectPropertySelector) throws -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = kAudioObjectUnknown
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        try check(
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                &size,
                &deviceID
            ),
            "Reading default audio device"
        )
        guard deviceID != kAudioObjectUnknown else { return nil }
        return try stringProperty(deviceID, selector: kAudioDevicePropertyDeviceUID)
    }

    private static func setSystemDevice(
        _ deviceID: AudioDeviceID,
        selector: AudioObjectPropertySelector
    ) throws {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var mutableID = deviceID
        try check(
            AudioObjectSetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                UInt32(MemoryLayout<AudioDeviceID>.size),
                &mutableID
            ),
            "Changing default audio device"
        )
    }

    private static func check(_ status: OSStatus, _ operation: String) throws {
        guard status == noErr else { throw Error.coreAudio(status, operation) }
    }
}

/// A private CoreAudio tap plus one physical output, joined into a private
/// aggregate device. Its realtime IO callback directly copies the current tap
/// block to the selected output. There is no unbounded queue and nothing is
/// exposed as a persistent system audio device.
@available(macOS 14.2, *)
private final class HostAudioOutputRoute {
    let sourceUID: String
    let targetUID: String

    private var tapID = kAudioObjectUnknown
    private var aggregateID = kAudioObjectUnknown
    private var ioProcID: AudioDeviceIOProcID?

    init(sourceUID: String, targetUID: String) throws {
        self.sourceUID = sourceUID
        self.targetUID = targetUID

        var initialized = false
        defer {
            if !initialized { stop() }
        }

        let description = CATapDescription(
            excludingProcesses: [],
            deviceUID: sourceUID,
            stream: 0
        )
        description.name = "Agentsims output route"
        description.isPrivate = true
        description.muteBehavior = .mutedWhenTapped

        try Self.check(
            AudioHardwareCreateProcessTap(description, &tapID),
            "Creating live audio tap"
        )

        let instance = UUID().uuidString
        let properties: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Agentsims Output Route",
            kAudioAggregateDeviceUIDKey: "dev.agentsims.audio-route.\(instance)",
            kAudioAggregateDeviceSubDeviceListKey: [[
                kAudioSubDeviceUIDKey: targetUID,
                kAudioSubDeviceDriftCompensationKey: false,
            ]],
            kAudioAggregateDeviceMainSubDeviceKey: targetUID,
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapUIDKey: description.uuid.uuidString,
                kAudioSubTapDriftCompensationKey: true,
            ]],
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
        ]
        try Self.check(
            AudioHardwareCreateAggregateDevice(properties as CFDictionary, &aggregateID),
            "Creating live audio route"
        )

        try Self.check(
            AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, nil) {
                _, inputData, _, outputData, _ in
                Self.copyAudio(inputData: inputData, outputData: outputData)
            },
            "Creating live audio callback"
        )
        try Self.check(AudioDeviceStart(aggregateID, ioProcID), "Starting live audio route")
        initialized = true
    }

    deinit {
        stop()
    }

    private func stop() {
        if aggregateID != kAudioObjectUnknown, let ioProcID {
            AudioDeviceStop(aggregateID, ioProcID)
            AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
            self.ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
        }
    }

    private static func copyAudio(
        inputData: UnsafePointer<AudioBufferList>,
        outputData: UnsafeMutablePointer<AudioBufferList>
    ) {
        let inputs = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: inputData)
        )
        let outputs = UnsafeMutableAudioBufferListPointer(outputData)

        for (index, output) in outputs.enumerated() {
            guard let outputBytes = output.mData else { continue }
            guard !inputs.isEmpty else {
                memset(outputBytes, 0, Int(output.mDataByteSize))
                continue
            }
            let input = inputs[min(index, inputs.count - 1)]
            guard let inputBytes = input.mData else {
                memset(outputBytes, 0, Int(output.mDataByteSize))
                continue
            }
            let copied = min(Int(input.mDataByteSize), Int(output.mDataByteSize))
            memcpy(outputBytes, inputBytes, copied)
            if copied < Int(output.mDataByteSize) {
                memset(outputBytes.advanced(by: copied), 0, Int(output.mDataByteSize) - copied)
            }
        }
    }

    private static func check(_ status: OSStatus, _ operation: String) throws {
        guard status == noErr else { throw HostAudio.Error.coreAudio(status, operation) }
    }
}
