package api

import (
	"rakit.icu/server/internal/httpx"
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
		return q.json(status, out)

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
		return q.json(200, out)

	case q.is("POST", "messages", ":", "revert"):
		out, err := svc.Revert(q.r.Context(), q.user, q.rest[1])
		if err != nil {
			return err
		}
		return q.json(200, out)
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

// ---------- /api/admin/ai-models (owner platform) ----------

// adminModels: model AI editor — utama & cadangan (dipakai saat model utama gangguan), juga untuk
// pembaca gambar.
func (h *Handler) adminModels(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	if !h.cfg.IsAdmin(q.user.Email) {
		return httpx.Errorf(403, "Halaman ini khusus pemilik platform")
	}
	switch {
	case q.is("GET", "ai-models"):
	case q.is("PUT", "ai-models"):
		if err := q.load(); err != nil {
			return err
		}
		if _, err := h.svc.AIModels.Save(q.body); err != nil {
			return err
		}
	default:
		return errNotFound
	}
	return q.json(200, h.svc.AIModels.View())
}
