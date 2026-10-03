#include <errno.h>
#include <fcntl.h>
#include <linux/if_tun.h>
#include <net/if.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <string.h>

/*
 * Linux TUN boundary.
 * This layer only creates and observes the TUN interface.
 * Routing, DNS, firewall and fail-closed policy are intentionally not changed here.
 */

enum angelanexus_tun_state {
    ANGELANEXUS_TUN_STATE_ERROR = -1,
    ANGELANEXUS_TUN_STATE_CREATED = 0,
    ANGELANEXUS_TUN_STATE_UP = 1,
    ANGELANEXUS_TUN_STATE_RUNNING = 2
};

int angelanexus_open_tun(void) {
    int fd = open("/dev/net/tun", O_RDWR | O_CLOEXEC);
    if (fd < 0) return -1;

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    ifr.ifr_flags = IFF_TUN | IFF_NO_PI;

    if (ioctl(fd, TUNSETIFF, &ifr) < 0) {
        close(fd);
        return -1;
    }

    return fd;
}

int angelanexus_probe_tun_state(int fd) {
    if (fd < 0) {
        errno = EBADF;
        return ANGELANEXUS_TUN_STATE_ERROR;
    }

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));

    /*
     * TUNSETIFF returns the kernel-assigned interface name through ifr_name.
     * Querying flags with SIOCGIFFLAGS is deliberately separate from creation:
     * an open file descriptor alone is not proof that the interface is usable.
     */
    if (ioctl(fd, TUNGETIFF, &ifr) < 0) {
        return ANGELANEXUS_TUN_STATE_ERROR;
    }

    if (ioctl(fd, SIOCGIFFLAGS, &ifr) < 0) {
        return ANGELANEXUS_TUN_STATE_ERROR;
    }

    if ((ifr.ifr_flags & IFF_UP) == 0) {
        return ANGELANEXUS_TUN_STATE_CREATED;
    }

    if ((ifr.ifr_flags & IFF_RUNNING) == 0) {
        return ANGELANEXUS_TUN_STATE_UP;
    }

    return ANGELANEXUS_TUN_STATE_RUNNING;
}
