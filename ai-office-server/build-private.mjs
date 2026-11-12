/** Build a single self-contained Worker from explicitly selected public source files. Never load .env files. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1])) throw new Error('Usage: node ai-office-server/build-private.mjs [--out <output-directory>]');
const out = resolve(root, args[1] || 'artifacts/office-dist');
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const publicArtwork = ['/art/agents-team.webp', '/art/sky-library.webp'];
const sourceGuard = {
  name: 'explicit-public-source-only',
  setup(builder) {
    builder.onResolve({ filter: /^(?:https?:)?\/\// }, () => ({ errors: [{ text: 'External module or stylesheet dependencies are not allowed in the private office bundle.' }] }));
    builder.onResolve({ filter: /^\/art\// }, ({ path }) => publicArtwork.includes(path)
      ? { path, external: true }
      : { errors: [{ text: 'Unlisted artwork dependency: ' + path }] });
    builder.onLoad({ filter: /(?:^|[\\/])(?:\.env[^\\/]*|artifacts[\\/])/i }, () => ({ errors: [{ text: 'Private configuration and task artifacts must never be bundled.' }] }));
  },
};

const client = await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'src/office-entry.tsx')],
  outfile: resolve(out, 'office-client.js'),
  write: false,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'inline',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ BASE_URL: '/', VITE_PRIVATE_OFFICE_URL: '', DEV: false, PROD: true, MODE: 'production' }),
  },
  plugins: [sourceGuard],
  logLevel: 'silent',
});
const javascript = client.outputFiles.find(file => file.path.endsWith('.js'))?.contents;
const stylesheet = client.outputFiles.find(file => file.path.endsWith('.css'))?.contents;
if (!javascript || !stylesheet) throw new Error('The private office frontend did not emit JavaScript and CSS.');
const scriptPath = '/office-app-' + hash(javascript) + '.js';
const stylePath = '/office-app-' + hash(stylesheet) + '.css';
const favicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="19" fill="#edf3fc"/><path d="M18 42V24M30 47V17M43 40V26" fill="none" stroke="#6c8ed5" stroke-width="7" stroke-linecap="round"/></svg>';
const html = `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><meta name="description" content="信息书房的私密 AI 办公室，按任务动态分工、讨论与交付。"><title>小队办公室 · 信息书房</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${stylePath}"><script defer src="${scriptPath}"></script></head><body><div id="root"></div><noscript>请开启 JavaScript 后使用办公室。模型任务与密钥配置仅在登录后的私密空间中进行。</noscript></body></html>`;
const assets = [
  { path: '/', type: 'text/html; charset=utf-8', body: Buffer.from(html), cache: 'no-store' },
  { path: '/index.html', type: 'text/html; charset=utf-8', body: Buffer.from(html), cache: 'no-store' },
  { path: scriptPath, type: 'application/javascript; charset=utf-8', body: javascript, cache: 'private, max-age=31536000, immutable' },
  { path: stylePath, type: 'text/css; charset=utf-8', body: stylesheet, cache: 'private, max-age=31536000, immutable' },
  { path: '/favicon.svg', type: 'image/svg+xml', body: Buffer.from(favicon), cache: 'private, max-age=3600' },
];
for (const path of publicArtwork) {
  const body = await readFile(resolve(root, 'public', path.slice(1)));
  if (body.subarray(0, 4).toString() !== 'RIFF' || body.subarray(8, 12).toString() !== 'WEBP') throw new Error('Artwork is not a valid WebP file: ' + path);
  assets.push({ path, type: 'image/webp', body, cache: 'private, max-age=3600' });
}
const serialized = assets.map(asset => [asset.path, {
  type: asset.type, cache: asset.cache, etag: '"' + hash(asset.body) + '"', data: Buffer.from(asset.body).toString('base64'),
}]);
const workerSource = `
import api from './ai-office-server/worker.mjs';
const assets = new Map(${JSON.stringify(serialized)});
function bytes(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    // Keep the request intact: the owner-private gateway supplies identity, never this wrapper.
    if (path === '/api' || path.startsWith('/api/')) return api.fetch(request, env, context);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
    const asset = assets.get(path);
    if (!asset) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const headers = { 'Content-Type': asset.type, 'Cache-Control': asset.cache, ETag: asset.etag, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (asset.cache !== 'no-store' && request.headers.get('If-None-Match') === asset.etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : bytes(asset.data), { headers });
  }
};`;
const server = await build({
  stdin: { contents: workerSource, resolveDir: root, sourcefile: 'private-office-worker.mjs', loader: 'js' },
  outfile: resolve(out, 'server/index.js'),
  write: false,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'inline',
  plugins: [sourceGuard],
  logLevel: 'silent',
});
const worker = server.outputFiles[0]?.contents;
if (!worker) throw new Error('The private office Worker did not emit a module.');
const patterns = [/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/, /AIza[0-9A-Za-z_-]{30,}/, /gh[pousr]_[A-Za-z0-9]{20,}/];
// Inspect original readable assets as well as the final module, because client code is embedded as bytes.
const publicSources = [Buffer.from(worker).toString('utf8'), Buffer.from(javascript).toString('utf8'), Buffer.from(stylesheet).toString('utf8')];
if (publicSources.some(value => patterns.some(pattern => pattern.test(value)))) throw new Error('A credential-shaped value was found. Output was not written.');
await mkdir(resolve(out, 'server'), { recursive: true });
await writeFile(resolve(out, 'server/index.js'), worker);
const report = {
  entry: 'src/office-entry.tsx', output: relative(root, resolve(out, 'server/index.js')),
  workerBytes: worker.byteLength, javascriptBytes: javascript.byteLength, stylesheetBytes: stylesheet.byteLength,
  assets: assets.map(({ path, type, body }) => ({ path, type, bytes: body.byteLength })),
  secretsInlined: false, envFilesRead: false, externalRuntimeAssets: false,
};
await writeFile(resolve(out, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
