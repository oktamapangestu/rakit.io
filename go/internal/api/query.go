package api

import (
	"net/url"
	"strings"

	"rakit.icu/server/internal/userdb"
)

// orderedQuery membaca query string dengan urutan kunci terjaga.
func orderedQuery(raw string) []userdb.Field {
	var out []userdb.Field
	decode := func(s string) string {
		if d, err := url.QueryUnescape(s); err == nil {
			return d
		}
		return s
	}
	for _, pair := range strings.Split(raw, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		out = append(out, userdb.Field{Key: decode(key), Value: decode(value)})
	}
	return out
}
