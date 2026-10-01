package api

import (
	"os"
	"path"

	"rakit.io/server/internal/files"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/store"
)

func removeAll(dir string) error { return os.RemoveAll(dir) }

type fileEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Type string `json:"type"`
	Size *int64 `json:"size,omitempty"`
}

// pathField: body[key] bila berupa teks; selain itu "" (→ "Path wajib diisi").
func (q *request) pathField(key string) string {
	s, _ := q.body[key].(string)
	return s
}

// ---------- /api/files (milik project aktif) ----------

func (h *Handler) files(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	root := h.cfg.SiteRoot(project.Slug)
	limits := h.plans.StorageFor(project.Slug)
	// Sebelum file diubah, simpan versi otomatis (paling sering sekali per 10 menit).
	if !reading(q.r) {
		h.versions.AutoBeforeEdit(project, q.user.ID)
	}

	switch {
	case q.is("GET"):
		return h.listFiles(q, root, project)

	case q.is("GET", "content"):
		p, _ := q.param("path")
		content, err := files.ReadText(root, p)
		if err != nil {
			return err
		}
		return q.json(200, map[string]string{"content": content})

	case q.is("PUT", "content"):
		if err := q.load(); err != nil {
			return err
		}
		var content *string
		if s, ok := q.body["content"].(string); ok {
			content = &s
		}
		saved, err := files.WriteText(root, q.pathField("path"), content, false, limits)
		if err != nil {
			return err
		}
		return q.json(200, map[string]string{"path": saved})

	case q.is("POST"):
		if err := q.load(); err != nil {
			return err
		}
		var created string
		if q.body["type"] == "dir" {
			created, err = files.CreateDir(root, q.pathField("path"), limits)
		} else {
			empty := ""
			created, err = files.WriteText(root, q.pathField("path"), &empty, true, limits)
		}
		if err != nil {
			return err
		}
		return q.json(201, map[string]string{"path": created})

	case q.is("POST", "upload"):
		// Unggah gambar: body = isi file mentah, path & overwrite lewat query string.
		var buf []byte
		if !isJSON(q.r) {
			if buf, err = readLimited(q.w, q.r, files.MaxImageBytes+1024); err != nil {
				return err
			}
		}
		p, _ := q.param("path")
		overwrite, _ := q.param("overwrite")
		saved, err := files.WriteImage(root, p, buf, overwrite == "1", limits)
		if err != nil {
			return err
		}
		return q.json(201, map[string]string{"path": saved})

	case q.is("POST", "rename"):
		if err := q.load(); err != nil {
			return err
		}
		moved, err := files.RenameEntry(root, q.pathField("from"), q.pathField("to"))
		if err != nil {
			return err
		}
		return q.json(200, map[string]string{"path": moved})

	case q.is("DELETE"):
		p, _ := q.param("path")
		if err := files.RemoveEntry(root, p); err != nil {
			return err
		}
		return q.json(200, map[string]bool{"ok": true})
	}
	return errNotFound
}

func (h *Handler) listFiles(q *request, root string, project *store.Project) error {
	entries, err := files.ListTree(root)
	if err != nil {
		return err
	}
	out := make([]fileEntry, 0, len(entries))
	var size int64
	for _, e := range entries {
		item := fileEntry{Path: e.Path, Name: path.Base(e.Path), Type: "dir"}
		if !e.Dir {
			fileSize := e.Size
			item.Type, item.Size = "file", &fileSize
			size += e.Size
		}
		out = append(out, item)
	}
	return q.json(200, map[string]any{
		"files": out,
		"usage": map[string]any{"size": size, "entries": len(entries), "limits": files.LimitsOf(h.plans.StorageFor(project.Slug))},
	})
}

// ---------- /api/versions ----------

func (h *Handler) versionRoutes(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}

	switch {
	case q.is("GET"):
		list, history, err := h.versions.List(project)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"versions": list, "history": history})

	case q.is("POST"):
		if err := q.load(); err != nil {
			return err
		}
		id, err := h.versions.CreateManual(project, q.user.ID, q.text("label"))
		if err != nil {
			return err
		}
		return q.json(201, map[string]int64{"id": id})

	case q.is("GET", ":"):
		version, manifest, err := h.versions.Get(project, q.rest[0])
		if err != nil {
			return err
		}
		statuses, err := h.versions.Compare(project, manifest)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{
			"version": map[string]any{"id": version.ID, "kind": version.Kind, "label": version.Label, "createdAt": version.CreatedAt, "fileCount": version.FileCount},
			"files":   statuses,
		})

	case q.is("GET", ":", "file"):
		// Isi satu file di versi ini: teks sebagai JSON, gambar sebagai file.
		_, manifest, err := h.versions.Get(project, q.rest[0])
		if err != nil {
			return err
		}
		p, _ := q.param("path")
		rel, err := files.CleanPath(p)
		if err != nil {
			return err
		}
		entry, ok := manifest.Files[rel]
		if !ok {
			return httpx.Errorf(404, "File ini tidak ada di versi tersebut")
		}
		buf, err := h.versions.Blob(project.Slug, entry)
		if err != nil {
			return err
		}
		if files.IsImageFile(rel) {
			hd := q.w.Header()
			hd.Set("Content-Type", files.ImageTypes[files.Ext(rel)])
			hd.Set("Cache-Control", "private, max-age=86400") // isi versi tidak pernah berubah
			hd.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
			q.w.Write(buf)
			return nil
		}
		return q.json(200, map[string]string{"content": string(buf)})

	case q.is("POST", ":", "restore"):
		version, manifest, err := h.versions.Get(project, q.rest[0])
		if err != nil {
			return err
		}
		if err := q.load(); err != nil {
			return err
		}
		onlyPath := ""
		if raw, _ := q.body["path"].(string); raw != "" {
			if onlyPath, err = files.CleanPath(raw); err != nil {
				return err
			}
		}
		touched, err := h.versions.Restore(project, q.user.ID, version, manifest, onlyPath)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"touched": touched})
	}
	return errNotFound
}
