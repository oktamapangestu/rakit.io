package api

import "testing"

func TestNewerVersion(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"0.1.12", "0.1.9", true},
		{"0.1.9", "0.1.12", false},
		{"0.2.0", "0.1.99", true},
		{"0.1.5", "0.1.5", false},
		{"1.0", "0.9.9", true},
		{"0.1.5", "0.1.5.0", false},
	} {
		if got := newerVersion(c.a, c.b); got != c.want {
			t.Errorf("newerVersion(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}
