// Server rakit.io versi Go: aplikasi di rakit.io dan website project di <slug>.rakit.io.
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

	"rakit.io/server/internal/admin"
	"rakit.io/server/internal/ai"
	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/aiqueue"
	"rakit.io/server/internal/api"
	"rakit.io/server/internal/app"
	"rakit.io/server/internal/assistant"
	"rakit.io/server/internal/auth"
	"rakit.io/server/internal/billing"
	"rakit.io/server/internal/config"
	"rakit.io/server/internal/credits"
	"rakit.io/server/internal/fn"
	"rakit.io/server/internal/google"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/plans"
	"rakit.io/server/internal/publish"
	"rakit.io/server/internal/siteapi"
	"rakit.io/server/internal/sites"
	"rakit.io/server/internal/store"
	"rakit.io/server/internal/userdb"
	"rakit.io/server/internal/versions"
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
	helper.Providers = models
	models.AssistantModels = func() [][2]string {
		var out [][2]string
		for _, m := range helper.Models() {
			out = append(out, [2]string{m.Name, m.Model})
		}
		return out
	}
	functions := fn.New(cfg, db, projectDB, limits)
	functions.StartScheduler(context.Background())
	wallet := credits.New(cfg, db, limits)
	wallet.AddAssistantBalance = helper.AddBalance
	wallet.VisionEnabled = func() bool { return models.Get().Vision != "" }
	wallet.AIEnabled = models.Enabled
	queue := aiqueue.New(cfg)
	editorAI := ai.New(cfg, db, wallet, limits, projectDB, history, models, queue)
	editorAI.ResolvePage = site.ResolvePage
	editorAI.SecretNames = functions.SecretNames
	editorAI.AIProviders = functions.AIProviderNames
	editorAI.FnStatus = functions.AIContext
	editorAI.Start()
	appAPI, err := api.New(cfg, db, sessions, api.Services{
		Plans: limits, UserDB: projectDB, Versions: history, Credits: wallet,
		Billing: billing.New(cfg, db, limits, wallet), AI: editorAI, AIModels: models, Assistant: helper,
		Admin:   admin.New(cfg, db, limits, models, queue),
		Publish: publish.New(cfg, db, projectDB),
		Fn:      functions,
	})
	if err != nil {
		log.Fatal(err)
	}
	googleLogin := google.New(cfg, db, sessions)
	go fn.Warm() // kompilasi mesin fungsi (±0,5 dtk) di latar, supaya eksekusi pertama tidak lambat

	// Routing berdasarkan host:
	// - rakit.io          -> halaman, aset, login Google, dan /api
	// - <slug>.rakit.io   -> website project, /api/db, dan asisten AI
	// - www.rakit.io      -> dialihkan permanen ke rakit.io
	// - host lain (IP, …)  -> dialihkan ke rakit.io
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
		slug, _ := strings.CutSuffix(sub, config.DevSuffix) // toko--dev = versi dev project "toko"
		switch {
		case !ok:
			// Akses lewat IP / host lain -> arahkan ke domain utama.
			http.Redirect(w, r, cfg.AppOrigin+r.URL.RequestURI(), http.StatusFound)
		case sub == "www":
			http.Redirect(w, r, cfg.AppOrigin+r.URL.RequestURI(), http.StatusMovedPermanently)
		case !usernameRE.MatchString(slug):
			http.Error(w, "Not found", http.StatusNotFound)
		case r.URL.Path == sites.ConsolePath:
			sites.ServeConsole(w, r)
		case siteapi.Matches(r.URL.Path):
			// Database versi yang sedang dibuka: prod di <slug>, dev di <slug>--dev.
			key := sub
			if target, err := site.Resolve(sub); err == nil && target != nil {
				key = target.DBKey
			}
			siteDB.Serve(w, r, key)
		case assistant.MatchesSite(r.URL.Path):
			helper.ServeSite(w, r, slug)
		case fn.Matches(r.URL.Path):
			var target *fn.Target
			if t, err := site.Resolve(sub); err == nil && t != nil {
				target = &fn.Target{Project: t.Project, Root: t.Root, DBKey: t.DBKey, Dev: t.Dev}
			}
			functions.Serve(w, r, target)
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

	log.Printf("rakit.io berjalan di %s", cfg.AppOrigin)
	log.Printf("Website user: %s", cfg.SiteURL("<username>"))
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
