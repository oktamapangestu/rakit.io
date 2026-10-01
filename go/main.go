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

	"rakit.icu/server/internal/api"
	"rakit.icu/server/internal/app"
	"rakit.icu/server/internal/auth"
	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/google"
	"rakit.icu/server/internal/plans"
	"rakit.icu/server/internal/proxy"
	"rakit.icu/server/internal/siteapi"
	"rakit.icu/server/internal/sites"
	"rakit.icu/server/internal/store"
	"rakit.icu/server/internal/userdb"
	"rakit.icu/server/internal/versions"
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
	sessions := auth.New(cfg, db)
	limits := plans.New(db)
	projectDB := userdb.New(cfg, limits)
	pages := app.New(cfg, sessions)
	siteDB := siteapi.New(projectDB)
	appAPI, err := api.New(cfg, db, sessions, limits, projectDB, versions.New(cfg, db, limits))
	if err != nil {
		log.Fatal(err)
	}
	googleLogin := google.New(cfg, db, sessions)

	// Routing berdasarkan host:
	// - rakit.icu          -> halaman, aset, login Google, dan sebagian /api (Go); /api lainnya masih di Node
	// - <slug>.rakit.icu   -> website project & /api/db (Go); /api lainnya (asisten AI) masih di Node
	// - lainnya (www, host tak dikenal) -> Node
	under := func(p, prefix string) bool { return p == prefix || strings.HasPrefix(p, prefix+"/") }
	suffix := "." + cfg.BaseDomain
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := hostname(r)
		if host == cfg.BaseDomain {
			switch {
			case under(strings.ToLower(r.URL.Path), "/api"):
				// Akun, project, file, riwayat versi di Go; rute /api lain masih di Node.
				if api.Matches(r) {
					appAPI.ServeHTTP(w, r)
					return
				}
			case google.Matches(r.URL.Path):
				googleLogin.ServeHTTP(w, r)
				return
			case pages.Serve(w, r):
				return
			}
			node.ServeHTTP(w, r)
			return
		}
		if sub, ok := strings.CutSuffix(host, suffix); ok && sub != "www" && usernameRE.MatchString(sub) {
			switch {
			case siteapi.Matches(r.URL.Path):
				siteDB.Serve(w, r, sub)
				return
			case !under(r.URL.Path, "/api"):
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
