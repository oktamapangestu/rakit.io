package httpx

import (
	"bytes"
	"errors"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadUpload(t *testing.T) {
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{1}, 200*1024)...) // > 64 KB batas JSON
	read := func(contentType string, body []byte) ([]byte, error) {
		r := httptest.NewRequest("POST", "/api/db/barang/upload?column=foto", bytes.NewReader(body))
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		return ReadUpload(httptest.NewRecorder(), r, 1024*1024)
	}
	status := func(err error) int {
		var e *Error
		if errors.As(err, &e) {
			return e.Status
		}
		return 0
	}

	for _, ct := range []string{"image/png", "", "application/json", "application/octet-stream"} {
		if got, err := read(ct, png); err != nil || !bytes.Equal(got, png) {
			t.Errorf("file mentah dengan Content-Type %q: err=%v", ct, err)
		}
	}

	var form bytes.Buffer
	mw := multipart.NewWriter(&form)
	mw.WriteField("nama", "Kue")
	fw, _ := mw.CreateFormFile("file", "kue.png")
	fw.Write(png)
	mw.Close()
	if got, err := read(mw.FormDataContentType(), form.Bytes()); err != nil || !bytes.Equal(got, png) {
		t.Errorf("FormData: err=%v", err)
	}

	var empty bytes.Buffer
	mw = multipart.NewWriter(&empty)
	mw.WriteField("nama", "Kue")
	mw.Close()
	if _, err := read(mw.FormDataContentType(), empty.Bytes()); status(err) != 400 || !strings.Contains(err.Error(), "tidak berisi file") {
		t.Errorf("FormData tanpa file: %v", err)
	}

	if _, err := read("application/json", []byte(`{"file":"data:image/png;base64,AAAA"}`)); status(err) != 400 || !strings.Contains(err.Error(), "bukan JSON") {
		t.Errorf("body JSON: %v", err)
	}

	big := append([]byte("\x89PNG"), make([]byte, 2*1024*1024)...)
	if _, err := read("image/png", big); status(err) != 413 {
		t.Errorf("file mentah terlalu besar: %v", err)
	}
	var bigForm bytes.Buffer
	mw = multipart.NewWriter(&bigForm)
	fw, _ = mw.CreateFormFile("file", "besar.png")
	fw.Write(big)
	mw.Close()
	if _, err := read(mw.FormDataContentType(), bigForm.Bytes()); status(err) != 413 {
		t.Errorf("FormData terlalu besar: %v", err)
	}
}
