'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { Catalog } = require('./catalog');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body)
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8' });
}

function servePublic(urlPath, res) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
  const abs = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) {
    send(res, 403, 'forbidden');
    return;
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    send(res, 404, 'not found');
    return;
  }
  const ext = path.extname(abs);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}

function routeApi(catalog, reqUrl, res) {
  const { pathname, searchParams } = reqUrl;
  const query = Object.fromEntries(searchParams.entries());

  if (pathname === '/api/meta') {
    sendJson(res, 200, catalog.meta());
    return true;
  }
  if (pathname === '/api/search' || pathname === '/api/browse') {
    sendJson(res, 200, catalog.search(query));
    return true;
  }
  if (pathname === '/api/letters') {
    sendJson(res, 200, { letters: catalog.letters });
    return true;
  }
  if (pathname === '/api/facets') {
    sendJson(res, 200, {
      facets: catalog.facetSummary(),
      battles: catalog.postings('battle'),
      places: catalog.postings('place'),
      nisba: catalog.postings('nisba'),
      labels: catalog.postings('label'),
      authorities: catalog.postings('authority'),
      entry_kind: catalog.postings('entry_kind', { includeQism4: true }),
    });
    return true;
  }
  if (pathname === '/api/chapters') {
    sendJson(res, 200, { chapters: catalog.chapters() });
    return true;
  }
  const chapterMatch = pathname.match(/^\/api\/chapter\/(\d+)$/);
  if (chapterMatch) {
    const chapter = catalog.chapter(chapterMatch[1]);
    sendJson(res, chapter.error ? chapter.status || 404 : 200, chapter);
    return true;
  }
  if (pathname === '/api/quality') {
    sendJson(res, 200, {
      quality: catalog.quality,
      graph: catalog.graphReport,
      manifest: catalog.manifest,
    });
    return true;
  }

  const personMatch = pathname.match(/^\/api\/person\/([^/]+)(?:\/(text|graph|spans))?$/);
  if (personMatch) {
    const id = decodeURIComponent(personMatch[1]);
    const extra = personMatch[2];
    if (extra === 'text') {
      const raw = catalog.raw(id);
      sendJson(res, raw.error ? raw.status || 404 : 200, raw);
      return true;
    }
    if (extra === 'graph') {
      const person = catalog.person(id);
      if (person.error) {
        sendJson(res, person.status || 404, person);
        return true;
      }
      sendJson(res, 200, person.neighbors);
      return true;
    }
    if (extra === 'spans') {
      sendJson(res, 200, { person_id: id, spans: catalog.spansFor(id) });
      return true;
    }
    const payload = catalog.person(id);
    sendJson(res, payload.error ? payload.status || 404 : 200, payload);
    return true;
  }

  return false;
}

function createServer(catalog) {
  return http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'method not allowed');
        return;
      }
      if (reqUrl.pathname.startsWith('/api/')) {
        if (!routeApi(catalog, reqUrl, res)) sendJson(res, 404, { error: 'unknown endpoint' });
        return;
      }
      servePublic(reqUrl.pathname, res);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

async function startUi({ port = 4173, host = '127.0.0.1', log = console.error } = {}) {
  const catalog = new Catalog();
  catalog.load({ log });
  const server = createServer(catalog);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const addr = `http://${host}:${actualPort}`;
  log(`ui listening on ${addr}`);
  return { server, catalog, url: addr };
}

if (require.main === module) {
  const port = Number(process.env.UI_PORT) || 4173;
  startUi({ port }).catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { startUi, createServer };
