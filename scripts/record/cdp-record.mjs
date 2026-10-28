#!/usr/bin/env node
// Records the Chrome you are already using, over its DevTools port, for as
// long as it runs: every tab's screencast is kept, and on stop one MP4 is
// made that follows the tab being shown (background tabs do not repaint).
// Attaching to the existing browser keeps its sign-ins; a fresh browser
// context, as `agent-browser record` makes, would not.
//
//   node scripts/record/cdp-record.mjs OUT_DIR [--port 9222] [--fps 8] [--match host1,host2]
//
// Stop with Ctrl-C or SIGTERM; it then writes OUT_DIR/recording.mp4.
// Start Chrome with --remote-debugging-port=9222 first.

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || `recording-${Date.now()}`;
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const port = Number(opt('port', 9222));
const fps = Number(opt('fps', 8));
const match = (opt('match', '') || '').split(',').filter(Boolean);
const framesDir = join(out, 'frames');
mkdirSync(framesDir, { recursive: true });
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); appendFileSync(join(out, 'events.log'), `${l}\n`); };

// Every frame from every tab, in arrival order: [ms, file].
const timeline = [];
const sessions = new Map(); // targetId -> { ws, url }
let seq = 0;
let stopping = false;

function wanted(t) {
  if (t.type !== 'page' || !t.webSocketDebuggerUrl) return false;
  if (/^(chrome|devtools|chrome-extension):/.test(t.url)) return false;
  return match.length === 0 || match.some((m) => t.url.includes(m));
}

function attach(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  sessions.set(t.id, { ws, url: t.url });
  ws.onopen = () => {
    send('Page.enable');
    send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
    log(`attached ${t.id.slice(0, 8)} ${t.url.slice(0, 100)}`);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Page.screencastFrame') {
      const { data, sessionId } = msg.params;
      // A scrolling log repaints ~50 times a second; keep at most fps of
      // them per tab, or a long run fills the disk (7 GB an hour unthinned).
      const now = Date.now();
      const s = sessions.get(t.id);
      if (s && now - (s.lastWrite || 0) < 1000 / fps) {
        send('Page.screencastFrameAck', { sessionId });
        return;
      }
      if (s) s.lastWrite = now;
      const file = join(framesDir, `${String(++seq).padStart(7, '0')}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      timeline.push([Date.now(), file]);
      send('Page.screencastFrameAck', { sessionId });
    } else if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) {
      sessions.get(t.id).url = msg.params.frame.url;
      log(`navigated ${t.id.slice(0, 8)} ${msg.params.frame.url.slice(0, 100)}`);
    }
  };
  ws.onclose = () => { sessions.delete(t.id); if (!stopping) log(`detached ${t.id.slice(0, 8)}`); };
  ws.onerror = () => {};
}

async function poll() {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    for (const t of targets) if (wanted(t) && !sessions.has(t.id)) attach(t);
  } catch (err) {
    log(`cannot reach Chrome on ${port}: ${err.message}`);
  }
}

// One video at a constant rate: each tick shows the newest frame so far.
function render() {
  if (timeline.length === 0) { log('no frames; nothing to render'); return; }
  const start = timeline[0][0];
  const end = timeline[timeline.length - 1][0] + 1000;
  const step = 1000 / fps;
  const lines = [];
  let i = 0;
  let last = timeline[0][1];
  let runFile = last;
  let run = 0;
  for (let t = start; t < end; t += step) {
    while (i < timeline.length && timeline[i][0] <= t) last = timeline[i++][1];
    if (last === runFile) { run++; continue; }
    lines.push(`file '${runFile.replace(/'/g, "'\\''")}'\nduration ${(run * step / 1000).toFixed(3)}`);
    runFile = last; run = 1;
  }
  lines.push(`file '${runFile}'\nduration ${(run * step / 1000).toFixed(3)}`, `file '${runFile}'`);
  const list = join(out, 'frames.txt');
  writeFileSync(list, lines.join('\n'));
  const mp4 = join(out, 'recording.mp4');
  log(`rendering ${timeline.length} frames, ${((end - start) / 1000).toFixed(0)}s, to ${mp4}`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${fps},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  log(r.status === 0 ? `wrote ${mp4}` : `ffmpeg failed (${r.status})`);
}

function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  for (const { ws } of sessions.values()) try { ws.close(); } catch { /* closing */ }
  render();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
log(`recording Chrome on ${port} into ${out} (${fps} fps${match.length ? `, tabs matching ${match.join(',')}` : ''})`);
await poll();
const timer = setInterval(poll, 3000);
if (existsSync(framesDir) && readdirSync(framesDir).length) log('frames dir was not empty');
