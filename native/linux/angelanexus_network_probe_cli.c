#include "angelanexus_network_probe.h"
#include <stdio.h>

static int valid_result(int result) {
    return result >= ANGELANEXUS_NETWORK_PROBE_FAILED &&
           result <= ANGELANEXUS_NETWORK_PROBE_SUPPORTED;
}

int main(void) {
    const int ipv4 = angelanexus_probe_ipv4();
    const int ipv6 = angelanexus_probe_ipv6();
    const int policy_route = angelanexus_probe_policy_routing();
    const int nftables = angelanexus_probe_nftables();
    unsigned int policy_rules = 0;
    unsigned int nft_tables = 0;
    unsigned int nft_chains = 0;
    const int policy_state = angelanexus_inspect_policy_routing(&policy_rules);
    const int nft_state = angelanexus_inspect_nftables(&nft_tables, &nft_chains);

    if (!valid_result(ipv4) || !valid_result(ipv6) ||
        !valid_result(policy_route) || !valid_result(nftables) ||
        !valid_result(policy_state) || !valid_result(nft_state)) {
        return 2;
    }

    if (printf("ipv4=%d ipv6=%d policy-route=%d nftables=%d policy-rules=%u nft-tables=%u nft-chains=%u\n",
               ipv4, ipv6, policy_route, nftables,
               policy_rules, nft_tables, nft_chains) < 0) {
        return 3;
    }

    return 0;
}
