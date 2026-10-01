// Package proxy meneruskan request yang belum ditangani Go ke server Node (migrasi bertahap).
package proxy

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// ToNode mengembalikan reverse proxy ke server Node. Host asli dipertahankan (Node merutekan
// berdasarkan host), dan jawaban streaming (progres AI, chat) diteruskan tanpa ditahan.
func ToNode(upstream string) (http.Handler, error) {
	target, err := url.Parse(upstream)
	if err != nil {
		return nil, err
	}
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.Host = r.In.Host
			// Teruskan rantai X-Forwarded-* dari Nginx; Node mempercayai proxy di loopback untuk IP pengunjung.
			r.Out.Header["X-Forwarded-For"] = r.In.Header["X-Forwarded-For"]
			proto := r.In.Header.Get("X-Forwarded-Proto")
			r.SetXForwarded()
			if proto != "" {
				r.Out.Header.Set("X-Forwarded-Proto", proto)
			}
			if real := r.In.Header.Get("X-Real-IP"); real != "" {
				r.Out.Header.Set("X-Real-IP", real)
			}
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("proxy: %s %s: %v", r.Method, r.URL.Path, err)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadGateway)
			w.Write([]byte(`{"error":"Server sedang dimulai ulang. Coba lagi sebentar lagi."}`))
		},
	}, nil
}
