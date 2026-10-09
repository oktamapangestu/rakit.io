package api

import (
	"strconv"
	"strings"

	"rakit.io/server/internal/ai"
	"rakit.io/server/internal/fn"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/publish"
)

// ---------- /api/ai ----------

func (h *Handler) ai(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	svc := h.svc.AI
	switch {
	case q.is("GET", "credits"):
		return q.json(200, h.svc.Credits.Info(q.user.ID))

	case q.is("GET", "threads"), q.is("GET", "threads", ":"), q.is("DELETE", "threads"), q.is("POST", "prompt"):
		project, err := h.loadProject(q)
		if err != nil {
			return err
		}
		var out any
		status := 200
		switch {
		case q.is("GET", "threads"):
			out, err = svc.Threads(q.user, project)
		case q.is("GET", "threads", ":"):
			out, err = svc.Thread(q.user, project, q.rest[1])
		case q.is("DELETE", "threads"):
			out, err = svc.DeleteThreads(q.user, project)
		default:
			// Prompt AI boleh membawa gambar (maks. 3 × ±2 MB base64), endpoint lain cukup 1 MB.
			q.bodyLimit = 10 * 1024 * 1024
			if err = q.load(); err == nil {
				status = 201
				out, err = svc.Prompt(q.user, project, q.body)
			}
		}
		if err != nil {
			return err
		}
		return q.json(status, ai.Localize(q.lang(), out))

	case q.is("POST", "complete"):
		if err := q.load(); err != nil {
			return err
		}
		out, err := svc.Complete(q.r.Context(), q.user, q.body, q.lang())
		if err != nil {
			return err
		}
		return q.json(200, out)

	// Baca Alur Kode: penjelasan tersimpan, buat penjelasan, dan tanya lanjutan (gratis, kuota harian).
	case q.is("GET", "explain"), q.is("POST", "explain"), q.is("POST", "explain", "ask"):
		project, err := h.loadProject(q)
		if err != nil {
			return err
		}
		var out any
		switch {
		case q.is("GET", "explain"):
			p, _ := q.param("path")
			out, err = svc.SavedExplanation(q.user, project, p, q.lang())
		default:
			if err = q.load(); err != nil {
				return err
			}
			if q.is("POST", "explain") {
				out, err = svc.Explain(q.r.Context(), q.user, project, q.body, q.lang())
			} else {
				out, err = svc.AskExplain(q.r.Context(), q.user, project, q.body, q.lang())
			}
		}
		if err != nil {
			return err
		}
		return q.json(200, out)

	case q.is("GET", "jobs", ":", "events"):
		return svc.Events(q.w, q.r, q.user, q.rest[1])

	case q.is("POST", "jobs", ":", "cancel"):
		if err := svc.Cancel(q.user, q.rest[1]); err != nil {
			return err
		}
		return q.json(200, map[string]bool{"ok": true})

	case q.is("POST", "messages", ":", "keep"):
		out, err := svc.Keep(q.user, q.rest[1])
		if err != nil {
			return err
		}
		return q.json(200, ai.Localize(q.lang(), out))

	case q.is("POST", "messages", ":", "revert"):
		out, err := svc.Revert(q.r.Context(), q.user, q.rest[1])
		if err != nil {
			return err
		}
		return q.json(200, ai.Localize(q.lang(), out))
	}
	return errNotFound
}

// ---------- /api/billing ----------

func (h *Handler) billing(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	svc, ctx := h.svc.Billing, q.r.Context()
	// packageId harus berupa teks; selain itu dianggap tidak ada.
	field := func(key string) string {
		s, _ := q.body[key].(string)
		return s
	}
	var status int
	var out any
	var err error
	switch {
	case q.is("GET", "packages"):
		return q.json(200, svc.Packages(q.user.ID))
	case q.is("GET", "payments", ":"):
		if out, err = svc.Payment(ctx, q.user, q.rest[1]); err != nil {
			return err
		}
		return q.json(200, out)
	case q.is("POST", "topup"), q.is("POST", "assistant-topup"), q.is("POST", "subscribe"):
		if err = q.load(); err != nil {
			return err
		}
		switch {
		case q.is("POST", "topup"):
			status, out, err = svc.Topup(ctx, q.user, field("packageId"))
		case q.is("POST", "assistant-topup"):
			status, out, err = svc.AssistantTopup(ctx, q.user, field("packageId"))
		default:
			status, out, err = svc.Subscribe(ctx, q.user, q.text("planId"))
		}
		if err != nil {
			return err
		}
		return q.json(status, out)
	}
	return errNotFound
}

// ---------- /api/assistant (pemilik website) ----------

func (h *Handler) assistant(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	var out any
	switch {
	case q.is("GET"):
		out, err = h.svc.Assistant.OwnerView(q.user, project)
	case q.is("PUT"):
		if err = q.load(); err == nil {
			out, err = h.svc.Assistant.Save(q.user, project, q.body)
		}
	default:
		return errNotFound
	}
	if err != nil {
		return err
	}
	return q.json(200, out)
}

// ---------- /api/admin (owner platform) ----------

// admin: dashboard pemilik platform — statistik, harga langganan & kredit gratis, provider & model AI editor,
// model asisten website, dan blokir website. Akses dibatasi ke email di ADMIN_EMAILS.
func (h *Handler) admin(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	if !h.cfg.IsAdmin(q.user.Email) {
		return httpx.Errorf(403, "Halaman ini khusus pemilik platform")
	}
	dash, helper := h.svc.Admin, h.svc.Assistant
	var out any
	var err error
	switch {
	case q.is("GET", "stats"):
		days := 30
		if values := q.r.URL.Query()["days"]; len(values) == 1 {
			if n := jsconv.Number(values[0]); n == 7 || n == 30 || n == 90 {
				days = int(n)
			}
		}
		out, err = dash.Stats(days)

	case q.is("GET", "plans"):
		out, err = dash.PlansView()
	case q.is("PUT", "plans"):
		if err = q.load(); err == nil {
			if err = dash.SavePlans(q.body); err == nil {
				out, err = dash.PlansView()
			}
		}

	// Provider AI: endpoint kompatibel OpenAI tambahan (selain bawaan .env). Model merujuknya dengan
	// "model@id". Tes = minta daftar model provider (tanpa biaya token).
	case q.is("GET", "ai-providers"):
		out = h.svc.AIModels.ProvidersView()
	case q.is("PUT", "ai-providers"):
		if err = q.load(); err == nil {
			out, err = h.svc.AIModels.SaveProviders(q.body)
		}
	case q.is("POST", "ai-providers", "test"):
		if err = q.load(); err == nil {
			out = h.svc.AIModels.TestProvider(q.r.Context(), q.body)
		}

	// Model AI editor: model utama & cadangan (dipakai saat model utama gangguan), juga untuk pembaca gambar.
	case q.is("GET", "ai-models"):
		out = h.svc.AIModels.View()
	case q.is("PUT", "ai-models"):
		if err = q.load(); err == nil {
			if _, err = h.svc.AIModels.Save(q.body); err == nil {
				out = h.svc.AIModels.View()
			}
		}

	// Asisten AI website: model (aktif/nonaktif, harga), saldo percobaan, website pemakai & blokir.
	case q.is("GET", "assistant"):
		out, err = helper.AdminView()
	case q.is("PUT", "assistant"):
		if err = q.load(); err == nil {
			if err = helper.SaveAdminSettings(q.body); err == nil {
				out, err = helper.AdminView()
			}
		}
	case q.is("POST", "assistant", "block"):
		if err = q.load(); err == nil {
			if err = helper.SetBlocked(jsconv.String(q.body["slug"]), jsconv.Truthy(q.body["blocked"])); err == nil {
				out, err = helper.AdminView()
			}
		}
	default:
		return errNotFound
	}
	if err != nil {
		return err
	}
	return q.json(200, out)
}

// ---------- /api/publish (publikasi manual: dev/prod) ----------

// publish: status mode publikasi project aktif, ganti mode, dan publikasikan versi dev ke website publik.
func (h *Handler) publish(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	svc, ctx := h.svc.Publish, q.r.Context()
	var out any
	switch {
	case q.is("GET"):
		out, err = svc.Status(ctx, project)
	case q.is("POST"):
		if err = q.load(); err == nil {
			out, err = svc.Publish(ctx, project, jsconv.Truthy(q.body["confirm"]))
		}
	case q.is("PUT", "mode"):
		if err = q.load(); err == nil {
			if busy, e := h.db.ActiveJobIn(project.ID); e != nil {
				return e
			} else if busy {
				return httpx.Errorf(409, "AI sedang bekerja di project ini. Tunggu selesai atau tekan Stop.")
			}
			out, err = svc.SetMode(ctx, project, q.text("mode"), jsconv.Truthy(q.body["confirm"]))
		}
	default:
		return errNotFound
	}
	if err != nil {
		return err
	}
	if st, ok := out.(*publish.Status); ok && st != nil {
		st.Localize(q.lang())
	}
	return q.json(200, map[string]any{"publish": out, "project": h.public(project)})
}

// ---------- /api/functions (fungsi serverless) ----------

// functions: daftar fungsi & rahasia project aktif, kelola rahasia, dan uji coba fungsi dari editor.
func (h *Handler) functions(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	svc := h.svc.Fn
	switch {
	case q.is("GET"):
	case q.is("PUT", "secrets"):
		if err := q.load(); err != nil {
			return err
		}
		if err := svc.SetSecret(project, q.text("name"), q.text("value")); err != nil {
			return err
		}
	case q.is("DELETE", "secrets", ":"):
		if err := svc.DeleteSecret(project, q.rest[1]); err != nil {
			return err
		}
	// Provider AI untuk library ai.* (API key milik pemilik project, tidak pernah dikirim balik).
	case q.is("PUT", "ai-providers"):
		if err := q.load(); err != nil {
			return err
		}
		if err := svc.SetProvider(project, fn.ProviderInput{
			Name: q.text("name"), Kind: q.text("kind"), BaseURL: q.text("baseUrl"), APIKey: q.text("apiKey"),
			Model: q.text("model"), EmbedModel: q.text("embedModel"), Default: jsconv.Truthy(q.body["default"]),
		}); err != nil {
			return err
		}
	case q.is("DELETE", "ai-providers", ":"):
		if err := svc.DeleteProvider(project, q.rest[1]); err != nil {
			return err
		}
	case q.is("POST", "ai-providers", ":", "test"):
		out, err := svc.TestProvider(q.r.Context(), project, q.rest[1])
		if err != nil {
			return err
		}
		return q.json(200, out)
	case q.is("PUT", ":", "schedule"):
		if err := q.load(); err != nil {
			return err
		}
		if err := svc.SetSchedule(project, strings.ToLower(q.rest[0]), q.text("cron")); err != nil {
			return err
		}
	case q.is("GET", "logs"):
		name, _ := q.param("name")
		limit, _ := strconv.Atoi(func() string { v, _ := q.param("limit"); return v }())
		logs, err := svc.Logs(project, name, limit)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"logs": logs})
	case q.is("POST", ":", "run"):
		if err := q.load(); err != nil {
			return err
		}
		out, err := svc.Try(q.r.Context(), project, strings.ToLower(q.rest[0]), q.text("method"), q.text("query"), q.text("body"))
		if err != nil {
			return err
		}
		return q.json(200, out)
	default:
		return errNotFound
	}
	out, err := svc.Overview(project)
	if err != nil {
		return err
	}
	return q.json(200, out)
}
