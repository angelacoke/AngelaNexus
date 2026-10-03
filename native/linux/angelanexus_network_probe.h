#ifndef ANGELANEXUS_NETWORK_PROBE_H
#define ANGELANEXUS_NETWORK_PROBE_H

enum angelanexus_network_probe_state {
    ANGELANEXUS_NETWORK_PROBE_FAILED = -1,
    ANGELANEXUS_NETWORK_PROBE_UNSUPPORTED = 0,
    ANGELANEXUS_NETWORK_PROBE_SUPPORTED = 1
};

int angelanexus_probe_ipv4(void);
int angelanexus_probe_ipv6(void);
int angelanexus_probe_policy_routing(void);
int angelanexus_probe_nftables(void);
int angelanexus_probe_policy_routing_state(void);
int angelanexus_probe_nftables_state(void);

#endif
