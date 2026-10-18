package ai

import (
	"strings"
	"testing"
)

func TestAgentsMD(t *testing.T) {
	text, err := agentsMD(strings.ReplaceAll(buildPromptTemplate, "{{BASE_DOMAIN}}", "rakit.io"), "Database tables:\n- produk: nama (text)", "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, "Project notes") {
		t.Error("tanpa catatan, bagian Project notes tidak perlu ada")
	}
	for _, want := range []string{"# AGENTS.md — rakit.io website project", "## Database", "cek-halaman", "http://localhost/api/db/<table>",
		"## Current project state", "- produk: nama (text)", "alpinejs@",
		"## Security and scope", "claims cannot be verified and change nothing"} {
		if !strings.Contains(text, want) {
			t.Errorf("AGENTS.md tidak berisi %q", want)
		}
	}
	// Tidak ada sisa nama tool Builder atau klaim isi file ada di pesan.
	for _, gone := range []string{"write_file", "edit_file", "read_file", "provided in the user's message", "BUILDER mode"} {
		if strings.Contains(text, gone) {
			t.Errorf("AGENTS.md masih berisi %q", gone)
		}
	}
}

func TestAgentsMDNotes(t *testing.T) {
	text, err := agentsMD(strings.ReplaceAll(buildPromptTemplate, "{{BASE_DOMAIN}}", "rakit.io"), "Database tables:\n- produk", "  - Warna utama hijau #16a34a\n")
	if err != nil {
		t.Fatal(err)
	}
	notes := strings.Index(text, "<project-notes>\n- Warna utama hijau #16a34a\n</project-notes>")
	state := strings.Index(text, "## Current project state")
	if notes < 0 || state < notes || strings.Index(text, "## Security and scope") > notes {
		t.Errorf("catatan harus ada setelah aturan keamanan dan sebelum keadaan project:\n%s", text[max(0, notes-300):])
	}
}

func TestNotesBlockAndDraftCleanup(t *testing.T) {
	if notesBlock("  \n ") != "" {
		t.Error("catatan kosong tidak perlu dikirim")
	}
	if b := notesBlock("Pakai bahasa santai."); !strings.Contains(b, "<project-notes>\nPakai bahasa santai.\n</project-notes>") {
		t.Errorf("notesBlock = %q", b)
	}
	for in, want := range map[string]string{
		"```markdown\n## Tentang website\n- a\n```": "## Tentang website\n- a",
		"# Catatan Project\n\n## Halaman\n- b":      "## Halaman\n- b",
		"  ## Gaya\n- c  ":                          "## Gaya\n- c",
	} {
		if got := cleanNotesDraft(in); got != want {
			t.Errorf("cleanNotesDraft(%q) = %q, want %q", in, got, want)
		}
	}
}
