// Chhota web-proxy browser server. Chalane ke liye: node server.js
// Phir browser mein kholiye: http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = 3000;
const HOST = "127.0.0.1"; // sirf aapke apne computer par chalega

const BLOCKED_HOST = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i;
const DROP_HEADERS = new Set([
  "x-frame-options", "content-security-policy", "content-security-policy-report-only",
  "content-encoding", "content-length", "transfer-encoding", "set-cookie",
  "strict-transport-security", "connection", "keep-alive",
]);

const proxyUrl = (abs) => "/p?url=" + encodeURIComponent(abs);

function rewriteHtml(html, base) {
  // href / src / action ko proxy se guzaro
  html = html.replace(/(\s(?:href|src|action|poster)\s*=\s*)(["'])(.*?)\2/gis, (m, pre, q, val) => {
    const v = val.trim().replace(/&amp;/g, "&");
    if (!v || /^(javascript:|data:|mailto:|tel:|blob:|#)/i.test(v)) return m;
    try { return pre + q + proxyUrl(new URL(v, base).href) + q; } catch { return m; }
  });
  // meta CSP aur integrity hatao (warna rewrite hui files block ho jati hain)
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
  html = html.replace(/\sintegrity=(["']).*?\1/gi, "");

  const inject = `<script>(function(){
    var BASE=${JSON.stringify(base)};
    function px(u){ try{
      if(typeof u!=="string") u=String(u);
      if(u.indexOf("/p?url=")===0) return u;
      return "/p?url="+encodeURIComponent(new URL(u,BASE).href);
    }catch(e){return u;} }
    var of=window.fetch;
    window.fetch=function(i,o){ if(typeof i==="string"||i instanceof URL) i=px(i); return of.call(this,i,o); };
    var oo=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u){ arguments[1]=px(u); return oo.apply(this,arguments); };
    try{ window.parent.postMessage({proxyUrl:BASE},"*"); }catch(e){}
  })();</script>`;

  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  return inject + html;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function handleProxy(req, res, target) {
  let u;
  try { u = new URL(target); } catch { res.writeHead(400); return res.end("Galat URL"); }
  if (!/^https?:$/.test(u.protocol) || BLOCKED_HOST.test(u.hostname)) {
    res.writeHead(403); return res.end("Ye URL allowed nahi hai");
  }

  const headers = {
    "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
    "accept": req.headers["accept"] || "*/*",
    "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
  };
  const opts = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    opts.body = await readBody(req);
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
  }

  let r;
  try { r = await fetch(u.href, opts); }
  catch (e) { res.writeHead(502); return res.end("Site tak pahunch nahi paye: " + e.message); }

  // redirect ko bhi proxy ke andar rakho
  if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
    const loc = new URL(r.headers.get("location"), u.href).href;
    res.writeHead(302, { location: proxyUrl(loc) });
    return res.end();
  }

  const out = {};
  r.headers.forEach((v, k) => { if (!DROP_HEADERS.has(k.toLowerCase())) out[k] = v; });

  const type = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer());

  if (type.includes("text/html")) {
    const html = rewriteHtml(buf.toString("utf8"), u.href);
    out["content-type"] = "text/html; charset=utf-8";
    res.writeHead(r.status, out);
    return res.end(html);
  }
  res.writeHead(r.status, out);
  res.end(buf);
}

http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  if (reqUrl.pathname === "/p") {
    return handleProxy(req, res, reqUrl.searchParams.get("url") || "");
  }
  // baaki sab par browser ka UI do
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(__dirname, "index.html")));
}).listen(PORT, HOST, () => console.log(`Chalu hai: http://localhost:${PORT}`));
