package ai

import (
	"maps"

	"rakit.io/server/internal/i18n"
)

// Localize menerjemahkan teks sistem di jawaban/event AI (pesan error, "Dihentikan. Kredit dikembalikan.",
// catatan perubahan di luar blok) ke bahasa pengguna. Jawaban AI sendiri tidak disentuh. Map aslinya tidak
// diubah (event job dibagikan ke semua pendengar), jadi yang dikembalikan adalah salinan.
func Localize(lang string, out any) any {
	if m, ok := out.(map[string]any); ok && lang != i18n.ID {
		return localizeMap(lang, m)
	}
	return out
}

func localizeMap(lang string, in map[string]any) map[string]any {
	m := maps.Clone(in)
	for _, key := range []string{"message", "userMessage", "assistantMessage"} {
		if msg, ok := m[key].(map[string]any); ok {
			m[key] = localizeMessage(lang, msg)
		}
	}
	if list, ok := m["messages"].([]map[string]any); ok {
		out := make([]map[string]any, len(list))
		for i, msg := range list {
			out[i] = localizeMessage(lang, msg)
		}
		m["messages"] = out
	}
	if s, ok := m["error"].(string); ok {
		m["error"] = i18n.T(lang, s)
	}
	return m
}

func localizeMessage(lang string, in map[string]any) map[string]any {
	msg := maps.Clone(in)
	if e, ok := msg["error"].(*string); ok && e != nil {
		t := i18n.T(lang, *e)
		msg["error"] = &t
	}
	if c, ok := msg["content"].(string); ok && msg["role"] == "assistant" {
		msg["content"] = i18n.System(lang, c)
	}
	return msg
}
