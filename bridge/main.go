package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func displayHost(host string) string {
	if host == "" || host == "0.0.0.0" || host == "::" {
		return "127.0.0.1"
	}
	return host
}

func runHeadless(srv *ProxyServer, apiURL string) {
	fmt.Printf("Index-Translate 本地代理已启动：%s\n", apiURL)
	ch := make(chan os.Signal, 2)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func main() {
	host := flag.String("host", defaultHost, "Listen host (default: 127.0.0.1)")
	port := flag.Int("port", defaultPort, "Listen port (default: 8080)")
	apiBase := flag.String("api-base", defaultAPIBase, "Upstream Index-Translate API base URL")
	headless := flag.Bool("headless", false, "Run without tray icon (CLI mode)")
	flag.Parse()

	trimmedHost := strings.TrimSpace(*host)
	if trimmedHost == "" {
		trimmedHost = defaultHost
	}
	if *port < 1 || *port > 65535 {
		fmt.Fprintf(os.Stderr, "端口必须在 1-65535 之间，当前为 %d\n", *port)
		os.Exit(1)
	}

	cfg := ProxyConfig{
		Host:    trimmedHost,
		Port:    *port,
		APIBase: *apiBase,
	}
	apiURL := fmt.Sprintf("http://%s:%d/v1", displayHost(cfg.Host), cfg.Port)

	if *headless {
		srv, err := StartServer(cfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "启动本地代理失败 (%s:%d): %v\n", cfg.Host, cfg.Port, err)
			os.Exit(1)
		}
		runHeadless(srv, apiURL)
		return
	}

	runTrayApp(cfg, apiURL)
}
