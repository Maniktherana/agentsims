import CoreAudio
import Foundation

struct HostAudioSnapshot: Codable {
    struct Device: Codable {
        let uid: String
        let name: String
        let inputChannels: Int
        let outputChannels: Int
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
            }
        }
    }

    static func snapshotJSON() throws -> String {
        let devices = try allDeviceIDs().compactMap { id -> HostAudioSnapshot.Device? in
            let uid = try stringProperty(id, selector: kAudioDevicePropertyDeviceUID)
            guard !uid.isEmpty else { return nil }
            let name = try stringProperty(id, selector: kAudioObjectPropertyName)
            return HostAudioSnapshot.Device(
                uid: uid,
                name: name.isEmpty ? uid : name,
                inputChannels: try channelCount(id, scope: kAudioDevicePropertyScopeInput),
                outputChannels: try channelCount(id, scope: kAudioDevicePropertyScopeOutput)
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
