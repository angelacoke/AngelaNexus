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

/*
 * Read-only current-state inspectors.
 *
 * The returned state describes whether the corresponding kernel interface
 * could be inspected. A successful state does not imply that AngelaNexus
 * policy is present, correct, secure, or ready for traffic.
 */
int angelanexus_inspect_policy_routing(unsigned int *rule_count);
int angelanexus_inspect_nftables(unsigned int *table_count,
                                 unsigned int *chain_count);

#endif
