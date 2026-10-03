#include <errno.h>
#include <fcntl.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <linux/netfilter.h>
#include <linux/netfilter/nfnetlink.h>
#include <linux/netfilter/nf_tables.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <string.h>

/*
 * Read-only Linux networking capability probes.
 *
 * These functions answer whether a kernel interface/subsystem can be queried.
 * They deliberately do not claim that routing, DNS, firewall policy, or a
 * configured tunnel is ready. Higher platform layers must provide those
 * independent readiness facts.
 */

enum angelanexus_network_probe_state {
    ANGELANEXUS_NETWORK_PROBE_FAILED = -1,
    ANGELANEXUS_NETWORK_PROBE_UNSUPPORTED = 0,
    ANGELANEXUS_NETWORK_PROBE_SUPPORTED = 1
};

static int probe_datagram_family(int family) {
    int fd = socket(family, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (fd < 0) {
        return ANGELANEXUS_NETWORK_PROBE_UNSUPPORTED;
    }
    close(fd);
    return ANGELANEXUS_NETWORK_PROBE_SUPPORTED;
}

int angelanexus_probe_ipv4(void) {
    return probe_datagram_family(AF_INET);
}

int angelanexus_probe_ipv6(void) {
    return probe_datagram_family(AF_INET6);
}

static int probe_netlink_dump(int protocol, int request_type, int family) {
    int fd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, protocol);
    if (fd < 0) {
        return ANGELANEXUS_NETWORK_PROBE_UNSUPPORTED;
    }

    struct sockaddr_nl local;
    memset(&local, 0, sizeof(local));
    local.nl_family = AF_NETLINK;
    if (bind(fd, (struct sockaddr *)&local, sizeof(local)) < 0) {
        close(fd);
        return ANGELANEXUS_NETWORK_PROBE_FAILED;
    }

    struct {
        struct nlmsghdr header;
        struct rtgenmsg payload;
    } request;
    memset(&request, 0, sizeof(request));
    request.header.nlmsg_len = NLMSG_LENGTH(sizeof(struct rtgenmsg));
    request.header.nlmsg_type = request_type;
    request.header.nlmsg_flags = NLM_F_REQUEST | NLM_F_DUMP;
    request.header.nlmsg_seq = 1;
    request.payload.rtgen_family = (unsigned char)family;

    struct sockaddr_nl kernel;
    memset(&kernel, 0, sizeof(kernel));
    kernel.nl_family = AF_NETLINK;

    ssize_t sent = sendto(fd, &request, request.header.nlmsg_len, 0,
                          (struct sockaddr *)&kernel, sizeof(kernel));
    if (sent < 0) {
        close(fd);
        return ANGELANEXUS_NETWORK_PROBE_FAILED;
    }

    char buffer[8192];
    for (;;) {
        ssize_t received = recv(fd, buffer, sizeof(buffer), 0);
        if (received < 0) {
            int saved_errno = errno;
            close(fd);
            errno = saved_errno;
            return ANGELANEXUS_NETWORK_PROBE_FAILED;
        }

        if (received == 0) {
            close(fd);
            return ANGELANEXUS_NETWORK_PROBE_FAILED;
        }

        for (struct nlmsghdr *message = (struct nlmsghdr *)buffer;
             NLMSG_OK(message, (unsigned int)received);
             message = NLMSG_NEXT(message, received)) {
            if (message->nlmsg_type == NLMSG_DONE) {
                close(fd);
                return ANGELANEXUS_NETWORK_PROBE_SUPPORTED;
            }
            if (message->nlmsg_type == NLMSG_ERROR) {
                struct nlmsgerr *error = (struct nlmsgerr *)NLMSG_DATA(message);
                int saved_errno = error->error < 0 ? -error->error : EIO;
                close(fd);
                if (error->error == 0) {
                    return ANGELANEXUS_NETWORK_PROBE_SUPPORTED;
                }
                errno = saved_errno;
                return ANGELANEXUS_NETWORK_PROBE_UNSUPPORTED;
            }
        }
    }
}

int angelanexus_probe_policy_routing(void) {
    return probe_netlink_dump(NETLINK_ROUTE, RTM_GETRULE, AF_UNSPEC);
}

int angelanexus_probe_nftables(void) {
    int fd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_NETFILTER);
    if (fd < 0) {
        return ANGELANEXUS_NETWORK_PROBE_UNSUPPORTED;
    }

    struct sockaddr_nl local;
    memset(&local, 0, sizeof(local));
    local.nl_family = AF_NETLINK;
    if (bind(fd, (struct sockaddr *)&local, sizeof(local)) < 0) {
        close(fd);
        return ANGELANEXUS_NETWORK_PROBE_FAILED;
    }

    struct {
        struct nlmsghdr header;
        struct nfgenmsg payload;
    } request;
    memset(&request, 0, sizeof(request));
    request.header.nlmsg_len = NLMSG_LENGTH(sizeof(struct nfgenmsg));
    request.header.nlmsg_type = (NFNL_SUBSYS_NFTABLES << 8) | NFT_MSG_GETGEN;
    request.header.nlmsg_flags = NLM_F_REQUEST;
    request.header.nlmsg_seq = 1;
    request.payload.nfgen_family = NFPROTO_UNSPEC;
    request.payload.version = NFNETLINK_V0;
    request.payload.res_id = 0;

    struct sockaddr_nl kernel;
    memset(&kernel, 0, sizeof(kernel));
    kernel.nl_family = AF_NETLINK;

    ssize_t sent = sendto(fd, &request, request.header.nlmsg_len, 0,
                          (struct sockaddr *)&kernel, sizeof(kernel));
    if (sent < 0) {
        close(fd);
        return ANGELANEXUS_NETWORK_PROBE_FAILED;
    }

    char buffer[4096];
    ssize_t received = recv(fd, buffer, sizeof(buffer), 0);
    if (received < 0) {
        int saved_errno = errno;
        close(fd);
        errno = saved_errno;
        return ANGELANEXUS_NETWORK_PROBE_FAILED;
    }

    for (struct nlmsghdr *message = (struct nlmsghdr *)buffer;
         NLMSG_OK(message, (unsigned int)received);
         message = NLMSG_NEXT(message, received)) {
        if (message->nlmsg_type == NLMSG_ERROR) {
            struct nlmsgerr *error = (struct nlmsgerr *)NLMSG_DATA(message);
            if (error->error == 0) {
                close(fd);
                return ANGELANEXUS_NETWORK_PROBE_SUPPORTED;
            }
            int saved_errno = error->error < 0 ? -error->error : EIO;
            close(fd);
            errno = saved_errno;
            return ANGELANEXUS_NETWORK_PROBE_UNSUPPORTED;
        }
    }

    close(fd);
    return ANGELANEXUS_NETWORK_PROBE_FAILED;
}
