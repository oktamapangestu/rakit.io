// Server rakit.icu versi Go. Selama migrasi bertahap, Go berdiri di depan: rute yang sudah dipindah
// ditangani di sini, sisanya diteruskan ke server Node (NODE_UPSTREAM). Lihat go/README.md.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/proxy"
	"rakit.icu/server/internal/sites"
	"rakit.icu/server/internal/store"
)

// Username = subdomain, jadi harus valid sebagai label DNS (sama dengan src/username.js).
var usernameRE = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`)

func hostname(r *http.Request) string {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.ToLower(host)
}

func main() {
	envFile := flag.String("env-file", "", "file .env yang dibaca bila ada")
	flag.Parse()
	if *envFile != "" {
		if err := config.LoadEnvFile(*envFile); err != nil {
			log.Fatalf("membaca %s: %v", *envFile, err)
		}
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	db, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	node, err := proxy.ToNode(cfg.NodeUpstream)
	if err != nil {
		log.Fatalf("NODE_UPSTREAM tidak valid: %v", err)
	}
	site := sites.New(cfg, db)

	// Routing berdasarkan host: <slug>.rakit.icu -> website project (Go), kecuali /api di domain itu.
	// Semua yang lain (aplikasi utama, API, www, host tak dikenal) masih ditangani Node.
	suffix := "." + cfg.BaseDomain
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := hostname(r)
		if sub, ok := strings.CutSuffix(host, suffix); ok && sub != "www" && usernameRE.MatchString(sub) {
			if p := r.URL.Path; p != "/api" && !strings.HasPrefix(p, "/api/") {
				site.Serve(w, r, sub)
				return
			}
		}
		node.ServeHTTP(w, r)
	})

	addr := net.JoinHostPort(os.Getenv("HOST"), cfg.Port)
	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 30 * time.Second}

	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()

	log.Printf("rakit.icu (Go) berjalan di %s — sisanya diteruskan ke Node %s", cfg.AppOrigin, cfg.NodeUpstream)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
