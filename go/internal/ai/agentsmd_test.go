package ai

import (
	"strings"
	"testing"
)

func TestAgentsMD(t *testing.T) {
	text, err := agentsMD(strings.ReplaceAll(buildPromptTemplate, "{{BASE_DOMAIN}}", "rakit.io"), "Database tables:\n- produk: nama (text)")
	if err != nil {
		t.Fatal(err)
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
