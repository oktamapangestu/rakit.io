package ai

import (
	"strings"

	"rakit.io/server/internal/i18n"
)

// Prompt AI ditulis untuk pengguna berbahasa Indonesia. Untuk pengguna versi Inggris (/en), bahasa tulisan
// diganti dan contoh-contoh berbahasa Indonesia di prompt diminta diterjemahkan.
var englishPrompt = strings.NewReplacer(
	"in Indonesian (Bahasa Indonesia)", "in English",
	"in Indonesian", "in English",
	"plain Indonesian", "plain English",
	`Use "Pengunjung" and "Pemilik", never "Visitor"/"User"/"Admin".`, `Use "Visitor" and "Owner", never "User"/"Admin".`,
	`"Pengunjung", "Pemilik"`, `"Visitor", "Owner"`,
	`Refer to lines as "baris 12"`, `Refer to lines as "line 12"`,
	`("ya"/"tidak", "berhasil"/"gagal")`, `("yes"/"no", "success"/"failure")`,
	`(e.g. "ya"/"tidak")`, `(e.g. "yes"/"no")`,
	`labeled "ulang"`, `labeled "repeat"`,
)

const englishNote = "\n\nLANGUAGE: the user reads ENGLISH. Write every user-facing text (labels, notes, explanations, examples, " +
	"answers) in English. Indonesian examples in these instructions only show the format: translate them, never copy them."

// inLanguage menyesuaikan prompt (sistem atau pesan user) dengan bahasa pengguna.
func inLanguage(lang, prompt string) string {
	if lang != i18n.EN {
		return prompt
	}
	return englishPrompt.Replace(prompt) + englishNote
}
