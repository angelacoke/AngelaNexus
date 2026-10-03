#ifndef ANGELANEXUS_DNS_PROBE_H
#define ANGELANEXUS_DNS_PROBE_H

enum angelanexus_dns_probe_state {
    ANGELANEXUS_DNS_PROBE_FAILED = -1,
    ANGELANEXUS_DNS_PROBE_NO_TRAFFIC = 0,
    ANGELANEXUS_DNS_PROBE_VERIFIED = 1
};

/*
 * Read-only packet-path observation.
 *
 * The observer listens on AF_PACKET for a bounded interval and verifies that
 * a DNS-over-UDP packet (source or destination port 53) was observed on a
 * Linux interface. It does not generate traffic, alter routing/firewall
 * state, or claim that DNS-over-TLS/QUIC traffic was observed.
 *
 * A return value of VERIFIED proves observation at the capture point only;
 * callers must not treat it as proof of leak-free DNS policy by itself.
 */
int angelanexus_observe_dns_udp_traffic(unsigned int timeout_ms,
                                        unsigned int *packet_count);

#endif
