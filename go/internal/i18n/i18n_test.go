package i18n

import (
	"fmt"
	"regexp"
	"testing"
)

func TestT(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Email tidak valid", "Invalid email"},
		{fmt.Sprintf("Maksimal %d project per akun. Hapus project lama untuk membuat yang baru.", 5), "At most 5 projects per account. Delete an old project to create a new one."},
		{fmt.Sprintf("%s sudah dipakai", "toko.rakit.io"), "toko.rakit.io is already taken"},
		{fmt.Sprintf("Kolom \"%s\" menunjuk ke %s id %d yang tidak ada", "produk", "produk", 7), "Column \"produk\" points to produk id 7, which doesn't exist"},
		{"Gagal menerapkan perubahan: disk penuh. File dikembalikan seperti semula.", "Couldn't apply the changes: disk penuh. Files were restored as they were."},
		{"Pesan yang tidak ada di kamus", "Pesan yang tidak ada di kamus"},
	}
	for _, c := range cases {
		if got := T(EN, c.in); got != c.want {
			t.Errorf("T(%q) = %q, mau %q", c.in, got, c.want)
		}
		if got := T(ID, c.in); got != c.in {
			t.Errorf("T(id, %q) berubah jadi %q", c.in, got)
		}
	}
}

func TestSystem(t *testing.T) {
	note := fmt.Sprintf("⚠️ **Perhatian:** AI juga mengubah bagian di luar blok yang kamu pilih (%s). "+
		"Cek dulu hasilnya di preview; kalau tidak sesuai, tekan **Batalkan**.", "style.css")
	got := System(EN, "Tombolnya sudah biru.\n\n"+note)
	want := "Tombolnya sudah biru.\n\n⚠️ **Note:** the AI also changed parts outside the blocks you selected (style.css). Check the result in the preview first; if it's not right, press **Undo**."
	if got != want {
		t.Errorf("System = %q", got)
	}
	if got := System(EN, "Halo, ini jawaban AI biasa."); got != "Halo, ini jawaban AI biasa." {
		t.Errorf("jawaban AI ikut berubah: %q", got)
	}
}

// Setiap terjemahan memakai kata kerja format yang sama banyaknya dengan teks aslinya.
func TestDictionaryVerbs(t *testing.T) {
	verbs := regexp.MustCompile(`%[-+# 0]*\d*(\.\d+)?[sdvqfxXg]`)
	for id, en := range en {
		if a, b := len(verbs.FindAllString(id, -1)), len(verbs.FindAllString(en, -1)); a != b {
			t.Errorf("%q: %d kata kerja format, terjemahannya %d", id, a, b)
		}
	}
}

func TestPath(t *testing.T) {
	for _, c := range [][3]string{{EN, "/", "/en"}, {EN, "/editor", "/en/editor"}, {ID, "/", "/"}, {ID, "/panduan", "/panduan"}} {
		if got := Path(c[0], c[1]); got != c[2] {
			t.Errorf("Path(%s, %s) = %s", c[0], c[1], got)
		}
	}
}
