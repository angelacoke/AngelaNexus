//go:build android && cgo

package main

/*
#include <stdlib.h>
*/
import "C"

import (
    "os"
    "net/netip"
    "runtime"
    "strings"
    "sync"
    "syscall"
    "unsafe"

    "github.com/metacubex/mihomo/config"
    "github.com/metacubex/mihomo/constant"
    LC "github.com/metacubex/mihomo/listener/config"
    "github.com/metacubex/mihomo/listener/sing_tun"
    "github.com/metacubex/mihomo/hub/executor"
    "github.com/metacubex/mihomo/tunnel"
)

var (
    androidTunMu sync.Mutex
    androidTun *sing_tun.Listener
)

func cString(s *C.char) string {
    if s == nil { return "" }
    return C.GoString(s)
}

func resultString(err error) *C.char {
    if err == nil { return C.CString("") }
    return C.CString(err.Error())
}

func tunStackValue(value string) constant.TUNStack {
    stack, ok := constant.StackTypeMapping[strings.ToLower(strings.TrimSpace(value))]
    if !ok { return constant.TunSystem }
    return stack
}

func parsePrefix(value string) (netip.Prefix, bool) {
    prefix, err := netip.ParsePrefix(value)
    return prefix, err == nil
}

//export angelaInit
func angelaInit(homeDir *C.char) *C.char {
    dir := strings.TrimSpace(cString(homeDir))
    if dir == "" { return C.CString("homeDir is required") }
    if err := os.MkdirAll(dir, 0700); err != nil { return resultString(err) }
    constant.SetHomeDir(dir)
    return C.CString("")
}

//export angelaApplyConfig
func angelaApplyConfig(configJSON *C.char) *C.char {
    data := []byte(cString(configJSON))
    if len(data) == 0 { return C.CString("config is empty") }
    cfg, err := config.Parse(data)
    if err != nil { return resultString(err) }
    executor.ApplyConfig(cfg, true)
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
    if fd < 0 { return 0 }

    options := LC.Tun{
        Enable: true,
        Stack: tunStackValue(cString(stack)),
        Device: "AngelaNexus",
        DNSHijack: nil,
        AutoRoute: false,
        AutoDetectInterface: false,
        MTU: 1400,
        FileDescriptor: int(fd),
    }

    for _, value := range strings.Split(cString(address), ",") {
        value = strings.TrimSpace(value)
        if value != "" {
            prefix, ok := parsePrefix(value)
            if !ok {
                _ = syscall.Close(int(fd))
                return 0
            }
            if prefix.Addr().Is4() {
                options.Inet4Address = append(options.Inet4Address, prefix)
            } else {
                options.Inet6Address = append(options.Inet6Address, prefix)
            }
        }
    }

    for _, value := range strings.Split(cString(dns), ",") {
        value = strings.TrimSpace(value)
        if value != "" { options.DNSHijack = append(options.DNSHijack, value+":53") }
    }

    listener, err := sing_tun.New(options, tunnel.Tunnel)
    if err != nil { return 0 }
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
func getTraffic() *C.char {
    return C.CString("{}")
}

//export getTotalTraffic
func getTotalTraffic() *C.char {
    return C.CString("{}")
}

//export freeCString
func freeCString(value *C.char) {
    if value != nil { C.free(unsafe.Pointer(value)) }
}

