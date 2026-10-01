// Package jsconv meniru konversi nilai JavaScript (Number(), String(), parseInt, panjang string),
// supaya validasi di Go memberi hasil yang sama dengan server Node.
package jsconv

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

var decimalRE = regexp.MustCompile(`^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)$`)

// Number meniru Number(string).
func Number(s string) float64 {
	s = strings.TrimSpace(s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	if !decimalRE.MatchString(s) {
		return math.NaN()
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil && !math.IsInf(n, 0) {
		return math.NaN()
	}
	return n
}

// ToNumber meniru Number(value) untuk nilai hasil decode JSON. nil (null) → 0; pemanggil yang perlu
// membedakan undefined (NaN) memeriksa keberadaan kuncinya sendiri.
func ToNumber(v any) float64 {
	switch t := v.(type) {
	case nil:
		return 0
	case float64:
		return t
	case bool:
		if t {
			return 1
		}
		return 0
	case string:
		return Number(t)
	case []any:
		// Number([]) = 0, Number([x]) = Number(String(x)), lebih dari satu elemen = NaN.
		switch len(t) {
		case 0:
			return 0
		case 1:
			if _, nested := t[0].([]any); !nested {
				return Number(String(t[0]))
			}
			return ToNumber(t[0])
		}
	}
	return math.NaN()
}

// Truthy meniru Boolean(value) untuk nilai hasil decode JSON.
func Truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0 && !math.IsNaN(t)
	case string:
		return t != ""
	}
	return true
}

// String meniru String(value) untuk nilai hasil decode JSON. nil (null/undefined) → "".
func String(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		out, _ := json.Marshal(t)
		return string(out)
	case map[string]any:
		return "[object Object]"
	}
	return ""
}

var leadingIntRE = regexp.MustCompile(`^\s*([+-]?\d+)`)

// ParseInt meniru Number.parseInt(s, 10); ok = false bila hasilnya NaN.
func ParseInt(s string) (n int, ok bool) {
	m := leadingIntRE.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	f, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, false
	}
	return int(math.Max(math.Min(f, 1e15), -1e15)), true
}

func IsInteger(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n == math.Trunc(n) }

const MaxSafeInteger = 1<<53 - 1

// Len: panjang string seperti s.length di JavaScript (satuan UTF-16).
func Len(s string) int { return len(utf16.Encode([]rune(s))) }

// Slice meniru s.slice(0, n) (satuan UTF-16).
func Slice(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}
