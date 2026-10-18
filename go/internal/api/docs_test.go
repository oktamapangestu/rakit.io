package api

import (
	"reflect"
	"testing"
)

func TestAnalyzeFunction(t *testing.T) {
	code := `// Kirim pesanan ke Telegram.
// Dipanggil dari form checkout.
export default async function (req, { db, env, fetch, ai }) {
  if (req.method !== 'POST') return Response.json({ error: 'POST saja' }, { status: 405 });
  const { nama, hp: phone, ...lain } = req.body;
  const { TOKEN } = env;
  const kode = req.query.kode || req.query['ref'];
  const row = await db.insert('pesanan', { nama, total: req.body.total });
  await db.list('produk', {}); await db.get("produk", 1);
  const { text } = await ai.chat('ringkas ' + nama);
  await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', { body: { chat_id: env.CHAT_ID, text } });
  await fetch(` + "`https://API.Example.com:8443/x`" + `);
  return { ok: true, id: row.id };
}`
	d := analyzeFunction(code)
	check := func(name string, got, want any) {
		t.Helper()
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s = %#v, want %#v", name, got, want)
		}
	}
	check("summary", d.Summary, "Kirim pesanan ke Telegram. Dipanggil dari form checkout.")
	check("methods", d.Methods, []string{"POST"})
	check("query", d.Query, []string{"kode", "ref"})
	check("body", d.Body, []string{"total", "nama", "hp"})
	check("secrets", d.Secrets, []string{"TOKEN", "CHAT_ID"})
	check("tables", d.Tables, []docTableUse{{"pesanan", []string{"create"}}, {"produk", []string{"list", "view"}}})
	check("ai", d.AI, []string{"chat"})
	check("fetches", d.Fetches, []string{"api.telegram.org", "api.example.com"})

	block := analyzeFunction("/**\n * Laporan harian.\n */\nexport default async function (req) {\n switch (req.method) { case 'CRON': case 'GET': }\n}")
	check("block summary", block.Summary, "Laporan harian.")
	check("switch methods", block.Methods, []string{"GET", "CRON"})
	check("no summary", analyzeFunction("export default async () => 1 // bukan ringkasan").Summary, "")
}
