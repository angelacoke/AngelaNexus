#include "angelanexus_dns_probe.h"

#include <arpa/inet.h>
#include <errno.h>
#include <linux/if_ether.h>
#include <linux/if_packet.h>
#include <linux/ip.h>
#include <linux/ipv6.h>
#include <linux/udp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#include <string.h>
#include <stdint.h>

static int is_dns_udp_packet(const unsigned char *buffer, size_t length) {
    if (!buffer || length < ETH_HLEN) return 0;

    const struct ethhdr *ethernet = (const struct ethhdr *)buffer;
    uint16_t protocol = ntohs(ethernet->h_proto);
    const unsigned char *payload = buffer + ETH_HLEN;
    size_t payload_length = length - ETH_HLEN;

    if (protocol == ETH_P_IP) {
        if (payload_length < sizeof(struct iphdr)) return 0;
        const struct iphdr *ip = (const struct iphdr *)payload;
        size_t header_length = (size_t)ip->ihl * 4u;
        if (ip->version != 4 || header_length < sizeof(struct iphdr) ||
            payload_length < header_length + sizeof(struct udphdr) ||
            ip->protocol != IPPROTO_UDP) return 0;
        const struct udphdr *udp = (const struct udphdr *)(payload + header_length);
        return ntohs(udp->source) == 53 || ntohs(udp->dest) == 53;
    }

    if (protocol == ETH_P_IPV6) {
        if (payload_length < sizeof(struct ipv6hdr)) return 0;
        const struct ipv6hdr *ip6 = (const struct ipv6hdr *)payload;
        if ((ip6->version != 6) ||
            ip6->nexthdr != IPPROTO_UDP ||
            payload_length < sizeof(struct ipv6hdr) + sizeof(struct udphdr)) return 0;
        const struct udphdr *udp = (const struct udphdr *)(payload + sizeof(struct ipv6hdr));
        return ntohs(udp->source) == 53 || ntohs(udp->dest) == 53;
    }

    return 0;
}

int angelanexus_observe_dns_udp_traffic(unsigned int timeout_ms,
                                        unsigned int *packet_count) {
    if (!packet_count || timeout_ms == 0 || timeout_ms > 10000u) {
        return ANGELANEXUS_DNS_PROBE_FAILED;
    }
    *packet_count = 0;

    int fd = socket(AF_PACKET, SOCK_RAW | SOCK_CLOEXEC, htons(ETH_P_ALL));
    if (fd < 0) {
        return (errno == EPERM || errno == EACCES) ? ANGELANEXUS_DNS_PROBE_FAILED
                                                    : ANGELANEXUS_DNS_PROBE_FAILED;
    }

    struct pollfd descriptor = {
        .fd = fd,
        .events = POLLIN,
        .revents = 0
    };

    unsigned char buffer[65536];
    int poll_result;
    do {
        poll_result = poll(&descriptor, 1, (int)timeout_ms);
    } while (poll_result < 0 && errno == EINTR);

    if (poll_result < 0) {
        close(fd);
        return ANGELANEXUS_DNS_PROBE_FAILED;
    }
    if (poll_result == 0) {
        close(fd);
        return ANGELANEXUS_DNS_PROBE_NO_TRAFFIC;
    }

    for (;;) {
        ssize_t received = recv(fd, buffer, sizeof(buffer), MSG_DONTWAIT);
        if (received < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            close(fd);
            return ANGELANEXUS_DNS_PROBE_FAILED;
        }
        if (received == 0) break;
        if (is_dns_udp_packet(buffer, (size_t)received)) {
            if (*packet_count < UINT32_MAX) (*packet_count)++;
        }
    }

    close(fd);
    return *packet_count > 0 ? ANGELANEXUS_DNS_PROBE_VERIFIED
                             : ANGELANEXUS_DNS_PROBE_NO_TRAFFIC;
}
