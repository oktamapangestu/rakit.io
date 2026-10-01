// Server rakit.icu versi Go: aplikasi di rakit.icu dan website project di <slug>.rakit.icu.
// Padanan src/server.js. Lihat go/README.md.
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

	"rakit.icu/server/internal/admin"
	"rakit.icu/server/internal/ai"
	"rakit.icu/server/internal/aimodels"
	"rakit.icu/server/internal/aiqueue"
	"rakit.icu/server/internal/api"
	"rakit.icu/server/internal/app"
	"rakit.icu/server/internal/assistant"
	"rakit.icu/server/internal/auth"
	"rakit.icu/server/internal/billing"
	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/credits"
	"rakit.icu/server/internal/google"
	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/plans"
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
	if err := db.Migrate(); err != nil {
		log.Fatalf("menyiapkan database: %v", err)
	}
	go func() {
		for range time.Tick(time.Hour) {
			if err := db.DeleteExpiredSessions(); err != nil {
				log.Printf("membersihkan sesi: %v", err)
			}
		}
	}()
	site := sites.New(cfg, db)
	sessions := auth.New(cfg, db)
	limits := plans.New(cfg, db)
	projectDB := userdb.New(cfg, limits)
	pages := app.New(cfg, sessions)
	siteDB := siteapi.New(projectDB)
	history := versions.New(cfg, db, limits)
	models := aimodels.New(cfg, db)
	helper := assistant.New(cfg, db, limits)
	wallet := credits.New(cfg, db, limits)
	wallet.AddAssistantBalance = helper.AddBalance
	wallet.VisionEnabled = func() bool { return models.Get().Vision != "" }
	queue := aiqueue.New(cfg)
	editorAI := ai.New(cfg, db, wallet, limits, projectDB, history, models, queue)
	editorAI.Start()
	appAPI, err := api.New(cfg, db, sessions, api.Services{
		Plans: limits, UserDB: projectDB, Versions: history, Credits: wallet,
		Billing: billing.New(cfg, db, limits, wallet), AI: editorAI, AIModels: models, Assistant: helper,
		Admin: admin.New(cfg, db, limits, models, queue),
	})
	if err != nil {
		log.Fatal(err)
	}
	googleLogin := google.New(cfg, db, sessions)

	// Routing berdasarkan host:
	// - rakit.icu          -> halaman, aset, login Google, dan /api
	// - <slug>.rakit.icu   -> website project, /api/db, dan asisten AI
	// - www.rakit.icu      -> dialihkan permanen ke rakit.icu
	// - host lain (IP, …)  -> dialihkan ke rakit.icu
	under := func(p, prefix string) bool { return p == prefix || strings.HasPrefix(p, prefix+"/") }
	suffix := "." + cfg.BaseDomain
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := hostname(r)
		if host == cfg.BaseDomain {
			switch {
			case under(strings.ToLower(r.URL.Path), "/api"):
				appAPI.ServeHTTP(w, r)
			case google.Matches(r.URL.Path):
				googleLogin.ServeHTTP(w, r)
			case !pages.Serve(w, r):
				pages.NotFound(w)
			}
			return
		}
		sub, ok := strings.CutSuffix(host, suffix)
		switch {
		case !ok:
			// Akses lewat IP / host lain -> arahkan ke domain utama.
			http.Redirect(w, r, cfg.AppOrigin+r.URL.RequestURI(), http.StatusFound)
		case sub == "www":
			http.Redirect(w, r, cfg.AppOrigin+r.URL.RequestURI(), http.StatusMovedPermanently)
		case !usernameRE.MatchString(sub):
			http.Error(w, "Not found", http.StatusNotFound)
		case siteapi.Matches(r.URL.Path):
			siteDB.Serve(w, r, sub)
		case assistant.MatchesSite(r.URL.Path):
			helper.ServeSite(w, r, sub)
		case under(strings.ToLower(r.URL.Path), "/api"):
			// Seluruh /api/ di domain user dicadangkan untuk sistem.
			httpx.Fail(w, httpx.Errorf(404, "Endpoint tidak ditemukan"))
		default:
			site.Serve(w, r, sub)
		}
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

	log.Printf("rakit.icu berjalan di %s", cfg.AppOrigin)
	log.Printf("Website user: %s", cfg.SiteURL("<username>"))
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
