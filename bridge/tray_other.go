//go:build !darwin && !windows

package main

import (
	"fmt"
	"os"
)

func runTrayApp(cfg ProxyConfig, apiURL string) {
	srv, err := StartServer(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "启动本地代理失败 (%s:%d): %v\n", cfg.Host, cfg.Port, err)
		os.Exit(1)
	}
	runHeadless(srv, apiURL)
}
