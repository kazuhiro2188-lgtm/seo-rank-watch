import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFetchedDomains } from '../scripts/lib/runlog.mjs';

test('extractFetchedDomains は WebFetch の URL と tool_result 内の URL のドメインを集める', () => {
  const lines = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://www.rival.example/post/1' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'See https://other.example/x and http://third.example' }] } }),
    'not json',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'https://ignored.example は本文' }] } }),
  ].join('\n');
  assert.deepEqual(extractFetchedDomains(lines).sort(), ['other.example', 'rival.example', 'third.example']);
  assert.deepEqual(extractFetchedDomains(''), []);
});
