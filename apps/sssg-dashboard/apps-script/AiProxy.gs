/**
 * Proxy Narasi AI untuk Dashboard SSSG Inti Warna.
 * Menyimpan token API di sisi server (Script Properties) supaya tim tidak perlu memasukkan token masing-masing.
 *
 * PEMASANGAN (sekali):
 *  1. Buka https://script.google.com → Proyek baru → tempel seluruh isi file ini ke Code.gs.
 *  2. Ikon roda gigi (Project Settings) → Script Properties → tambah:
 *       SYLOR_TOKEN = sk-…            (wajib)
 *       SYLOR_BASE  = https://api.sylorapi.com/v1   (opsional)
 *       SYLOR_MODEL = claude-fable-5  (opsional, model bawaan bila klien tidak mengirim model)
 *       RATE_PER_MIN = 10, RATE_PER_DAY = 300       (opsional, pembatas laju)
 *  3. Deploy → New deployment → Type: Web app → Execute as: Me → Who has access: Anyone → Deploy.
 *  4. Salin "Web app URL" (berakhiran /exec) → isi AI_PROXY_URL di public/config.js dashboard.
 *  Setiap kali kode ini diubah, buat deployment baru (Deploy → Manage deployments → edit → New version).
 */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty("SYLOR_TOKEN"); if (!token) return out_({ error: { message: "SYLOR_TOKEN belum diisi di Script Properties" } });
    var base = (props.getProperty("SYLOR_BASE") || "https://api.sylorapi.com/v1").replace(/\/+$/, "");
    var limitErr = rateLimit_(props); if (limitErr) return out_({ error: { message: limitErr } });
    var body = {}; try { body = JSON.parse(e.postData && e.postData.contents || "{}"); } catch (err) { return out_({ error: { message: "body bukan JSON" } }); }
    var headers = { Authorization: "Bearer " + token };
    if (body.action === "models") {
      var rm = UrlFetchApp.fetch(base + "/models", { method: "get", headers: headers, muteHttpExceptions: true });
      return out_(safeJson_(rm.getContentText()), rm.getResponseCode());
    }
    var payload = {
      model: body.model || props.getProperty("SYLOR_MODEL") || "claude-fable-5",
      messages: body.messages || [], temperature: body.temperature != null ? body.temperature : 0.3,
      max_tokens: Math.min(+body.max_tokens || 1200, 2000), stream: false
    };
    if (!payload.messages.length) return out_({ error: { message: "messages kosong" } });
    // Minta STREAM ke relay: koneksi terus mengalir sehingga tidak diputus oleh batas waktu relay untuk permintaan non-stream
    // ("连接超时"). Potongan SSE dirakit di sini menjadi satu respons chat.completion biasa.
    payload.stream = true; payload.stream_options = { include_usage: true };
    var r = UrlFetchApp.fetch(base + "/chat/completions", { method: "post", contentType: "application/json", headers: headers, payload: JSON.stringify(payload), muteHttpExceptions: true });
    var code = r.getResponseCode(), txt = r.getContentText();
    if (code >= 400 || txt.indexOf("data:") < 0) return out_(safeJson_(txt), code);
    return out_(assembleStream_(txt, payload.model));
  } catch (err) { return out_({ error: { message: "proxy: " + err.message } }); }
}
function assembleStream_(txt, model) {
  var content = "", finish = null, usage = null, id = null;
  txt.split(/\r?\n/).forEach(function (line) {
    if (line.indexOf("data:") !== 0) return; var d = line.slice(5).trim(); if (!d || d === "[DONE]") return;
    try { var j = JSON.parse(d); if (j.id) id = j.id; if (j.usage) usage = j.usage; var ch = j.choices && j.choices[0]; if (ch) { if (ch.delta && ch.delta.content) content += ch.delta.content; if (ch.finish_reason) finish = ch.finish_reason; } } catch (e) { }
  });
  if (!content) return { error: { message: "stream kosong: " + txt.slice(0, 200) } };
  return { id: id, object: "chat.completion", model: model, choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: finish || "stop" }], usage: usage };
}
function doGet() { return out_({ ok: true, service: "sssg-ai-proxy", hint: "gunakan POST" }); }
function rateLimit_(props) {
  var cache = CacheService.getScriptCache(); var perMin = +(props.getProperty("RATE_PER_MIN") || 10), perDay = +(props.getProperty("RATE_PER_DAY") || 300);
  var mk = "rl:m:" + Math.floor(Date.now() / 60000), dk = "rl:d:" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd");
  var m = +(cache.get(mk) || 0) + 1, d = +(cache.get(dk) || 0) + 1; cache.put(mk, String(m), 90); cache.put(dk, String(d), 86400);
  if (m > perMin) return "Terlalu banyak permintaan (maks " + perMin + "/menit). Coba lagi sebentar.";
  if (d > perDay) return "Kuota harian proxy habis (" + perDay + "/hari)."; return null;
}
function safeJson_(t) { try { return JSON.parse(t); } catch (e) { return { error: { message: String(t).slice(0, 300) || "respons kosong" } }; } }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
