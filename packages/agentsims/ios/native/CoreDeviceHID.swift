import Foundation
import ObjectiveC
import XPC

/// Sends input through the simulator's CoreDevice HID service (dtuhidd).
///
/// On Xcode 27, a CoreDevice client such as Device Hub starts dtuhidd in the
/// simulator. The iOS 27 guest then disconnects its legacy SimulatorHID touch,
/// button, and keyboard services until the simulator reboots. SimulatorKit's
/// legacy HID client still reports success, but the guest drops the events.
/// dtuhidd accepts input before and after that change.
///
/// The message shapes follow dtuhidd's Indigo HID server as Siniulator uses it
/// (github.com/kmagiera/Siniulator, Sources/Siniulator/Input.swift, MIT).
final class CoreDeviceHID: @unchecked Sendable {
    static let feature = "com.apple.coredevice.feature.remote.hid.digitizer"

    private typealias LookupFunc = @convention(c) (
        AnyObject, Selector, NSString, AutoreleasingUnsafeMutablePointer<NSError?>
    ) -> mach_port_t
    private typealias EndpointFunc = @convention(c) (mach_port_t, UInt64, UInt64) -> xpc_object_t?
    private typealias EnableFunc = @convention(c) (xpc_connection_t) -> Void

    private let connection: xpc_connection_t
    private let lock = NSLock()
    private var closed = false
    /// Messages wait here until dtuhidd answers the activation barrier.
    /// dtuhidd drops events that arrive before that reply.
    private var pending: [xpc_object_t]? = []

    /// Returns nil when the runtime has no dtuhidd service, for example on
    /// Xcode 26 and older runtimes. Use the legacy client then.
    init?(device: NSObject) {
        let lookupSel = NSSelectorFromString("lookup:error:")
        let process = dlopen(nil, RTLD_NOW)
        guard device.responds(to: lookupSel),
              let createEndpoint = dlsym(process, "xpc_endpoint_create_mach_port_4sim"),
              let enableSimToHost = dlsym(process, "xpc_connection_enable_sim2host_4sim")
        else { return nil }
        let lookup = unsafeBitCast(device.method(for: lookupSel), to: LookupFunc.self)
        var error: NSError?
        let port = lookup(device, lookupSel, Self.feature as NSString, &error)
        guard port != 0,
              let endpoint = unsafeBitCast(createEndpoint, to: EndpointFunc.self)(port, 0, 0)
        else { return nil }

        connection = xpc_connection_create_from_endpoint(endpoint)
        unsafeBitCast(enableSimToHost, to: EnableFunc.self)(connection)
        let queue = DispatchQueue(label: "coredevice-hid", qos: .userInteractive)
        xpc_connection_set_target_queue(connection, queue)
        xpc_connection_set_event_handler(connection) { [weak self] event in
            guard xpc_get_type(event) == XPC_TYPE_ERROR else { return }
            self?.close()
        }
        xpc_connection_resume(connection)

        let activation = Self.message(
            "IndigoKeyboardButtonEvent",
            Self.dictionary(["usageCode": 0, "state": 2]),
            barrier: true
        )
        xpc_connection_send_message_with_reply(connection, activation, queue) { [weak self] reply in
            guard let self else { return }
            guard xpc_get_type(reply) != XPC_TYPE_ERROR else { return self.close() }
            self.lock.lock()
            let queued = self.pending ?? []
            self.pending = nil
            for message in queued { xpc_connection_send_message(self.connection, message) }
            self.lock.unlock()
        }
        // An unanswered barrier means that dtuhidd did not accept the connection.
        queue.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let waiting = self.pending != nil
            self.lock.unlock()
            if waiting { self.close() }
        }
    }

    deinit {
        xpc_connection_cancel(connection)
    }

    var isConnected: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !closed
    }

    private func close() {
        lock.lock()
        closed = true
        pending = nil
        lock.unlock()
    }

    /// Sends one digitizer contact. `x` and `y` are fractions of the main
    /// screen, origin top-left. `eventType` is 0 for down, 1 for move, and
    /// 2 for up. `edge` uses the same values as the legacy Indigo builder.
    func touch(eventType: UInt64, x: Double, y: Double, second: CGPoint? = nil, edge: UInt32) {
        func contact(_ x: Double, _ y: Double) -> xpc_object_t {
            let value = xpc_dictionary_create(nil, nil, 0)
            xpc_dictionary_set_double(value, "x", x)
            xpc_dictionary_set_double(value, "y", y)
            return value
        }
        // Target 0 is the main screen.
        let payload = Self.dictionary(["eventType": eventType, "edge": UInt64(edge), "target": 0])
        xpc_dictionary_set_value(payload, "pointOne", contact(x, y))
        if let second { xpc_dictionary_set_value(payload, "pointTwo", contact(second.x, second.y)) }
        send("IndigoDigitizerEvent", payload)
    }

    /// Presses or releases a keyboard key (HID usage page 0x07).
    func key(usage: UInt32, down: Bool) {
        send("IndigoKeyboardButtonEvent", Self.dictionary([
            "usageCode": UInt64(usage), "state": down ? 1 : 2,
        ]))
    }

    /// Presses or releases a hardware button by its HID usage page and usage.
    func button(page: UInt32, usage: UInt32, down: Bool) {
        send("IndigoButtonEvent", Self.dictionary([
            "usagePage": UInt64(page), "usageCode": UInt64(usage), "state": down ? 1 : 2,
        ]))
    }

    private func send(_ type: String, _ payload: xpc_object_t) {
        let message = Self.message(type, payload, barrier: false)
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        if pending != nil {
            pending?.append(message)
        } else {
            xpc_connection_send_message(connection, message)
        }
    }

    private static func message(_ type: String, _ payload: xpc_object_t, barrier: Bool) -> xpc_object_t {
        let message = xpc_dictionary_create(nil, nil, 0)
        xpc_dictionary_set_string(message, "messageType", type)
        xpc_dictionary_set_bool(message, "isBarrier", barrier)
        xpc_dictionary_set_string(message, "featureIdentifier", feature)
        xpc_dictionary_set_value(message, "payload", payload)
        return message
    }

    private static func dictionary(_ values: [String: UInt64]) -> xpc_object_t {
        let object = xpc_dictionary_create(nil, nil, 0)
        for (key, value) in values { xpc_dictionary_set_uint64(object, key, value) }
        return object
    }
}
