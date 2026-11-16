#!/usr/bin/env node
// Server statis lokal untuk uji coba: menyajikan public/ dengan header yang SAMA dengan firebase.json (termasuk CSP).
//   node scripts/serve.cjs [port]   → http://localhost:8080
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "public");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "firebase.json"), "utf8")).hosting;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain" };
function globToRe(g) { // dukungan glob sederhana ala Firebase: **, *, @(a|b)
  let s = g.replace(/[.+^${}()|[\]\\]/g, (m) => (m === "(" || m === ")" || m === "|" ? m : "\\" + m));
  s = s.replace(/@\(([^)]*)\)/g, "($1)").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp("^/?" + s + "$");
}
function serve(port) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    const rel = "/" + path.relative(ROOT, file).split(path.sep).join("/");
    for (const h of cfg.headers || []) if (globToRe(h.source).test(rel)) for (const kv of h.headers) res.setHeader(kv.key, kv.value);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<h1>404</h1>"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => srv.listen(port, "127.0.0.1", () => resolve(srv)));
}
module.exports = { serve };
if (require.main === module) {
  const port = Number(process.argv[2] || 8080);
  serve(port).then(() => console.log(`ROP Gudang: http://localhost:${port}`));
}
