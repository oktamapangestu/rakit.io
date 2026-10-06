package fn

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rakit.io/server/internal/config"
)

func TestBlockedIP(t *testing.T) {
	for ip, want := range map[string]bool{
		"127.0.0.1": true, "10.1.2.3": true, "172.16.0.1": true, "192.168.1.1": true, "169.254.169.254": true,
		"100.64.0.1": true, "0.0.0.0": true, "::1": true, "fe80::1": true, "fd00::1": true, "::ffff:127.0.0.1": true,
		"8.8.8.8": false, "1.1.1.1": false, "2606:4700:4700::1111": false,
	} {
		if got := blockedIP(net.ParseIP(ip)); got != want {
			t.Errorf("%s: blocked = %v, mau %v", ip, got, want)
		}
	}
}

func TestFetchDiblokir(t *testing.T) {
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("rahasia internal")) }))
	defer local.Close()
	s := &Service{cfg: &config.Config{BaseDomain: "rakit.io"}, client: newClient(false, fetchTimeout)}
	arg := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	for _, c := range []struct{ url, want string }{
		{local.URL, "alamat internal tidak boleh dihubungi"},
		{"http://169.254.169.254/latest/meta-data/", "alamat internal tidak boleh dihubungi"},
		{"http://[::1]:9/", "alamat internal tidak boleh dihubungi"},
		{"http://localhost:9/", "alamat internal tidak boleh dihubungi"},
		{"file:///etc/passwd", "alamat harus http:// atau https://"},
		{"https://toko.rakit.io/api/fn/x", "tidak bisa memanggil website rakit.io"},
		{"https://rakit.io/", "tidak bisa memanggil website rakit.io"},
	} {
		_, err := s.fetch(context.Background(), []json.RawMessage{arg(c.url)})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, mau %q", c.url, err, c.want)
		}
	}
}
