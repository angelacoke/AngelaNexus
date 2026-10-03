#include "angelanexus_network_probe.h"
#include <stdio.h>
#include <sys/socket.h>
#include <string.h>

static int valid_result(int result) {
    return result >= ANGELANEXUS_NETWORK_PROBE_FAILED &&
           result <= ANGELANEXUS_NETWORK_PROBE_SUPPORTED;
}

int main(int argc, char **argv) {
    if (argc == 3 && (strcmp(argv[1], "--route4") == 0 || strcmp(argv[1], "--route6") == 0)) {
        const int family = strcmp(argv[1], "--route4") == 0 ? AF_INET : AF_INET6;
        unsigned char route_type = 0;
        int interface_index = 0;
        unsigned int table_id = 0;
        int target_match = 0;
        const int state = angelanexus_lookup_route(
            family, argv[2], &route_type, &interface_index, &table_id, &target_match);
        if (!valid_result(state)) return 2;
        if (printf("route-family=%s target=%s lookup-state=%d route-type=%u interface-index=%d table-id=%u target-match=%d\\n",
                   family == AF_INET ? "ipv4" : "ipv6", argv[2], state, route_type,
                   interface_index, table_id, target_match) < 0) return 3;
        return 0;
    }
    const int ipv4 = angelanexus_probe_ipv4();
    const int ipv6 = angelanexus_probe_ipv6();
    const int policy_route = angelanexus_probe_policy_routing();
    const int nftables = angelanexus_probe_nftables();
    unsigned int policy_rules = 0;
    unsigned int ipv4_routes = 0;
    unsigned int ipv6_routes = 0;
    unsigned int ipv4_default_routes = 0;
    unsigned int ipv6_default_routes = 0;
    unsigned int nft_tables = 0;
    unsigned int nft_chains = 0;
    const int policy_state = angelanexus_inspect_policy_routing(&policy_rules);
    const int ipv4_route_state = angelanexus_inspect_routes(AF_INET, &ipv4_routes, &ipv4_default_routes);
    const int ipv6_route_state = angelanexus_inspect_routes(AF_INET6, &ipv6_routes, &ipv6_default_routes);
    const int nft_state = angelanexus_inspect_nftables(&nft_tables, &nft_chains);

    if (!valid_result(ipv4) || !valid_result(ipv6) ||
        !valid_result(policy_route) || !valid_result(nftables) ||
        !valid_result(policy_state) || !valid_result(nft_state) ||
        !valid_result(ipv4_route_state) || !valid_result(ipv6_route_state)) {
        return 2;
    }

    if (printf("ipv4=%d ipv6=%d policy-route=%d nftables=%d policy-rules=%u ipv4-routes=%u ipv6-routes=%u ipv4-default-routes=%u ipv6-default-routes=%u ipv4-route-state=%d ipv6-route-state=%d nft-tables=%u nft-chains=%u\n",
               ipv4, ipv6, policy_route, nftables,
               policy_rules, ipv4_routes, ipv6_routes, ipv4_default_routes, ipv6_default_routes,
               ipv4_route_state, ipv6_route_state,
               nft_tables, nft_chains) < 0) {
        return 3;
    }

    return 0;
}
