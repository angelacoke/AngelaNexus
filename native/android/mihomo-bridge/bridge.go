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
		if !androidRuntime.ready() {
			tunnel.OnSuspend()
		}
	}()
	androidRuntime.applyConfiguration(func() { executor.ApplyConfig(cfg, true) })
}

//export angelaInit
func angelaInit(homeDir *C.char) *C.char {
	return resultString(initializeAndroid(cString(homeDir)))
}

func initializeAndroid(homeDir string) error {
	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	dir := strings.TrimSpace(homeDir)
	if dir == "" {
		return errors.New("homeDir is required")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	constant.SetHomeDir(dir)
	return nil
}

//export angelaApplyConfig
func angelaApplyConfig(configJSON *C.char) *C.char {
	return resultString(applyAndroidConfigJSON([]byte(cString(configJSON))))
}

func applyAndroidConfigJSON(data []byte) error {
	generation := androidRuntime.stopGeneration.Load()
	if err := androidRuntime.checkConfigurationGeneration(generation); err != nil {
		return err
	}
	return applyAndroidConfigJSONAtGeneration(data, generation)
}

// The captured generation belongs to the request, not to lock acquisition.
func applyAndroidConfigJSONAtGeneration(data []byte, generation uint64) error {
	// config.Parse temporarily changes upstream globals and rolls them back.
	// Serialize parsing with apply, DNS updates, home changes and stop/start;
	// locking only ApplyConfig lets a late parse rollback undo another apply.
	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	if err := androidRuntime.checkConfigurationGeneration(generation); err != nil {
		return err
	}
	if len(data) == 0 {
		return errors.New("config is empty")
	}

	cfg, err := config.Parse(data)
	if err != nil {
		return err
	}

	applyAndroidConfiguration(cfg)
	lastConfigJSON = append(lastConfigJSON[:0], data...)
	return nil
}

//export updateDns
func updateDns(dns *C.char) *C.char {
	return resultString(updateAndroidDNS(cString(dns)))
}

func updateAndroidDNS(dns string) error {
	generation := androidRuntime.stopGeneration.Load()
	if err := androidRuntime.checkConfigurationGeneration(generation); err != nil {
		return err
	}
	return updateAndroidDNSAtGeneration(dns, generation)
}

// The captured generation belongs to the request, not to lock acquisition.
func updateAndroidDNSAtGeneration(dns string, generation uint64) error {
	servers, err := parseDNS(dns)
	if err != nil {
		return err
	}

	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	if err := androidRuntime.checkConfigurationGeneration(generation); err != nil {
		return err
	}

	if len(lastConfigJSON) == 0 {
		return errors.New("no configuration has been applied")
	}

	var document map[string]any
	if err := json.Unmarshal(lastConfigJSON, &document); err != nil {
		return err
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
		return err
	}
	cfg, err := config.Parse(updated)
	if err != nil {
		return err
	}
	applyAndroidConfiguration(cfg)
	lastConfigJSON = append(lastConfigJSON[:0], updated...)
	return nil
}

//export startTUN
func startTUN(fd C.int, stack, address, dns *C.char) C.uchar {
	generation := androidRuntime.stopGeneration.Load()
	if err := androidRuntime.checkConfigurationGeneration(generation); err != nil {
		return 0
	}
	if startAndroidTUNAtGeneration(int(fd), cString(stack), cString(address), cString(dns), generation) {
		return 1
	}
	return 0
}

// Keep the request token across the control-lock wait, just like config/DNS.
// Rejection retains the caller's descriptor and does not clean up a newer TUN.
func startAndroidTUNAtGeneration(fd int, stack, address, dns string, generation uint64) bool {
	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	// Reject before touching current ownership: a newer start may have won
	// the control lock after the superseding stop completed.
	if err := androidRuntime.checkConfigurationGeneration(generation); err != nil {
		return false
	}

	tunnel.OnSuspend()
	if err := closeAndroidResources(); err != nil {
		// Keep failed cleanup ownership and the caller's descriptor on failure.
		return false
	}
	if fd < 0 || androidRuntime.pendingStops.Load() != 0 {
		return false
	}

	var prefix4 []netip.Prefix
	var prefix6 []netip.Prefix
	for _, value := range strings.Split(address, ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		prefix, ok := parsePrefix(value)
		if !ok {
			// The caller retains ownership until this function succeeds.
			return false
		}
		if prefix.Addr().Is4() {
			prefix4 = append(prefix4, prefix)
		} else {
			prefix6 = append(prefix6, prefix)
		}
	}

	dnsHijack, err := parseDNS(dns)
	if err != nil {
		// The caller retains ownership until this function succeeds.
		return false
	}

	dupFd, err := syscall.Dup(fd)
	if err != nil {
		// The caller retains ownership until this function succeeds.
		return false
	}

	options := LC.Tun{
		Enable:              true,
		Stack:               tunStackValue(stack),
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
		return false
	}

	// The listener owns the duplicated descriptor. The caller's descriptor
	// is released only after successful construction so failure remains
	// unambiguous at the JNI/service boundary.
	_ = syscall.Close(fd)
	androidRuntime.listener = listener
	// A newly attached runtime starts unpaused; failed starts never clear pause.
	androidRuntime.setSuspended(false)
	androidRuntime.restoreAdmission(true)
	// A stop may have been announced while constructing the listener. It owns
	// the queued cleanup; do not resume tunnel admission before it gets the lock.
	if androidRuntime.ready() {
		tunnel.OnRunning()
	}
	return true
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
	// Reject and drain socket hooks even if config.Parse/ApplyConfig currently
	// holds the control mutex. This does not cancel parsing or completed hooks.
	androidRuntime.beginStop()
	defer androidRuntime.endStop()
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
	if suspended != 0 {
		// Parsing/apply can hold androidTunMu for an unbounded time. Gate hooks
		// now, not only once that operation eventually releases the mutex.
		androidRuntime.beginSuspend()
	}
	androidTunMu.Lock()
	defer androidTunMu.Unlock()
	if suspended != 0 {
		// Retire this request before unlocking: a following resume must not see
		// an already-completed pause and leave tunnel status falsely suspended.
		defer androidRuntime.endSuspend()
	}
	androidRuntime.setSuspended(suspended != 0)
	if suspended != 0 || !androidRuntime.ready() {
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
