#include "angelanexus_dns_probe.h"

#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    unsigned int timeout_ms = 1000u;
    if (argc == 2) {
        char *end = NULL;
        unsigned long parsed = strtoul(argv[1], &end, 10);
        if (!end || *end != '\\0' || parsed == 0 || parsed > 10000ul) {
            fprintf(stderr, "invalid-timeout\\n");
            return 2;
        }
        timeout_ms = (unsigned int)parsed;
    } else if (argc > 2) {
        fprintf(stderr, "usage: %s [timeout-ms]\\n", argv[0]);
        return 2;
    }

    unsigned int packet_count = 0;
    int state = angelanexus_observe_dns_udp_traffic(timeout_ms, &packet_count);
    printf("dns-udp-state=%d dns-udp-packets=%u\\n", state, packet_count);
    return state < 0 ? 1 : 0;
}
