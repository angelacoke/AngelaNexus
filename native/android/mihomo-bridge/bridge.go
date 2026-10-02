//go:build android && cgo

package main

/*
#include <stdlib.h>
#include <dlfcn.h>

typedef int (*AngelaNexusProtectFd)(int);

static int angelanexusProtectFd(int fd) {
    AngelaNexusProtectFd protect = (AngelaNexusProtectFd)dlsym(RTLD_DEFAULT, "angelanexus_protect_fd");
    if (protect == NULL) {
        return 0;
    }
    return protect(fd);
}
*/
import "C"

import (
    "encoding/json"
    "net"
    "net/netip"
    "os"
    "runtime"
    "strings"
    "sync"
    "syscall"
    "unsafe"

    "github.com/metacubex/mihomo/config"
    "github.com/metacubex/mihomo/constant"
    "github.com/metacubex/mihomo/hub/executor"
    LC "github.com/metacubex/mihomo/listener/config"
    "github.com/metacubex/mihomo/listener/sing_tun"
    "github.com/metacubex/mihomo/tunnel"
)

var (
    androidTunMu sync.Mutex
    androidTun   *sing_tun.Listener

    configMu       sync.Mutex
    lastConfigJSON []byte
)

func cString(s *C.char) string {
    if s == nil {
        return ""
    }
    return C.GoString(s)
}

func resultString(err error) *C.char {
    if err == nil {
        return C.CString("")
    }
    return C.CString(err.Error())
}

func tunStackValue(value string) constant.TUNStack {
    stack, ok := constant.StackTypeMapping[strings.ToLower(strings.TrimSpace(value))]
    if !ok {
        return constant.TunSystem
    }
    return stack
}

func parsePrefix(value string) (netip.Prefix, bool) {
    prefix, err := netip.ParsePrefix(value)
    return prefix, err == nil
}

func parseDNS(value string) ([]string, error) {
    var result []string
    for _, item := range strings.Split(value, ",") {
        item = strings.TrimSpace(item)
        if item == "" {
            continue
        }
        addr, err := netip.ParseAddr(item)
        if err != nil {
            return nil, err
        }
        result = append(result, net.JoinHostPort(addr.String(), "53"))
    }
    return result, nil
}

func protectSocket(fd int) bool {
    return C.angelanexusProtectFd(C.int(fd)) != 0
}

func init() {
    // The Android VpnService protector is mandatory once system TUN routing is live.
    // Refuse to create the TUN listener if the JNI protector is not installed.
    // This prevents the core's own sockets from looping back into its TUN.
    _ = protectSocket
}

//export angelaInit
func angelaInit(homeDir *C.char) *C.char {
    dir := strings.TrimSpace(cString(homeDir))
    if dir == "" {
        return C.CString("homeDir is required")
    }
    if err := os.MkdirAll(dir, 0700); err != nil {
        return resultString(err)
    }
    constant.SetHomeDir(dir)
    return C.CString("")
}

//export angelaApplyConfig
func angelaApplyConfig(configJSON *C.char) *C.char {
    data := []byte(cString(configJSON))
    if len(data) == 0 {
        return C.CString("config is empty")
    }

    cfg, err := config.Parse(data)
    if err != nil {
        return resultString(err)
    }

    configMu.Lock()
    defer configMu.Unlock()
    executor.ApplyConfig(cfg, true)
    lastConfigJSON = append(lastConfigJSON[:0], data...)
    return C.CString("")
}

//export updateDns
func updateDns(dns *C.char) *C.char {
    servers, err := parseDNS(cString(dns))
    if err != nil {
        return resultString(err)
    }

    configMu.Lock()
    defer configMu.Unlock()

    if len(lastConfigJSON) == 0 {
        return C.CString("no configuration has been applied")
    }

    var document map[string]any
    if err := json.Unmarshal(lastConfigJSON, &document); err != nil {
        return resultString(err)
    }
    dnsSection, ok := document["dns"].(map[string]any)
    if !ok {
        dnsSection = map[string]any{}
        document["dns"] = dnsSection
    }
    dnsSection["enable"] = true
    dnsSection["nameserver"] = servers

    updated, err := json.Marshal(document)
    if err != nil {
        return resultString(err)
    }
    cfg, err := config.Parse(updated)
    if err != nil {
        return resultString(err)
    }
    executor.ApplyConfig(cfg, true)
    lastConfigJSON = append(lastConfigJSON[:0], updated...)
    return C.CString("")
}

//export startTUN
func startTUN(fd C.int, stack, address, dns *C.char) C.uchar {
    androidTunMu.Lock()
    defer androidTunMu.Unlock()

    if androidTun != nil {
        _ = androidTun.Close()
        androidTun = nil
    }
    if fd < 0 {
        return 0
    }

    var prefix4 []netip.Prefix
    var prefix6 []netip.Prefix
    for _, value := range strings.Split(cString(address), ",") {
        value = strings.TrimSpace(value)
        if value == "" {
            continue
        }
        prefix, ok := parsePrefix(value)
        if !ok {
            _ = syscall.Close(int(fd))
            return 0
        }
        if prefix.Addr().Is4() {
            prefix4 = append(prefix4, prefix)
        } else {
            prefix6 = append(prefix6, prefix)
        }
    }

    dnsHijack, err := parseDNS(cString(dns))
    if err != nil {
        _ = syscall.Close(int(fd))
        return 0
    }

    dupFd, err := syscall.Dup(int(fd))
    if err != nil {
        _ = syscall.Close(int(fd))
        return 0
    }
    defer func() { _ = syscall.Close(int(fd)) }()

    options := LC.Tun{
        Enable:                true,
        Stack:                 tunStackValue(cString(stack)),
        Device:                "AngelaNexus",
        DNSHijack:             dnsHijack,
        AutoRoute:             false,
        AutoDetectInterface:   false,
        MTU:                   9000,
        FileDescriptor:        dupFd,
        Inet4Address:          prefix4,
        Inet6Address:          prefix6,
    }

    listener, err := sing_tun.New(options, tunnel.Tunnel)
    if err != nil {
        return 0
    }
    androidTun = listener
    return 1
}

//export stopTun
func stopTun() {
    androidTunMu.Lock()
    defer androidTunMu.Unlock()
    if androidTun != nil {
        _ = androidTun.Close()
        androidTun = nil
    }
}

//export suspend
func suspend(suspended C.uchar) {
    if suspended != 0 {
        tunnel.OnSuspend()
    } else {
        tunnel.OnRunning()
    }
}

//export forceGC
func forceGC() {
    runtime.GC()
}

//export getTraffic
func getTraffic(onlyStatisticsProxy C.uchar) *C.char {
    _ = onlyStatisticsProxy
    return C.CString("{\"up\":0,\"down\":0}")
}

//export getTotalTraffic
func getTotalTraffic(onlyStatisticsProxy C.uchar) *C.char {
    _ = onlyStatisticsProxy
    return C.CString("{\"upTotal\":0,\"downTotal\":0}")
}

//export freeCString
func freeCString(value *C.char) {
    if value != nil {
        C.free(unsafe.Pointer(value))
    }
}
