import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
try { await stat(resolve(root, 'index.html')); }
catch { console.error('还没有构建文件。请先运行 npm install 和 npm run build。'); process.exit(1); }
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
});
const preferred = Number(process.env.PORT || 4173);
let port = preferred;
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port < preferred + 10) { port++; server.listen(port, '127.0.0.1'); }
  else { console.error('无法启动本机预览：', error.message); process.exit(1); }
});
server.listen(port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('\n信息书房已打开：' + url + '\n关闭此窗口或按 Ctrl+C 可停止预览。\n');
  if (process.argv.includes('--open')) {
    const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});
