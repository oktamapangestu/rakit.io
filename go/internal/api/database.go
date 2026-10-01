package api

import (
	"rakit.icu/server/internal/userdb"
)

const uploadLimit = 11 * 1024 * 1024

// rowBody: body JSON sebagai objek berurutan; isObject = false bila bukan objek / tidak ada.
func (q *request) rowBody() ([]userdb.Field, bool, error) {
	if err := q.load(); err != nil {
		return nil, false, err
	}
	if len(q.raw) == 0 {
		return nil, false, nil
	}
	return userdb.DecodeObject(q.raw)
}

// database: API editor database — hanya untuk pemilik project (sesi login di rakit.icu).
func (h *Handler) database(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	ctx, slug := q.r.Context(), project.Slug
	name := ""
	if len(q.rest) > 1 {
		name = q.rest[1]
	}

	switch {
	case q.is("GET", "tables"):
		tables, err := h.userdb.ListTables(ctx, slug)
		if err != nil {
			return err
		}
		usage, err := h.userdb.Usage(ctx, slug)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"tables": tables, "usage": usage})

	case q.is("POST", "tables"):
		if err := q.load(); err != nil {
			return err
		}
		table, err := h.userdb.CreateTable(ctx, slug, q.body)
		if err != nil {
			return err
		}
		return q.json(201, map[string]any{"table": table})

	case q.is("PATCH", "tables", ":"):
		if err := q.load(); err != nil {
			return err
		}
		table, err := h.userdb.UpdateTable(ctx, slug, name, q.body)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"table": table})

	case q.is("DELETE", "tables", ":"):
		if err := h.userdb.DeleteTable(ctx, slug, name); err != nil {
			return err
		}
		return q.json(200, map[string]bool{"ok": true})

	case q.is("POST", "tables", ":", "upload"):
		// Pemilik mengupload gambar untuk kolom bertipe image (dari tab Data).
		var buf []byte
		if !isJSON(q.r) {
			if buf, err = readLimited(q.w, q.r, uploadLimit); err != nil {
				return err
			}
		}
		column, _ := q.param("column")
		location, err := h.userdb.UploadImage(ctx, slug, name, column, buf, false)
		if err != nil {
			return err
		}
		return q.json(201, map[string]string{"url": location})

	case q.is("GET", "tables", ":", "rows"):
		opts := userdb.ListOptions{}
		seen := map[string]bool{}
		for _, f := range orderedQuery(q.r.URL.RawQuery) {
			if seen[f.Key] {
				continue
			}
			seen[f.Key] = true
			value := f.Value.(string)
			switch f.Key {
			case "limit":
				opts.Limit = value
			case "offset":
				opts.Offset = value
			case "sort":
				opts.Sort = value
			case "expand":
				opts.Expand = []string{value}
			default:
				opts.Filters = append(opts.Filters, f)
			}
		}
		result, err := h.userdb.ListRows(ctx, slug, name, opts)
		if err != nil {
			return err
		}
		return q.json(200, result)

	case q.is("POST", "tables", ":", "rows"):
		body, isObject, err := q.rowBody()
		if err != nil {
			return err
		}
		row, err := h.userdb.InsertRow(ctx, slug, name, body, isObject, false)
		if err != nil {
			return err
		}
		return q.json(201, map[string]any{"row": row})

	case q.is("PATCH", "tables", ":", "rows", ":"):
		body, isObject, err := q.rowBody()
		if err != nil {
			return err
		}
		row, err := h.userdb.UpdateRow(ctx, slug, name, q.rest[3], body, isObject, false)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"row": row})

	case q.is("DELETE", "tables", ":", "rows", ":"):
		if err := h.userdb.DeleteRow(ctx, slug, name, q.rest[3]); err != nil {
			return err
		}
		return q.json(200, map[string]bool{"ok": true})
	}
	return errNotFound
}
