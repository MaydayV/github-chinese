package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	defaultAPIBase   = "https://index-translate.bilibili.com/v1"
	defaultHost      = "127.0.0.1"
	defaultPort      = 8080
	defaultUserAgent = "Index-Translate-Client/1.0"
	maxRequestBytes  = 8 << 20
)

type ProxyConfig struct {
	Host    string
	Port    int
	APIBase string
}

type ProxyServer struct {
	server   *http.Server
	listener net.Listener
}

func (p *ProxyServer) ListenAddr() string {
	if p == nil || p.listener == nil {
		return ""
	}
	return p.listener.Addr().String()
}

func (p *ProxyServer) Shutdown(ctx context.Context) error {
	if p == nil || p.server == nil {
		return nil
	}
	return p.server.Shutdown(ctx)
}

func newUpstreamHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   15 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          16,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 120 * time.Second,
		},
	}
}

func setCORSHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "*")
	h.Set("Access-Control-Max-Age", "86400")
}

func injectDefaults(rawBody []byte) []byte {
	var payload map[string]any
	if err := json.Unmarshal(rawBody, &payload); err != nil || payload == nil {
		return rawBody
	}

	kwargs, ok := payload["chat_template_kwargs"].(map[string]any)
	if !ok || kwargs == nil {
		kwargs = map[string]any{}
		payload["chat_template_kwargs"] = kwargs
	}
	if _, exists := kwargs["enable_thinking"]; !exists {
		kwargs["enable_thinking"] = false
	}
	if temp, exists := payload["temperature"]; !exists || temp == nil {
		payload["temperature"] = 0.0
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return rawBody
	}
	return encoded
}

func resolveUpstreamPath(reqPath string) (string, bool) {
	switch {
	case strings.HasSuffix(reqPath, "/chat/completions"):
		return "/chat/completions", true
	case strings.HasSuffix(reqPath, "/completions"):
		return "/completions", true
	case strings.HasSuffix(reqPath, "/responses"):
		return "/responses", true
	default:
		return "", false
	}
}

func isTransientEOF(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "EOF") || strings.Contains(msg, "connection reset by peer")
}

// NewHandler creates the OpenAI-compatible local bridge HTTP handler mirroring call_api.py --serve.
func NewHandler(apiBase string, client *http.Client) http.Handler {
	base := strings.TrimRight(strings.TrimSpace(apiBase), "/")
	if base == "" {
		base = defaultAPIBase
	}
	if client == nil {
		client = newUpstreamHTTPClient()
	}

	modelsBody, _ := json.Marshal(map[string]any{
		"object": "list",
		"data": []map[string]string{
			{"id": "Index-Translate-35B-A3B", "object": "model"},
			{"id": "Index-Translate-2B", "object": "model"},
			{"id": "Index-Translate-9B", "object": "model"},
		},
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodOptions:
			setCORSHeaders(w)
			w.WriteHeader(http.StatusOK)
			return

		case http.MethodGet:
			setCORSHeaders(w)
			if r.URL.Path == "/v1/models" || r.URL.Path == "/models" {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Content-Length", fmt.Sprintf("%d", len(modelsBody)))
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(modelsBody)
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("Index-Translate Proxy Ready\n"))
			return

		case http.MethodPost:
			upstreamPath, ok := resolveUpstreamPath(r.URL.Path)
			if !ok {
				setCORSHeaders(w)
				w.WriteHeader(http.StatusNotFound)
				return
			}

			r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
			rawBody, err := io.ReadAll(r.Body)
			if err != nil {
				var maxErr *http.MaxBytesError
				setCORSHeaders(w)
				if errors.As(err, &maxErr) {
					http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
				} else {
					http.Error(w, "failed to read request body", http.StatusBadRequest)
				}
				return
			}

			forwardBody := injectDefaults(rawBody)
			upstreamURL := base + upstreamPath

			var resp *http.Response
			for attempt := 0; attempt < 2; attempt++ {
				req, reqErr := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL, bytes.NewReader(forwardBody))
				if reqErr != nil {
					err = reqErr
					break
				}
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("User-Agent", defaultUserAgent)

				resp, err = client.Do(req)
				if err == nil {
					break
				}
				if attempt == 0 && isTransientEOF(err) {
					continue
				}
				break
			}

			if err != nil {
				setCORSHeaders(w)
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Connection", "close")
				w.WriteHeader(http.StatusBadGateway)
				errBody, _ := json.Marshal(map[string]string{"error": err.Error()})
				_, _ = w.Write(errBody)
				return
			}
			defer resp.Body.Close()

			setCORSHeaders(w)
			for _, headerName := range []string{"Content-Type", "Cache-Control", "Content-Encoding", "Retry-After"} {
				if val := resp.Header.Get(headerName); val != "" {
					w.Header().Set(headerName, val)
				}
			}
			w.Header().Set("Connection", "close")
			w.WriteHeader(resp.StatusCode)

			flusher, hasFlusher := w.(http.Flusher)
			buf := make([]byte, 4096)
			for {
				n, readErr := resp.Body.Read(buf)
				if n > 0 {
					if _, writeErr := w.Write(buf[:n]); writeErr != nil {
						return
					}
					if hasFlusher {
						flusher.Flush()
					}
				}
				if readErr != nil {
					if !errors.Is(readErr, io.EOF) {
						panic(http.ErrAbortHandler)
					}
					return
				}
			}

		default:
			setCORSHeaders(w)
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
}

func StartServer(cfg ProxyConfig) (*ProxyServer, error) {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		host = defaultHost
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return nil, fmt.Errorf("invalid port: %d", cfg.Port)
	}
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", cfg.Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}

	srv := &http.Server{
		Handler:           NewHandler(cfg.APIBase, nil),
		ReadHeaderTimeout: 15 * time.Second,
	}
	ps := &ProxyServer{server: srv, listener: ln}
	go func() {
		_ = srv.Serve(ln)
	}()
	return ps, nil
}
