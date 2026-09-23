// pakai: node shot.js <url> <out.png> [width]  — Chrome headless via CDP, tunggu data dimuat, screenshot full-page
const { spawn } = require("child_process"); const fs = require("fs");
const [url, out, W = "1440"] = process.argv.slice(2); const port = 9333 + Math.floor(Math.random() * 500);
const prof = process.env.TMPDIR + "/cdp-prof-" + port;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let ws, id = 0, pending = {}, exceptions = [];
  for (let i = 0; i < 40; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = t.find(x => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch (e) { } await sleep(250); }
  if (!ws) { console.log("CDP: chrome tidak merespons"); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.onopen = r);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } else if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: +W, height: 2600, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  const ev = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;
  let status = "", t0 = Date.now();
  while (Date.now() - t0 < 90000) { await sleep(700); status = await ev(`(document.getElementById('status')||{}).textContent||''`); if (status && !/^Memuat/.test(status)) break; }
  console.log(`  status: ${status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  await sleep(800);
  // headless tidak menjalankan rAF → paksa semua chart ke keadaan akhir tanpa animasi
  const n = await ev(`(()=>{let n=0;Object.values(Chart.instances).forEach(c=>{c.options.animation=false;c.update("none");n++;});return n;})()`); console.log(`  chart dipaksa final: ${n}`); await sleep(400);
  const h = await ev(`Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`);
  // tanpa resize setelah muat
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64")); console.log(`  screenshot ${W}x${Math.min(h, 6000)} → ${out}`);
  if (exceptions.length) console.log("  EXCEPTIONS:", exceptions.slice(0, 5).join("\n    ")); else console.log("  exceptions: tidak ada");
  ws.close(); chrome.kill(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { } process.exit(0);
})().catch(e => { console.log("ERR", e.message); chrome.kill(); process.exit(1); });
