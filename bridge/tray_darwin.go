//go:build darwin

package main

/*
#cgo darwin CFLAGS: -fobjc-arc
#cgo darwin LDFLAGS: -framework Cocoa
#include <stdlib.h>

extern void ghcnShowAlert(const char *title, const char *message);
extern void ghcnCopyText(const char *text);
extern void ghcnHideTray(void);
extern void ghcnTerminateApp(void);
extern void ghcnRunTray(
    const void *iconBytes,
    int iconLen,
    const char *statusTitle,
    const char *copyTitle,
    const char *quitTitle,
    const char *tooltip
);
*/
import "C"

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

func init() {
	runtime.LockOSThread()
}

var (
	darwinMu       sync.Mutex
	darwinServer   *ProxyServer
	darwinAPIURL   string
	darwinQuitOnce sync.Once
)

//export goOnCopyURL
func goOnCopyURL() {
	darwinMu.Lock()
	url := darwinAPIURL
	darwinMu.Unlock()
	if url == "" {
		return
	}
	cURL := C.CString(url)
	defer C.free(unsafe.Pointer(cURL))
	C.ghcnCopyText(cURL)
}

//export goOnQuit
func goOnQuit() {
	darwinQuitOnce.Do(func() {
		C.ghcnHideTray()

		darwinMu.Lock()
		srv := darwinServer
		darwinServer = nil
		darwinMu.Unlock()

		go func() {
			if srv != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				_ = srv.Shutdown(ctx)
				cancel()
			}
			C.ghcnTerminateApp()
		}()
	})
}

func showDarwinAlert(title, message string) {
	cTitle := C.CString(title)
	cMsg := C.CString(message)
	defer C.free(unsafe.Pointer(cTitle))
	defer C.free(unsafe.Pointer(cMsg))
	C.ghcnShowAlert(cTitle, cMsg)
}

func acquireSingleInstanceLock(port int) (*os.File, bool) {
	lockPath := filepath.Join(os.TempDir(), fmt.Sprintf("ghcn-index-translate-bridge-%d.lock", port))
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, true
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, false
	}
	return f, true
}

func runTrayApp(cfg ProxyConfig, apiURL string) {
	lockFile, acquired := acquireSingleInstanceLock(cfg.Port)
	if !acquired {
		showDarwinAlert(
			"Index-Translate 本地代理已在运行",
			fmt.Sprintf("本地代理已在后台运行中：\n%s\n\n点击顶部菜单栏图标可复制地址或退出。", apiURL),
		)
		return
	}
	defer func() {
		if lockFile != nil {
			_ = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)
			_ = lockFile.Close()
		}
	}()

	srv, err := StartServer(cfg)
	if err != nil {
		showDarwinAlert(
			"启动本地代理失败",
			fmt.Sprintf("本地端口 %d 已被占用（可能已运行 call_api.py --serve 或其他程序）：\n%v", cfg.Port, err),
		)
		os.Exit(1)
	}

	darwinMu.Lock()
	darwinServer = srv
	darwinAPIURL = apiURL
	darwinMu.Unlock()

	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		goOnQuit()
	}()

	var iconPtr unsafe.Pointer
	if len(embeddedMacOSPNG) > 0 {
		iconPtr = unsafe.Pointer(&embeddedMacOSPNG[0])
	}
	cStatus := C.CString(fmt.Sprintf("Index-Translate 运行中 (%s:%d)", displayHost(cfg.Host), cfg.Port))
	cCopy := C.CString(fmt.Sprintf("复制接口地址 (%s)", apiURL))
	cQuit := C.CString("退出")
	cTip := C.CString(fmt.Sprintf("Bilibili Index-Translate 本地代理 (%s)", apiURL))
	defer C.free(unsafe.Pointer(cStatus))
	defer C.free(unsafe.Pointer(cCopy))
	defer C.free(unsafe.Pointer(cQuit))
	defer C.free(unsafe.Pointer(cTip))

	C.ghcnRunTray(iconPtr, C.int(len(embeddedMacOSPNG)), cStatus, cCopy, cQuit, cTip)
}
