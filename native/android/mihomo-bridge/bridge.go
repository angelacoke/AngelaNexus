//go:build android && cgo

package main

/*
#include <stdlib.h>
*/
import "C"

import (
    "encoding/json"
    "fmt"
    "os"
    "net/netip"
    "runtime"
    "strings"
    "sync"
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
func startTUN(fd C.int, stack, address, dns *C.char) C.bool {
    androidTunMu.Lock()
    defer androidTunMu.Unlock()

    if androidTun != nil {
        _ = androidTun.Close()
        androidTun = nil
    }
    if fd < 0 { return false }

    options := LC.Tun{
        Enable: true,
        Stack: strings.TrimSpace(cString(stack)),
        Device: "AngelaNexus",
        DNSHijack: nil,
        AutoRoute: false,
        AutoDetectInterface: false,
        MTU: 1400,
        FileDescriptor: int(fd),
    }

    for _, value := range strings.Split(cString(address), ",") {
        value = strings.TrimSpace(value)
        if value != "" { options.Inet4Address = append(options.Inet4Address, mustPrefix(value)) }
    }

    for _, value := range strings.Split(cString(dns), ",") {
        value = strings.TrimSpace(value)
        if value != "" { options.DNSHijack = append(options.DNSHijack, value+":53") }
    }

    listener, err := sing_tun.New(options, tunnel.Tunnel)
    if err != nil { return false }
    androidTun = listener
    return true
}

func mustPrefix(value string) netip.Prefix {
    prefix, err := netip.ParsePrefix(value)
    if err != nil { panic(fmt.Sprintf("invalid TUN address: %s", value)) }
    return prefix
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
func suspend(suspended C.bool) {
    if bool(suspended) {
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

var _ = json.Valid
