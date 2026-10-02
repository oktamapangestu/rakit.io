package fn

// fetch dari dalam fungsi: hanya ke internet publik. Alamat internal (loopback, jaringan privat,
// link-local termasuk metadata cloud 169.254.169.254, CGNAT) ditolak pada IP yang benar-benar dihubungi
// — juga setelah redirect — supaya tidak bisa diakali lewat DNS yang menunjuk ke alamat internal.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

const (
	maxFetches       = 10
	maxFetchBody     = 1 << 20 // body request
	maxFetchResponse = 2 << 20 // body jawaban
	fetchTimeout     = 8 * time.Second
)

var cgnat = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

func blockedIP(ip net.IP) bool {
	return ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast() || cgnat.Contains(ip)
}

var errBlocked = errors.New("alamat internal tidak boleh dihubungi dari fungsi")

func newClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if !allowPrivate && blockedIP(net.ParseIP(host)) {
				return errBlocked
			}
			return nil
		},
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 nil, // jangan lewat proxy lingkungan server
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: fetchTimeout,
			MaxIdleConns:          20,
			IdleConnTimeout:       30 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("terlalu banyak redirect")
			}
			return nil
		},
	}
}

type fetchInit struct {
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    *string           `json:"body"`
}

type fetchResult struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// fetch menjalankan satu permintaan keluar. baseDomain: domain platform (fungsi tidak boleh memanggil
// website rakit.io lain/dirinya sendiri, supaya tidak ada rantai pemanggilan tanpa akhir).
func (s *Service) fetch(ctx context.Context, args []json.RawMessage) (any, error) {
	var rawURL string
	var init fetchInit
	if len(args) < 1 || json.Unmarshal(args[0], &rawURL) != nil {
		return nil, errors.New("fetch: alamat tidak valid")
	}
	if len(args) > 1 {
		json.Unmarshal(args[1], &init)
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("fetch: alamat harus http:// atau https:// (%s)", rawURL)
	}
	host := strings.ToLower(u.Hostname())
	if base := s.cfg.BaseDomain; host == base || strings.HasSuffix(host, "."+base) {
		return nil, errors.New("fetch: fungsi tidak bisa memanggil website rakit.io (pakai db langsung)")
	}
	method := strings.ToUpper(init.Method)
	if method == "" {
		method = http.MethodGet
	}
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
	default:
		return nil, fmt.Errorf("fetch: metode %q tidak didukung", init.Method)
	}
	var body io.Reader
	if init.Body != nil {
		if len(*init.Body) > maxFetchBody {
			return nil, errors.New("fetch: body maksimal 1 MB")
		}
		body = strings.NewReader(*init.Body)
	}
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, fmt.Errorf("fetch: %v", err)
	}
	for k, v := range init.Headers {
		switch strings.ToLower(k) {
		case "host", "connection", "content-length", "transfer-encoding", "upgrade", "te", "trailer", "keep-alive", "proxy-authorization":
			continue
		}
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "rakit.io-fungsi")
	}
	resp, err := s.client.Do(req)
	if err != nil {
		if errors.Is(err, errBlocked) {
			return nil, fmt.Errorf("fetch: %v", errBlocked)
		}
		if ctx.Err() != nil {
			return nil, errors.New("fetch: server tujuan tidak menjawab tepat waktu")
		}
		return nil, fmt.Errorf("fetch: gagal menghubungi %s", host)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxFetchResponse+1))
	if err != nil {
		return nil, fmt.Errorf("fetch: jawaban terputus")
	}
	if len(data) > maxFetchResponse {
		return nil, errors.New("fetch: jawaban lebih dari 2 MB")
	}
	headers := map[string]string{}
	for k, v := range resp.Header {
		headers[strings.ToLower(k)] = strings.Join(v, ", ")
	}
	return fetchResult{Status: resp.StatusCode, Headers: headers, Body: string(data)}, nil
}
