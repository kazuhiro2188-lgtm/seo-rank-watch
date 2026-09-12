#!/usr/bin/env node
// 試験用サイトのビルド。生 HTML は必ずエスケープする（この製品の前提「生 HTML 無効」の実証）。
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const data = {}; let cur = null;
  for (const line of (m ? m[1] : '').split('\n')) {
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (top) { cur = top[1]; data[cur] = top[2].replace(/^"|"$/g, ''); if (top[2] === '') data[cur] = []; continue; }
    const q = /^\s+-\s+q:\s*"(.*)"$/.exec(line); if (q && Array.isArray(data[cur])) { data[cur].push({ q: q[1], a: '' }); continue; }
    const a = /^\s+a:\s*"(.*)"$/.exec(line); if (a && Array.isArray(data[cur]) && data[cur].length) data[cur].at(-1).a = a[1];
  }
  return { data, body: m ? m[2] : text };
}

function render(body) {
  return body.split('\n').map((l) => {
    if (/^## /.test(l)) return `<h2>${esc(l.slice(3))}</h2>`;
    if (/^- /.test(l)) return `<li>${esc(l.slice(2))}</li>`;
    return l.trim() ? `<p>${esc(l)}</p>` : '';
  }).join('\n');
}

mkdirSync('out', { recursive: true });
for (const f of readdirSync('content/articles').filter((x) => x.endsWith('.md'))) {
  const { data, body } = parse(readFileSync(join('content/articles', f), 'utf8'));
  if (data.draft === 'true') continue;
  const faqs = (Array.isArray(data.faqs) ? data.faqs : []).map((x) => `<dt>${esc(x.q)}</dt><dd>${esc(x.a)}</dd>`).join('');
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(data.title)}</title><meta name="description" content="${esc(data.description)}"></head><body><h1>${esc(data.title)}</h1><p>更新: ${esc(data.updatedAt ?? data.publishedAt ?? '')}</p>${render(body)}<dl>${faqs}</dl></body></html>\n`;
  writeFileSync(join('out', f.replace(/\.md$/, '.html')), html);
}
