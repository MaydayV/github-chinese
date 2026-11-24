//go:build windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	_ "image/png"
	"os"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

const (
	wmNull            = 0x0000
	wmDestroy         = 0x0002
	wmQueryEndSession = 0x0011
	wmEndSession      = 0x0016
	wmCommand         = 0x0111
	wmLButtonUp       = 0x0202
	wmRButtonUp       = 0x0205
	wmContextMenu     = 0x007B
	wmApp             = 0x8000
	msgTrayCallback   = wmApp + 1

	nimAdd    = 0x00000000
	nimDelete = 0x00000002

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	mfString    = 0x00000000
	mfGrayed    = 0x00000001
	mfSeparator = 0x00000800

	tpmLeftAlign   = 0x0000
	tpmRightButton = 0x0002
	tpmBottomAlign = 0x0020

	mbOK        = 0x00000000
	mbIconError = 0x00000010
	mbIconInfo  = 0x00000040

	gmemMoveable  = 0x0002
	cfUnicodeText = 13

	idiApplication     = 32512
	errorAlreadyExists = syscall.Errno(183)

	cmdCopyURL = 1001
	cmdExitApp = 1002
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type point struct {
	X int32
	Y int32
}

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type notifyIconData struct {
	cbSize           uint32
	_                uint32
	hwnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	_                uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uTimeoutOrVer    uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         guid
	hBalloonIcon     uintptr
}

type msg struct {
	hwnd    uintptr
	message uint32
	_       uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
	_       uint32
}

type bitmapInfoHeader struct {
	biSize          uint32
	biWidth         int32
	biHeight        int32
	biPlanes        uint16
	biBitCount      uint16
	biCompression   uint32
	biSizeImage     uint32
	biXPelsPerMeter int32
	biYPelsPerMeter int32
	biClrUsed       uint32
	biClrImportant  uint32
}

type bitmapInfo struct {
	bmiHeader bitmapInfoHeader
	bmiColors [1]uint32
}

type iconInfo struct {
	fIcon    int32
	xHotspot uint32
	yHotspot uint32
	_        uint32
	hbmMask  uintptr
	hbmColor uintptr
}

// Compile-time amd64/arm64 ABI layout assertions.
var (
	_ [unsafe.Sizeof(wndClassEx{}) - 80]byte
	_ [80 - unsafe.Sizeof(wndClassEx{})]byte
	_ [unsafe.Sizeof(notifyIconData{}) - 976]byte
	_ [976 - unsafe.Sizeof(notifyIconData{})]byte
	_ [unsafe.Sizeof(msg{}) - 48]byte
	_ [48 - unsafe.Sizeof(msg{})]byte
	_ [unsafe.Sizeof(bitmapInfoHeader{}) - 40]byte
	_ [40 - unsafe.Sizeof(bitmapInfoHeader{})]byte
	_ [unsafe.Sizeof(iconInfo{}) - 32]byte
	_ [32 - unsafe.Sizeof(iconInfo{})]byte
)

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	user32   = syscall.NewLazyDLL("user32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")

	procGetModuleHandleW       = kernel32.NewProc("GetModuleHandleW")
	procCreateMutexW           = kernel32.NewProc("CreateMutexW")
	procCloseHandle            = kernel32.NewProc("CloseHandle")
	procRtlMoveMemory          = kernel32.NewProc("RtlMoveMemory")
	procGlobalAlloc            = kernel32.NewProc("GlobalAlloc")
	procGlobalFree             = kernel32.NewProc("GlobalFree")
	procGlobalLock             = kernel32.NewProc("GlobalLock")
	procGlobalUnlock           = kernel32.NewProc("GlobalUnlock")
	procRegisterClassExW       = user32.NewProc("RegisterClassExW")
	procCreateWindowExW        = user32.NewProc("CreateWindowExW")
	procDestroyWindow          = user32.NewProc("DestroyWindow")
	procDefWindowProcW         = user32.NewProc("DefWindowProcW")
	procGetMessageW            = user32.NewProc("GetMessageW")
	procTranslateMessage       = user32.NewProc("TranslateMessage")
	procDispatchMessageW       = user32.NewProc("DispatchMessageW")
	procPostQuitMessage        = user32.NewProc("PostQuitMessage")
	procPostMessageW           = user32.NewProc("PostMessageW")
	procRegisterWindowMessageW = user32.NewProc("RegisterWindowMessageW")
	procLoadIconW              = user32.NewProc("LoadIconW")
	procCreateIconIndirect     = user32.NewProc("CreateIconIndirect")
	procDestroyIcon            = user32.NewProc("DestroyIcon")
	procCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	procDestroyMenu            = user32.NewProc("DestroyMenu")
	procAppendMenuW            = user32.NewProc("AppendMenuW")
	procTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procMessageBoxW            = user32.NewProc("MessageBoxW")
	procOpenClipboard          = user32.NewProc("OpenClipboard")
	procCloseClipboard         = user32.NewProc("CloseClipboard")
	procEmptyClipboard         = user32.NewProc("EmptyClipboard")
	procSetClipboardData       = user32.NewProc("SetClipboardData")
	procCreateDIBSection       = gdi32.NewProc("CreateDIBSection")
	procCreateBitmap           = gdi32.NewProc("CreateBitmap")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procShellNotifyIconW       = shell32.NewProc("Shell_NotifyIconW")
)

func utf16Ptr(s string) *uint16 {
	p, err := syscall.UTF16PtrFromString(s)
	if err != nil {
		p, _ = syscall.UTF16PtrFromString("")
	}
	return p
}

func showMessageBox(title, message string, flags uintptr) {
	_, _, _ = procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(utf16Ptr(message))),
		uintptr(unsafe.Pointer(utf16Ptr(title))),
		flags,
	)
}

func createHIconFromPNG(pngBytes []byte) uintptr {
	img, _, err := image.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return 0
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	if w <= 0 || h <= 0 {
		return 0
	}

	bounds := image.Rect(0, 0, w, h)
	nrgba := image.NewNRGBA(bounds)
	draw.Draw(nrgba, bounds, img, img.Bounds().Min, draw.Src)

	var bmi bitmapInfo
	bmi.bmiHeader.biSize = uint32(unsafe.Sizeof(bmi.bmiHeader))
	bmi.bmiHeader.biWidth = int32(w)
	bmi.bmiHeader.biHeight = int32(-h)
	bmi.bmiHeader.biPlanes = 1
	bmi.bmiHeader.biBitCount = 32
	bmi.bmiHeader.biCompression = 0

	var ppvBits unsafe.Pointer
	hColor, _, _ := procCreateDIBSection.Call(
		0,
		uintptr(unsafe.Pointer(&bmi)),
		0,
		uintptr(unsafe.Pointer(&ppvBits)),
		0,
		0,
	)
	if hColor == 0 || ppvBits == nil {
		return 0
	}
	defer procDeleteObject.Call(hColor)

	src := nrgba.Pix
	dst := unsafe.Slice((*byte)(ppvBits), w*h*4)
	for i := 0; i < len(src); i += 4 {
		dst[i+0] = src[i+2]
		dst[i+1] = src[i+1]
		dst[i+2] = src[i+0]
		dst[i+3] = src[i+3]
	}

	maskStride := ((w + 15) / 16) * 2
	maskBits := make([]byte, maskStride*h)
	hMask, _, _ := procCreateBitmap.Call(
		uintptr(w),
		uintptr(h),
		1,
		1,
		uintptr(unsafe.Pointer(&maskBits[0])),
	)
	runtime.KeepAlive(maskBits)
	if hMask == 0 {
		return 0
	}
	defer procDeleteObject.Call(hMask)

	ii := iconInfo{
		fIcon:    1,
		hbmMask:  hMask,
		hbmColor: hColor,
	}
	hIcon, _, _ := procCreateIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	return hIcon
}

func copyClipboardText(hwnd uintptr, text string) {
	u16, err := syscall.UTF16FromString(text)
	if err != nil || len(u16) == 0 {
		return
	}
	nBytes := uintptr(len(u16) * 2)
	hMem, _, _ := procGlobalAlloc.Call(gmemMoveable, nBytes)
	if hMem == 0 {
		return
	}
	ptr, _, _ := procGlobalLock.Call(hMem)
	if ptr == 0 {
		_, _, _ = procGlobalFree.Call(hMem)
		return
	}
	_, _, _ = procRtlMoveMemory.Call(ptr, uintptr(unsafe.Pointer(&u16[0])), nBytes)
	runtime.KeepAlive(u16)
	_, _, _ = procGlobalUnlock.Call(hMem)

	opened, _, _ := procOpenClipboard.Call(hwnd)
	if opened == 0 {
		_, _, _ = procGlobalFree.Call(hMem)
		return
	}
	defer procCloseClipboard.Call()
	_, _, _ = procEmptyClipboard.Call()
	ret, _, _ := procSetClipboardData.Call(cfUnicodeText, hMem)
	if ret == 0 {
		_, _, _ = procGlobalFree.Call(hMem)
	}
}

type winTrayState struct {
	cfg                ProxyConfig
	apiURL             string
	server             *ProxyServer
	hwnd               uintptr
	hIcon              uintptr
	msgTaskbarCreated  uint32
	nid                notifyIconData
}

var activeWinTray *winTrayState

func (s *winTrayState) addTrayIcon() {
	_, _, _ = procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&s.nid)))
}

func (s *winTrayState) removeTrayIcon() {
	_, _, _ = procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&s.nid)))
}

func (s *winTrayState) showContextMenu() {
	hMenu, _, _ := procCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer procDestroyMenu.Call(hMenu)

	statusText := fmt.Sprintf("Index-Translate 运行中 (%s:%d)", displayHost(s.cfg.Host), s.cfg.Port)
	copyText := fmt.Sprintf("复制接口地址 (%s)", s.apiURL)

	_, _, _ = procAppendMenuW.Call(hMenu, mfString|mfGrayed, 0, uintptr(unsafe.Pointer(utf16Ptr(statusText))))
	_, _, _ = procAppendMenuW.Call(hMenu, mfString, cmdCopyURL, uintptr(unsafe.Pointer(utf16Ptr(copyText))))
	_, _, _ = procAppendMenuW.Call(hMenu, mfSeparator, 0, 0)
	_, _, _ = procAppendMenuW.Call(hMenu, mfString, cmdExitApp, uintptr(unsafe.Pointer(utf16Ptr("退出"))))

	var pt point
	_, _, _ = procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	_, _, _ = procSetForegroundWindow.Call(s.hwnd)
	_, _, _ = procTrackPopupMenu.Call(
		hMenu,
		tpmLeftAlign|tpmBottomAlign|tpmRightButton,
		uintptr(pt.X),
		uintptr(pt.Y),
		0,
		s.hwnd,
		0,
	)
	_, _, _ = procPostMessageW.Call(s.hwnd, wmNull, 0, 0)
}

func (s *winTrayState) shutdownServer() {
	if s.server == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	_ = s.server.Shutdown(ctx)
	cancel()
	s.server = nil
}

func winTrayWndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	s := activeWinTray
	if s != nil {
		if s.msgTaskbarCreated != 0 && message == s.msgTaskbarCreated {
			s.addTrayIcon()
			return 0
		}
		switch message {
		case msgTrayCallback:
			switch uint32(lParam) {
			case wmRButtonUp, wmContextMenu, wmLButtonUp:
				s.showContextMenu()
			}
			return 0
		case wmCommand:
			switch wParam & 0xffff {
			case cmdCopyURL:
				copyClipboardText(hwnd, s.apiURL)
			case cmdExitApp:
				_, _, _ = procDestroyWindow.Call(hwnd)
			}
			return 0
		case wmQueryEndSession:
			return 1
		case wmEndSession:
			if wParam != 0 {
				s.removeTrayIcon()
				s.shutdownServer()
				_, _, _ = procPostQuitMessage.Call(0)
			}
			return 0
		case wmDestroy:
			s.removeTrayIcon()
			s.shutdownServer()
			if s.hIcon != 0 {
				_, _, _ = procDestroyIcon.Call(s.hIcon)
				s.hIcon = 0
			}
			_, _, _ = procPostQuitMessage.Call(0)
			return 0
		}
	}
	ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return ret
}

func runTrayApp(cfg ProxyConfig, apiURL string) {
	runtime.LockOSThread()

	mutexName := fmt.Sprintf("Local\\GitHubChineseIndexTranslateBridge_%d", cfg.Port)
	hMutex, _, mutexErr := procCreateMutexW.Call(0, 1, uintptr(unsafe.Pointer(utf16Ptr(mutexName))))
	if hMutex != 0 {
		defer procCloseHandle.Call(hMutex)
	}
	if mutexErr == errorAlreadyExists {
		showMessageBox(
			"Index-Translate 本地代理已在运行",
			fmt.Sprintf("本地代理已在后台运行中：\n%s\n\n请查看屏幕右下角系统托盘图标。", apiURL),
			mbOK|mbIconInfo,
		)
		return
	}

	srv, err := StartServer(cfg)
	if err != nil {
		showMessageBox(
			"启动本地代理失败",
			fmt.Sprintf("本地端口 %d 已被占用（可能已运行 call_api.py --serve 或其他程序）：\n%v", cfg.Port, err),
			mbOK|mbIconError,
		)
		os.Exit(1)
	}

	hInst, _, _ := procGetModuleHandleW.Call(0)
	hIcon := createHIconFromPNG(embeddedTrayPNG)
	customIcon := hIcon != 0
	if !customIcon {
		hIcon, _, _ = procLoadIconW.Call(0, idiApplication)
	}

	className := utf16Ptr("GhcnIndexTranslateTrayClass")
	wcx := wndClassEx{
		cbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		lpfnWndProc:   syscall.NewCallback(winTrayWndProc),
		hInstance:     hInst,
		hIcon:         hIcon,
		hIconSm:       hIcon,
		lpszClassName: className,
	}
	_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wcx)))

	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr("Index-Translate 本地代理"))),
		0,
		0, 0, 0, 0,
		0, 0, hInst, 0,
	)
	if hwnd == 0 {
		if customIcon && hIcon != 0 {
			_, _, _ = procDestroyIcon.Call(hIcon)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = srv.Shutdown(ctx)
		cancel()
		showMessageBox("启动失败", "创建系统托盘窗口失败。", mbOK|mbIconError)
		os.Exit(1)
	}

	taskbarMsg, _, _ := procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(utf16Ptr("TaskbarCreated"))))

	state := &winTrayState{
		cfg:               cfg,
		apiURL:            apiURL,
		server:            srv,
		hwnd:              hwnd,
		msgTaskbarCreated: uint32(taskbarMsg),
	}
	if customIcon {
		state.hIcon = hIcon
	}
	state.nid = notifyIconData{
		cbSize:           uint32(unsafe.Sizeof(notifyIconData{})),
		hwnd:             hwnd,
		uID:              1,
		uFlags:           nifMessage | nifIcon | nifTip,
		uCallbackMessage: msgTrayCallback,
		hIcon:            hIcon,
	}
	tipText := fmt.Sprintf("Index-Translate 本地代理 (%s)", apiURL)
	if tipSlice, err := syscall.UTF16FromString(tipText); err == nil {
		copy(state.nid.szTip[:len(state.nid.szTip)-1], tipSlice)
	}

	activeWinTray = state
	state.addTrayIcon()

	var m msg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	activeWinTray = nil
}
