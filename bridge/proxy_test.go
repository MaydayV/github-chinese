package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestProxyOptionsCORS(t *testing.T) {
	h := NewHandler("https://example.invalid/v1", nil)
	req := httptest.NewRequest(http.MethodOptions, "/v1/chat/completions", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected CORS Allow-Origin *, got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") {
		t.Fatalf("expected POST in Allow-Methods, got %q", got)
	}
}

func TestProxyGetEndpoints(t *testing.T) {
	h := NewHandler("https://example.invalid/v1", nil)

	recModels := httptest.NewRecorder()
	h.ServeHTTP(recModels, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	if recModels.Code != http.StatusOK {
		t.Fatalf("expected 200 on /v1/models, got %d", recModels.Code)
	}
	var modelsResp struct {
		Object string `json:"object"`
		Data   []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recModels.Body.Bytes(), &modelsResp); err != nil {
		t.Fatalf("invalid models json: %v", err)
	}
	if modelsResp.Object != "list" || len(modelsResp.Data) != 3 {
		t.Fatalf("unexpected models response: %+v", modelsResp)
	}

	recRoot := httptest.NewRecorder()
	h.ServeHTTP(recRoot, httptest.NewRequest(http.MethodGet, "/", nil))
	if recRoot.Code != http.StatusOK || !strings.Contains(recRoot.Body.String(), "Index-Translate Proxy Ready") {
		t.Fatalf("unexpected root response: %d %q", recRoot.Code, recRoot.Body.String())
	}
}

func TestProxyPostInjectionAndHeaderStripping(t *testing.T) {
	var capturedPath string
	var capturedOrigin string
	var capturedCookie string
	var capturedAuth string
	var capturedUA string
	var capturedBody map[string]any

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedOrigin = r.Header.Get("Origin")
		capturedCookie = r.Header.Get("Cookie")
		capturedAuth = r.Header.Get("Authorization")
		capturedUA = r.Header.Get("User-Agent")
		_ = json.NewDecoder(r.Body).Decode(&capturedBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}]}`))
	}))
	defer upstream.Close()

	h := NewHandler(upstream.URL+"/v1", upstream.Client())
	reqBody := `{"model":"Index-Translate-35B-A3B","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(reqBody))
	req.Header.Set("Origin", "chrome-extension://test")
	req.Header.Set("Cookie", "secret=1")
	req.Header.Set("Authorization", "Bearer leak")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if capturedPath != "/v1/chat/completions" {
		t.Fatalf("unexpected upstream path: %q", capturedPath)
	}
	if capturedOrigin != "" || capturedCookie != "" || capturedAuth != "" {
		t.Fatalf("sensitive/browser headers leaked: origin=%q cookie=%q auth=%q", capturedOrigin, capturedCookie, capturedAuth)
	}
	if capturedUA != defaultUserAgent {
		t.Fatalf("expected User-Agent %q, got %q", defaultUserAgent, capturedUA)
	}
	kwargs, _ := capturedBody["chat_template_kwargs"].(map[string]any)
	if kwargs["enable_thinking"] != false {
		t.Fatalf("expected enable_thinking=false, got %#v", kwargs)
	}
	if temp, ok := capturedBody["temperature"].(float64); !ok || temp != 0.0 {
		t.Fatalf("expected temperature=0.0, got %#v", capturedBody["temperature"])
	}

	// Preserve caller's explicit values
	req2Body := `{"model":"Index-Translate-9B","temperature":0.3,"chat_template_kwargs":{"enable_thinking":true,"extra":"keep"}}`
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/chat/completions", strings.NewReader(req2Body)))
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec2.Code)
	}
	if temp, _ := capturedBody["temperature"].(float64); temp != 0.3 {
		t.Fatalf("expected preserved temperature 0.3, got %v", capturedBody["temperature"])
	}
	kwargs2, _ := capturedBody["chat_template_kwargs"].(map[string]any)
	if kwargs2["enable_thinking"] != true || kwargs2["extra"] != "keep" {
		t.Fatalf("expected preserved kwargs, got %#v", kwargs2)
	}
}

func TestProxyUnknownPath404AndBodyLimit(t *testing.T) {
	h := NewHandler("https://example.invalid/v1", nil)
	rec404 := httptest.NewRecorder()
	h.ServeHTTP(rec404, httptest.NewRequest(http.MethodPost, "/v1/unknown", strings.NewReader("{}")))
	if rec404.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec404.Code)
	}
	if got := rec404.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected CORS Allow-Origin * on 404, got %q", got)
	}

	rec405 := httptest.NewRecorder()
	h.ServeHTTP(rec405, httptest.NewRequest(http.MethodPut, "/v1/chat/completions", strings.NewReader("{}")))
	if rec405.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec405.Code)
	}
	if got := rec405.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected CORS Allow-Origin * on 405, got %q", got)
	}

	oversized := bytes.Repeat([]byte("a"), maxRequestBytes+10)
	rec413 := httptest.NewRecorder()
	h.ServeHTTP(rec413, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(oversized)))
	if rec413.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", rec413.Code)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestProxyEOFRetryAnd502Fallback(t *testing.T) {
	var attempts int32
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if atomic.AddInt32(&attempts, 1) == 1 {
				return nil, io.ErrUnexpectedEOF
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{"ok":true}`)),
			}, nil
		}),
	}
	h := NewHandler("https://example.invalid/v1", client)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"m"}`)))
	if rec.Code != http.StatusOK || atomic.LoadInt32(&attempts) != 2 {
		t.Fatalf("expected EOF retry recovery (2 attempts, 200), got attempts=%d code=%d", attempts, rec.Code)
	}

	failClient := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return nil, errors.New("dial tcp timeout")
		}),
	}
	hFail := NewHandler("https://example.invalid/v1", failClient)
	recFail := httptest.NewRecorder()
	hFail.ServeHTTP(recFail, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"m"}`)))
	if recFail.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream failure, got %d", recFail.Code)
	}
	if !strings.Contains(recFail.Body.String(), "dial tcp timeout") {
		t.Fatalf("expected upstream error JSON, got %q", recFail.Body.String())
	}
}

func TestStartServerRejectsInvalidPorts(t *testing.T) {
	for _, port := range []int{0, -1, 70000} {
		srv, err := StartServer(ProxyConfig{Host: "127.0.0.1", Port: port})
		if err == nil {
			_ = srv.Shutdown(t.Context())
			t.Fatalf("expected error for invalid port %d, got nil", port)
		}
	}
}

type partialErrorReader struct {
	sent bool
}

func (r *partialErrorReader) Read(p []byte) (int, error) {
	if !r.sent {
		r.sent = true
		n := copy(p, `{"partial":`)
		return n, nil
	}
	return 0, errors.New("upstream stream aborted")
}

func (r *partialErrorReader) Close() error { return nil }

func TestProxyMidStreamReadErrorPanicsAbortHandler(t *testing.T) {
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       &partialErrorReader{},
			}, nil
		}),
	}

	h := NewHandler("https://example.invalid/v1", client)
	rec := httptest.NewRecorder()

	defer func() {
		recovered := recover()
		if recovered == nil {
			t.Fatalf("expected panic(http.ErrAbortHandler), got nil")
		}
		err, ok := recovered.(error)
		if !ok || !errors.Is(err, http.ErrAbortHandler) {
			t.Fatalf("expected panic(http.ErrAbortHandler), got %#v", recovered)
		}
	}()

	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"m"}`)))
}
