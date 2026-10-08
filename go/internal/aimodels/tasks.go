package aimodels

// Model per tugas: owner bisa memberi tugas tertentu (Builder, Plan, diagram, Baca Alur Kode, prediksi
// kode) model khusus beserta cadangannya — mis. model murah & cepat untuk prediksi kode, model terkuat
// untuk Builder. Tugas tanpa model khusus mengikuti model utama (atau, untuk prediksi kode, urutan
// lamanya). Disimpan terpisah ("ai_task_models") dari pengaturan model utama supaya bentuk "ai_models"
// tetap sama dengan server Node.

import (
	"encoding/json"
	"strings"

	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/jsconv"
)

// Tugas AI editor. Vision (membaca gambar) diatur lewat Models.Vision.
const (
	TaskBuilder  = "builder"
	TaskPlan     = "plan"
	TaskDiagram  = "diagram"
	TaskExplain  = "explain"
	TaskComplete = "complete"
	TaskVision   = "vision"
)

// TaskInfo: tugas yang bisa diberi model khusus, untuk dashboard.
type TaskInfo struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Default     string `json:"default"` // yang dipakai bila tidak diberi model khusus
}

var taskList = []TaskInfo{
	{TaskBuilder, "Builder", "Menulis, mengubah, dan menghapus file (tool calling). Butuh model yang kuat menulis kode.", "Model utama"},
	{TaskPlan, "Plan", "Menjawab pertanyaan dan menyusun rencana tanpa mengubah file.", "Model utama"},
	{TaskDiagram, "Diagram", "Membuat diagram alur, ERD, dan arsitektur dari kode project.", "Model utama"},
	{TaskExplain, "Baca Alur Kode", "Menjelaskan alur sebuah file dan menjawab pertanyaan lanjutan.", "Model utama"},
	{TaskComplete, "Prediksi kode", "Saran kode saat mengetik (autocomplete). Paling cocok model kecil & cepat.", "Model gambar, lalu model utama"},
}

func isTask(key string) bool {
	for _, t := range taskList {
		if t.Key == key {
			return true
		}
	}
	return false
}

// TaskModels: model khusus satu tugas. Model kosong = mengikuti default tugas itu.
type TaskModels struct {
	Model     string   `json:"model"`
	Fallbacks []string `json:"fallbacks"`
}

// Tasks: model khusus per tugas (hanya tugas yang diatur).
func (s *Service) Tasks() map[string]TaskModels {
	out := map[string]TaskModels{}
	raw, ok := s.db.Setting("ai_task_models")
	if !ok {
		return out
	}
	var saved map[string]TaskModels
	if json.Unmarshal([]byte(raw), &saved) != nil {
		return out
	}
	for key, t := range saved {
		if isTask(key) && t.Model != "" {
			if t.Fallbacks == nil {
				t.Fallbacks = []string{}
			}
			out[key] = t
		}
	}
	return out
}

// For: model utama & cadangan untuk sebuah tugas.
func (s *Service) For(task string) (primary string, fallbacks []string) {
	m := s.Get()
	if task == TaskVision {
		return m.Vision, m.VisionFallbacks
	}
	if t, ok := s.Tasks()[task]; ok {
		return t.Model, t.Fallbacks
	}
	if task == TaskComplete {
		// Urutan lama: AI_COMPLETE_MODEL, lalu model gambar (biasanya kecil & cepat), lalu model utama.
		if s.cfg.AI.CompleteModel != "" {
			return s.cfg.AI.CompleteModel, nil
		}
		if m.Vision != "" {
			return m.Vision, m.VisionFallbacks
		}
	}
	return m.Model, m.Fallbacks
}

// OrderFor: urutan model yang dicoba untuk sebuah tugas (yang sehat dulu, lihat Order).
func (s *Service) OrderFor(task string) []string {
	return s.Order(s.For(task))
}

// cleanTasks memeriksa model per tugas dari dashboard (input: { builder: { model, fallbacks }, … }).
// Tugas dengan model kosong tidak dicantumkan (kembali mengikuti default-nya).
func (s *Service) cleanTasks(input any) (map[string]TaskModels, error) {
	items, ok := input.(map[string]any)
	if !ok {
		return nil, httpx.Errorf(400, "Model per tugas tidak valid")
	}
	clean := map[string]TaskModels{}
	for _, info := range taskList {
		m, _ := items[info.Key].(map[string]any)
		model := strings.TrimSpace(jsconv.String(m["model"]))
		fallbacks, _ := list(m["fallbacks"])
		if model == "" {
			if len(fallbacks) > 0 {
				return nil, httpx.Errorf(400, "%s: isi modelnya dulu sebelum model cadangan", info.Label)
			}
			continue
		}
		if err := s.CheckRef(model); err != nil {
			return nil, httpx.Errorf(400, "%s: %s", info.Label, err.Error())
		}
		if len(fallbacks) > MaxFallbacks {
			return nil, httpx.Errorf(400, "%s: model cadangan maksimal %d", info.Label, MaxFallbacks)
		}
		seen := map[string]bool{model: true}
		for i, f := range fallbacks {
			if err := s.CheckRef(f); err != nil {
				return nil, httpx.Errorf(400, "%s cadangan %d: %s", info.Label, i+1, err.Error())
			}
			if seen[f] {
				return nil, httpx.Errorf(400, `%s: model "%s" tercantum dua kali`, info.Label, f)
			}
			seen[f] = true
		}
		clean[info.Key] = TaskModels{Model: model, Fallbacks: fallbacks}
	}
	return clean, nil
}
