import NetworkExtension

/// Native Apple Network Extension boundary for packet tunneling.
/// Kernel selection, routing policy and security policy remain outside this class.
final class AngelaNexusPacketTunnelProvider: NEPacketTunnelProvider {
    override func startTunnel(
        options: [String : NSObject]?,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard let remoteAddress = options?["remoteAddress"] as? NSString else {
            completionHandler(NSError(
                domain: "AngelaNexus",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "remoteAddress is required"]
            ))
            return
        }

        let settings = NEPacketTunnelNetworkSettings(
            tunnelRemoteAddress: remoteAddress as String
        )

        // Concrete IP/DNS/route policy is supplied by the application.
        // Do not install a default route without an explicit user policy.
        setTunnelNetworkSettings(settings) { error in
            completionHandler(error)
        }
    }

    override func stopTunnel(
        with reason: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        completionHandler()
    }
}
