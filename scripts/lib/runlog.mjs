const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

/** claude -p --output-format stream-json のログから、AI が読んだページのドメインを集める。 */
export function extractFetchedDomains(logText) {
  const out = new Set();
  for (const line of logText.split('\n')) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    const content = ev?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'tool_use' && c?.name === 'WebFetch' && c?.input?.url) { const h = host(c.input.url); if (h) out.add(h); }
      if (c?.type === 'tool_result') {
        const txt = typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '');
        for (const u of txt.match(URL_RE) ?? []) { const h = host(u); if (h) out.add(h); }
      }
    }
  }
  return [...out];
}
