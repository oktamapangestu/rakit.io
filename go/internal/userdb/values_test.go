package userdb

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"rakit.icu/server/internal/jsconv"
)

// testdata/js.json berisi jawaban Node (V8) untuk masukan yang sama, supaya konversi di Go
// terbukti sama dengan JavaScript: Date.parse + DATE_RE, Number(), dan Number.parseInt().
func TestMatchesJavaScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/js.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Dates [][2]any `json:"dates"`
		Nums  [][2]any `json:"nums"`
		Ints  [][2]any `json:"ints"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	for _, c := range data.Dates {
		if got := validDate(c[0].(string)); got != c[1].(bool) {
			t.Errorf("validDate(%q) = %v, JavaScript: %v", c[0], got, c[1])
		}
	}
	for _, c := range data.Nums {
		got := jsconv.Number(c[0].(string))
		switch want := c[1].(type) {
		case float64:
			if got != want {
				t.Errorf("jsNumber(%q) = %v, JavaScript: %v", c[0], got, want)
			}
		case string: // "NaN", "Infinity", "-Infinity"
			if (want == "NaN") != math.IsNaN(got) || (want == "Infinity") != math.IsInf(got, 1) || (want == "-Infinity") != math.IsInf(got, -1) {
				t.Errorf("jsNumber(%q) = %v, JavaScript: %v", c[0], got, want)
			}
		}
	}
	for _, c := range data.Ints {
		got, ok := jsconv.ParseInt(c[0].(string))
		want, isNumber := c[1].(float64)
		if ok != isNumber || (ok && float64(got) != want) {
			t.Errorf("jsParseInt(%q) = %v (%v), JavaScript: %v", c[0], got, ok, c[1])
		}
	}
}
