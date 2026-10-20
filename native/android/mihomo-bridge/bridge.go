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
	"errors"
	"io"
	"net"
	"net/netip"
	"os"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"github.com/metacubex/mihomo/component/dialer"
	"github.com/metacubex/mihomo/config"
	"github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub/executor"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/listener/sing_tun"
	"github.com/metacubex/mihomo/tunnel"
	"github.com/metacubex/mihomo/tunnel/statistic"
)

var (
	androidTunMu   sync.Mutex
	androidRuntime androidTunLifecycle
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
	tunnel.OnSuspend()
	dialer.DefaultSocketHook = func(network, address string, conn syscall.RawConn) error {
		return androidRuntime.socketHook(conn, protectSocket)
	}
}

func applyAndroidConfiguration(cfg *config.Config) {
	// ApplyConfig internally resumes the tunnel, even before a TUN is attached.
	// Keep stopped/failed-start runtimes suspended, including panic paths.
	defer func() {
		if !androidRuntime.protected.Load() {
			tunnel.OnSuspend()
		}
	}()
	androidRuntime.applyConfiguration(func() { executor.ApplyConfig(cfg, true) })
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

	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	applyAndroidConfiguration(cfg)
	lastConfigJSON = append(lastConfigJSON[:0], data...)
	return C.CString("")
}

//export updateDns
func updateDns(dns *C.char) *C.char {
	servers, err := parseDNS(cString(dns))
	if err != nil {
		return resultString(err)
	}

	androidTunMu.Lock()
	defer androidTunMu.Unlock()

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
	applyAndroidConfiguration(cfg)
	lastConfigJSON = append(lastConfigJSON[:0], updated...)
	return C.CString("")
}

//export startTUN
func startTUN(fd C.int, stack, address, dns *C.char) C.uchar {
	androidTunMu.Lock()
	defer androidTunMu.Unlock()

	tunnel.OnSuspend()
	if err := closeAndroidResources(); err != nil {
		// Keep failed cleanup ownership and the caller's descriptor on failure.
		return 0
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
			// The caller retains ownership until this function succeeds.
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
		// The caller retains ownership until this function succeeds.
		return 0
	}

	dupFd, err := syscall.Dup(int(fd))
	if err != nil {
		// The caller retains ownership until this function succeeds.
		return 0
	}

	options := LC.Tun{
		Enable:              true,
		Stack:               tunStackValue(cString(stack)),
		Device:              "AngelaNexus",
		DNSHijack:           dnsHijack,
		AutoRoute:           false,
		AutoDetectInterface: false,
		MTU:                 9000,
		FileDescriptor:      dupFd,
		Inet4Address:        prefix4,
		Inet6Address:        prefix6,
	}

	listener, err := sing_tun.New(options, tunnel.Tunnel)
	if err != nil {
		_ = syscall.Close(dupFd)
		return 0
	}

	// The listener owns the duplicated descriptor. The caller's descriptor
	// is released only after successful construction so failure remains
	// unambiguous at the JNI/service boundary.
	_ = syscall.Close(int(fd))
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	return 1
}

// Caller holds androidTunMu and suspends tunnel admission. A snapshot closes
// currently registered TCP/UDP trackers, not late dials, NAT or background tasks.
func closeAndroidResources() error {
	listenerErr := androidRuntime.closeTun()
	connections := make(map[string]io.Closer)
	statistic.DefaultManager.Range(func(connection statistic.Tracker) bool {
		connections[connection.ID()] = connection
		return true
	})
	// Do not short-circuit on a listener failure: still attempt every connection.
	connectionErr := androidRuntime.closeConnections(connections)
	return errors.Join(listenerErr, connectionErr)
}

func stopTunError() error {
	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	tunnel.OnSuspend()
	return closeAndroidResources()
}

//export angelaStopTun
func angelaStopTun() *C.char {
	return resultString(stopTunError())
}

//export stopTun
func stopTun() {
	// Kept for older consumers. New callers must use angelaStopTun so a close
	// error reaches the existing Kotlin failure/retry path.
	_ = stopTunError()
}

//export suspend
func suspend(suspended C.uchar) {
	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	if suspended != 0 || !androidRuntime.protected.Load() {
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
