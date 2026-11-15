/* yScannor — servidor do clonador (sem dependências, Node 18+) */
'use strict';
const http = require('http'), https = require('https'), dns = require('dns'), net = require('net'), fs = require('fs'),
  os = require('os'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://yscanor.github.io').split(',').map(s => s.trim()).filter(Boolean);
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1'; // só para testes locais
const STATIC_DIR = [process.env.STATIC_DIR, path.join(__dirname, 'public'), path.join(__dirname, 'Syte'), path.join(__dirname, '..', 'Syte')]
  .filter(Boolean).find(d => fs.existsSync(path.join(d, 'index.html')));
const LIM = { fileBytes: 12 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, files: 1500, timeout: 15000, jobMs: 150000, conc: 6,
  jobsPerIp: 6, windowMs: 10 * 60 * 1000, globalJobs: 3 };
const PAGES = { 1: 1, 2: 40, 3: 150, 4: 250, 5: 400 };
const UA = 'Mozilla/5.0 (compatible; yScannorCloner/1.0)';
const SKIP_LINK = /\.(zip|rar|7z|tar|gz|exe|apk|iso|dmg|msi|mp4|mkv|avi|mov|mp3|wav)(\?|$)/i;

/* ---------- segurança de rede (SSRF) ---------- */
function v4Private(a) {
  const p = a.split('.').map(Number), x = p[0], y = p[1];
  return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && y === 0 && p[2] === 0) || (x === 192 && y === 168) || (x === 198 && (y === 18 || y === 19)) || x >= 224;
}
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return v4Private(ip);
  if (net.isIPv6(ip)) {
    let s; try { s = new URL('http://[' + ip + ']/').hostname.slice(1, -1).toLowerCase(); } catch (e) { return true; }
    if (s === '::1' || s === '::') return true;
    const m = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (m) { const a = parseInt(m[1], 16), b = parseInt(m[2], 16); return v4Private([a >> 8, a & 255, b >> 8, b & 255].join('.')); }
    return /^(fc|fd|fe[89ab]|ff)/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8');
  }
  return true;
}
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = ALLOW_PRIVATE ? addrs : addrs.filter(a => !isPrivateIP(a.address));
    if (!ok.length) return cb(new Error('Endereço bloqueado (rede privada)'));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}
function assertUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Só http e https são permitidos');
  if (u.username || u.password) throw new Error('URL com usuário/senha não é permitida');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (!ALLOW_PRIVATE && !['80', '443', '8080', '8443'].includes(port)) throw new Error('Porta não permitida');
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(h) && !ALLOW_PRIVATE && isPrivateIP(h)) throw new Error('Endereço bloqueado (rede privada)');
}

/* ---------- download ---------- */
function fetchBuf(urlStr, maxBytes, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); assertUrl(u); } catch (e) { return reject(new Error(e.message === 'Invalid URL' ? 'URL inválida' : e.message)); }
    let done = false; const fail = e => { if (!done) { done = true; reject(e); } };
    const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'GET', lookup: safeLookup, timeout: LIM.timeout,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'en-US,en;q=0.9' } }, res => {
      const st = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(st) && res.headers.location) {
        res.resume();
        if (redirects >= 5) return fail(new Error('Redirecionamentos demais'));
        let next; try { next = new URL(res.headers.location, u).href; } catch (e) { return fail(new Error('Redirecionamento inválido')); }
        done = true; return fetchBuf(next, maxBytes, redirects + 1).then(resolve, reject);
      }
      if (+res.headers['content-length'] > maxBytes) { res.destroy(); return fail(new Error('Arquivo grande demais')); }
      let s = res; const enc = (res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') s = res.pipe(zlib.createGunzip()); else if (enc === 'deflate') s = res.pipe(zlib.createInflate()); else if (enc === 'br') s = res.pipe(zlib.createBrotliDecompress());
      const chunks = []; let n = 0;
      s.on('data', c => { n += c.length; if (n > maxBytes) { fail(new Error('Arquivo grande demais')); req.destroy(); s.destroy(); } else chunks.push(c); });
      s.on('end', () => { if (!done) { done = true; resolve({ status: st, headers: res.headers, body: Buffer.concat(chunks), url: u.href }); } });
      s.on('error', fail);
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado')));
    req.on('error', fail); req.end();
  });
}

/* ---------- HTML / CSS ---------- */
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g;
const decEnt = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const encAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const skipRef = v => !v || /^(#|javascript:|data:|mailto:|tel:|sms:|blob:|about:|\{\{|<%)/i.test(v.trim());

function eachTag(html, tagFn, cssFn) {
  let out = '', i = 0; const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4), end = e < 0 ? n : e + 3; out += html.slice(lt, end); i = end; continue; }
    const m = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(lt, lt + 40));
    if (!m) { out += '<'; i = lt + 1; continue; }
    let j = lt + m[0].length, q = null;
    while (j < n) { const c = html[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    if (j >= n) { out += html.slice(lt); break; }
    const name = m[1].toLowerCase(), attrs = html.slice(lt + m[0].length, j), rep = tagFn(name, attrs);
    out += rep === undefined ? html.slice(lt, j + 1) : '<' + m[1] + rep + '>';
    i = j + 1;
    if (name === 'script' || name === 'style') {
      const re = new RegExp('</' + name, 'ig'); re.lastIndex = i; const mm = re.exec(html), end = mm ? mm.index : n, inner = html.slice(i, end);
      out += name === 'style' && cssFn ? cssFn(inner) : inner; i = end;
    }
  }
  return out;
}
function mapAttrs(attrs, fn) {
  let changed = false;
  const out = attrs.replace(ATTR_RE, (m, k, v1, v2, v3) => {
    const val = v1 !== undefined ? v1 : v2 !== undefined ? v2 : v3;
    if (val === undefined) return m;
    const r = fn(k.toLowerCase(), decEnt(val));
    if (r === undefined) return m;
    changed = true; return r === null ? '' : k + '="' + encAttr(r) + '"';
  });
  return changed ? out : undefined;
}
const REL_ASSET = /stylesheet|icon|preload|prefetch|manifest|apple-touch|modulepreload/i;
function refKind(tag, attr, rel) {
  if (attr === 'href') {
    if (tag === 'a' || tag === 'area') return 'page';
    if (tag === 'link') return REL_ASSET.test(rel) ? 'asset' : null;
    return null;
  }
  if (attr === 'srcset' || attr === 'data-srcset' || attr === 'imagesrcset') return 'srcset';
  if (attr === 'data' && tag !== 'object') return null;
  if (['src', 'poster', 'data-src', 'data-original', 'data-lazy-src', 'data-bg', 'data'].includes(attr)) return 'asset';
  return null;
}
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
function cssRefs(css) { const r = []; css.replace(CSS_URL, (m, a, b, c, d, e) => { const v = a || b || c || d || e; if (v && !skipRef(v)) r.push(v); return m; }); return r; }
function rewriteCss(css, fn) {
  return css.replace(CSS_URL, (m, a, b, c, d, e) => {
    const v = a || b || c || d || e; if (!v || skipRef(v)) return m; const r = fn(v); if (r === undefined) return m;
    return m.startsWith('@') ? '@import "' + r + '"' : 'url("' + r + '")';
  });
}
function extractHtml(html, base) {
  const bm = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html); let b = base; if (bm) { try { b = new URL(bm[1], base).href; } catch (e) {} }
  const refs = [];
  eachTag(html, (tag, attrs) => {
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(attrs) || [])[1] || '';
    mapAttrs(attrs, (k, v) => {
      if (k === 'style') { cssRefs(v).forEach(x => refs.push({ kind: 'asset', v: x })); return; }
      const kd = refKind(tag, k, rel); if (!kd) return;
      if (kd === 'srcset') v.split(',').forEach(p => { const u = p.trim().split(/\s+/)[0]; if (!skipRef(u)) refs.push({ kind: 'asset', v: u }); });
      else if (!skipRef(v)) refs.push({ kind: kd, v: v.trim() });
    });
  }, css => { cssRefs(css).forEach(x => refs.push({ kind: 'asset', v: x })); return css; });
  return { refs, base: b };
}
function rewriteHtml(html, base, resolveFn) {
  const bm = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html); let b = base; if (bm) { try { b = new URL(bm[1], base).href; } catch (e) {} }
  let out = eachTag(html, (tag, attrs) => {
    if (tag === 'base') return '';
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(attrs) || [])[1] || '';
    return mapAttrs(attrs, (k, v) => {
      if (k === 'integrity') return null;
      if (k === 'style') return rewriteCss(v, x => resolveFn(x, b));
      const kd = refKind(tag, k, rel); if (!kd || (kd !== 'srcset' && skipRef(v))) return;
      if (kd === 'srcset') return v.split(',').map(p => { const t = p.trim().split(/\s+/); const r = skipRef(t[0]) ? undefined : resolveFn(t[0], b); if (r !== undefined) t[0] = r; return t.join(' '); }).join(', ');
      return resolveFn(v.trim(), b);
    });
  }, css => rewriteCss(css, x => resolveFn(x, b)));
  out = out.replace(/<base\s*>/gi, '');
  if (!/<meta[^>]+charset/i.test(out)) out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + '<meta charset="utf-8">') : '<meta charset="utf-8">' + out;
  else out = out.replace(/(<meta[^>]+charset=["']?)[\w-]+/i, '$1utf-8');
  return out;
}

/* ---------- nomes locais + zip ---------- */
const clean = s => s.replace(/[<>:"|?*\\\u0000-\u001f]/g, '_').slice(0, 120);
function makeNamer(rootHost) {
  const used = new Set();
  return function (u, ct) {
    let p; try { p = decodeURIComponent(u.pathname); } catch (e) { p = u.pathname; }
    const segs = p.split('/').filter(s => s && s !== '.' && s !== '..').map(clean);
    const html = /html/.test(ct || '');
    if (p.endsWith('/') || !segs.length) segs.push('index.html');
    else if (html && !/\.html?$/i.test(segs[segs.length - 1])) { if (/\.[a-z0-9]{1,5}$/i.test(segs[segs.length - 1])) segs[segs.length - 1] += '.html'; else segs.push('index.html'); }
    if (u.search) { const h = crypto.createHash('md5').update(u.search).digest('hex').slice(0, 8), l = segs.length - 1, e = path.posix.extname(segs[l]); segs[l] = segs[l].slice(0, segs[l].length - e.length) + '_' + h + e; }
    let name = (u.host === rootHost ? rootHost.replace(/:/g, '_') : '_external/' + clean(u.host)) + '/' + segs.join('/'), k = 1;
    while (used.has(name.toLowerCase())) { const e = path.posix.extname(name); name = name.slice(0, name.length - e.length) + '_' + (k++) + e; }
    used.add(name.toLowerCase()); return name.slice(0, 240);
  };
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function buildZip(entries) {
  const parts = [], cen = []; let off = 0; const d = new Date();
  const dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entries) {
    const nm = Buffer.from(e.name, 'utf8'), raw = e.data, comp = zlib.deflateRawSync(raw, { level: 6 }), use = comp.length < raw.length,
      data = use ? comp : raw, method = use ? 8 : 0, crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dt, 10); lh.writeUInt16LE(dd, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dt, 12); ch.writeUInt16LE(dd, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    cen.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cs = cen.reduce((a, b) => a + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cs, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, ...cen, end]);
}

/* ---------- o clone ---------- */
const jobs = new Map(), hits = new Map(); let active = 0;
async function runJob(job, emit) {
  const start = new URL(job.url), root = start.host, namer = makeNamer(root), maxPages = PAGES[job.depth];
  const seen = new Set(), files = new Map(), map = new Map(), queue = []; let inflight = 0, pages = 0, errors = 0, bytes = 0, finished = 0, stop = false, firstErr = '';
  const deadline = Date.now() + LIM.jobMs;
  const norm = u => { u.hash = ''; return u.href; };
  function enqueue(href, kind, d) {
    let u; try { u = new URL(href); } catch (e) { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const k = norm(u); if (seen.has(k) || seen.size >= LIM.files) return;
    if (kind === 'page') { if (u.host !== root || pages >= maxPages || SKIP_LINK.test(u.pathname)) return; pages++; }
    seen.add(k); queue.push({ url: k, kind, d });
  }
  async function work(it) {
    emit('fetch', { url: it.url });
    try {
      const r = await fetchBuf(it.url, LIM.fileBytes);
      if (r.status >= 400) throw new Error('HTTP ' + r.status);
      const ct = (r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const final = new URL(r.url), isHtml = /html/.test(ct), isCss = /css/.test(ct) || (!ct && /\.css$/i.test(final.pathname));
      bytes += r.body.length; if (bytes > LIM.totalBytes) stop = true;
      const local = namer(final, isHtml ? 'text/html' : ct);
      const f = { local, kind: isHtml ? 'html' : isCss ? 'css' : 'bin', base: final.href, buf: r.body, ct };
      files.set(local, f); map.set(it.url, local); map.set(norm(new URL(final.href)), local);
      if (f.kind === 'html' || f.kind === 'css') {
        let text = r.body.toString(/charset=["']?(iso-8859|latin1|windows-125)/i.test((r.headers['content-type'] || '') + r.body.slice(0, 2048).toString('latin1')) ? 'latin1' : 'utf8');
        f.text = text;
        const refs = f.kind === 'html' ? extractHtml(text, final.href) : { refs: cssRefs(text).map(v => ({ kind: 'asset', v })), base: final.href };
        for (const x of refs.refs) { try { const u = new URL(x.v, refs.base); if (x.kind === 'page') { if (it.d < job.depth) enqueue(u.href, 'page', it.d + 1); } else enqueue(u.href, 'asset', it.d); } catch (e) {} }
      }
      finished++;
      emit('downloaded', { url: it.url, contentType: isHtml ? 'text/html' : ct || 'application/octet-stream', progress: Math.min(99, Math.round(100 * finished / (finished + queue.length + inflight))) });
    } catch (e) { errors++; finished++; if (!firstErr) firstErr = e.message; emit('error_item', { url: it.url, message: e.message }); }
  }
  enqueue(start.href, 'page', 1);
  await new Promise(resolve => {
    const pump = () => {
      if (job.cancelled) return resolve();
      if (Date.now() > deadline) stop = true;
      while (!stop && inflight < LIM.conc && queue.length) { const it = queue.shift(); inflight++; work(it).finally(() => { inflight--; pump(); }); }
      if (!inflight && (stop || !queue.length)) resolve();
    }; pump();
  });
  if (job.cancelled) return;
  if (!files.size) throw new Error(firstErr || 'Não foi possível baixar a página.');
  const resolveFor = fromLocal => (ref, base) => {
    let u; try { u = new URL(ref, base); } catch (e) { return undefined; }
    const hash = u.hash, local = map.get(norm(u)); u.hash = '';
    if (!local) return /^https?:$/.test(u.protocol) ? u.href + hash : undefined;
    const rel = path.posix.relative(path.posix.dirname(fromLocal), local) || path.posix.basename(local);
    return rel.split('/').map(encodeURIComponent).join('/') + hash;
  };
  const entries = [];
  for (const [name, f] of files) {
    let data = f.buf;
    if (f.kind === 'html') data = Buffer.from(rewriteHtml(f.text, f.base, resolveFor(name)), 'utf8');
    else if (f.kind === 'css') data = Buffer.from(rewriteCss(f.text, x => resolveFor(name)(x, f.base)), 'utf8');
    entries.push({ name, data });
  }
  entries.push({ name: root.replace(/:/g, '_') + '/_clone-info.txt', data: Buffer.from('Clonado por yScannor\nOrigem: ' + start.href + '\nData: ' + new Date().toISOString() + '\nUse apenas conteúdo que você tem permissão para copiar.\n') });
  const zipPath = path.join(os.tmpdir(), 'yscannor-' + job.id + '.zip');
  fs.writeFileSync(zipPath, buildZip(entries));
  jobs.set(job.id, { zipPath, name: start.hostname.replace(/[^\w.-]/g, '_') + '-clone.zip' });
  setTimeout(() => { jobs.delete(job.id); fs.unlink(zipPath, () => {}); }, 20 * 60 * 1000).unref();
  emit('done', { totalFiles: files.size, errors, domain: start.hostname, jobId: job.id });
}

/* ---------- servidor HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
function clientIp(req) { return ((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '?').trim(); }
function cors(req, res) {
  const o = req.headers.origin; if (!o) return true;
  let same = false; try { same = new URL(o).host === req.headers.host; } catch (e) {}
  if (same) return true;
  if (ALLOWED_ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); return true; }
  return false;
}
function serveStatic(req, res, pathname) {
  if (!STATIC_DIR) { res.writeHead(404); return res.end('Site não encontrado no servidor.'); }
  let p; try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  const base = path.resolve(STATIC_DIR), cands = [p, p + '.html', path.posix.join(p, 'index.html')];
  for (const c of cands) {
    const f = path.resolve(base, '.' + path.sep + path.normalize(c).replace(/^([/\\])+/, ''));
    if (!f.startsWith(base) || !fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'none'" });
    return fs.createReadStream(f).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Página não encontrada');
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), pn = url.pathname;
  if (req.method === 'OPTIONS') { if (cors(req, res)) { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' }); } else res.writeHead(403); return res.end(); }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (pn === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }

  if (pn === '/website-cloner/stream') {
    if (!cors(req, res)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const emit = (ev, d) => { if (!res.writableEnded) res.write('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n'); };
    const fail = m => { emit('clone_error', { message: m }); res.end(); };
    const target = (url.searchParams.get('url') || '').trim(), depth = Math.max(1, Math.min(5, parseInt(url.searchParams.get('depth'), 10) || 2));
    let ok = false; try { const u = new URL(/^[a-z]+:\/\//i.test(target) ? target : 'https://' + target); assertUrl(u); ok = target.length < 2000; } catch (e) { return fail(e.message === 'Invalid URL' ? 'URL inválida.' : e.message); }
    if (!ok) return fail('URL inválida.');
    const ip = clientIp(req), now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < LIM.windowMs);
    if (list.length >= LIM.jobsPerIp) return fail('Muitas clonagens em pouco tempo. Tente de novo em alguns minutos.');
    if (active >= LIM.globalJobs) return fail('Servidor ocupado. Tente de novo em instantes.');
    list.push(now); hits.set(ip, list);
    const job = { id: crypto.randomBytes(12).toString('hex'), url: /^[a-z]+:\/\//i.test(target) ? target : 'https://' + target, depth, cancelled: false };
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    req.on('close', () => { job.cancelled = true; clearInterval(ping); });
    active++;
    runJob(job, emit).catch(e => emit('clone_error', { message: e.message || 'Erro ao clonar.' })).finally(() => { active--; clearInterval(ping); res.end(); });
    return;
  }
  const dm = pn.match(/^\/website-cloner\/download\/([a-f0-9]{24})$/);
  if (dm) {
    if (!cors(req, res)) { res.writeHead(403); return res.end(); }
    const j = jobs.get(dm[1]);
    if (!j || !fs.existsSync(j.zipPath)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Arquivo expirado. Faça o clone de novo.'); }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(j.zipPath).size, 'Content-Disposition': 'attachment; filename="' + j.name + '"' });
    return fs.createReadStream(j.zipPath).pipe(res);
  }
  serveStatic(req, res, pn);
}).listen(PORT, () => console.log('yScannor server em http://localhost:' + PORT + (STATIC_DIR ? ' (site: ' + STATIC_DIR + ')' : ' (sem site estático)')));
