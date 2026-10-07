package httpx

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
)

// ReadUpload membaca isi file upload (maks. limit byte) dari body request, dalam dua bentuk:
//   - file mentah: fetch(url, { method: 'POST', body: file })
//   - FormData (multipart/form-data): file pertama di dalamnya
//
// Content-Type selain multipart diabaikan: kode website sering memakai helper fetch yang selalu
// memasang application/json, padahal body-nya file. Body yang memang JSON ditolak dengan pesan jelas.
func ReadUpload(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	tooLarge := Errorf(413, "File terlalu besar (maks. %d MB)", limit/(1024*1024))
	incomplete := Errorf(400, "Request tidak lengkap")
	mediaType, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))

	if mediaType == "multipart/form-data" {
		// Ruang ekstra untuk header & field lain di dalam FormData.
		body := http.MaxBytesReader(w, r.Body, limit+64*1024)
		mr := multipart.NewReader(body, params["boundary"])
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				return nil, Errorf(400, `FormData tidak berisi file. Tambahkan dengan form.append("file", input.files[0])`)
			}
			if err != nil {
				return nil, uploadErr(err, tooLarge, incomplete)
			}
			if part.FileName() == "" {
				continue
			}
			data, err := io.ReadAll(io.LimitReader(part, limit+1))
			if err != nil {
				return nil, uploadErr(err, tooLarge, incomplete)
			}
			if int64(len(data)) > limit {
				return nil, tooLarge
			}
			return data, nil
		}
	}

	if r.ContentLength > limit {
		return nil, tooLarge
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		return nil, uploadErr(err, tooLarge, incomplete)
	}
	if trimmed := bytes.TrimSpace(data); len(trimmed) > 0 && strings.ContainsRune(`{["`, rune(trimmed[0])) {
		return nil, Errorf(400, `Kirim file gambarnya langsung sebagai body, bukan JSON: fetch(url, { method: "POST", body: input.files[0] })`)
	}
	return data, nil
}

func uploadErr(err error, tooLarge, incomplete *Error) error {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		return tooLarge
	}
	return incomplete
}
