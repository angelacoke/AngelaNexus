# AngelaNexus Architecture

## Layers
- UI: unified card-based console (planned)
- Adapter: Mihomo / sing-box / Xray, network monitor, format sniffer, chain compiler, self-healing
- Core: kernel-neutral orchestration, system security policy, GFW resilience, path trust and execution control

## Chain
Four explicit modes are modeled: node→node, node→subscription, subscription→node, subscription→subscription. Kernel-specific mechanisms are isolated in adapters.

## Security
Fail-closed Kill Switch, WebRTC UDP/3478 blocking, IPv6 leak protection and encrypted DNS policy are first-class controls.

GFW resilience is a system-level security capability rather than a kernel-specific rule set:
- bounded, time-decayed evidence for DNS injection, TCP reset, TLS/SNI failure, QUIC failure, active-probe suspicion, route changes, certificate/bootstrap anomalies and clock anomalies;
- independent-evidence corroboration before confirmed classification;
- explicit user choice for active probing;
- GFW evidence invalidates kernel-neutral path trust when revalidation is required;
- path revalidation is bound to the current network generation;
- execution contracts revalidate the configured system security floor before kernel startup;
- any failed security gate remains fail-closed.

The GFW layer does not claim censorship from a single network failure and does not hard-code a specific kernel, protocol, country, node role or bypass technique.

## Roadmap
1. Core decoupling and controller
2. Format sniffing and kernel integration
3. Chain compiler, network adaptation, China bypass
4. GFW resilience, resource optimization, security center, self-healing and LAN gateway
