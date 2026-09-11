import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROW_LIMIT = 25000; // Search Console API の上限
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

const base64url = (s) => Buffer.from(s).toString('base64url');

/** RFC 7523 の JWT Bearer。外部 SDK を使わず Node 標準の crypto だけで署名する。 */
export function buildSignedJwt({ email, privateKey, scope }, issuedAt) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: issuedAt, exp: issuedAt + 3600 }));
  const input = `${header}.${claims}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey, 'base64url')}`;
}

export async function getAccessToken(email, privateKeyRaw) {
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n'); // Secrets に 1 行で貼った \n を戻す
  const jwt = buildSignedJwt({ email, privateKey, scope: SCOPE }, Math.floor(Date.now() / 1000));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google の認証に失敗（HTTP ${res.status}）: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()).access_token;
}

export async function fetchSearchAnalytics({ site, startDate, endDate, accessToken, country = null }) {
  const body = { startDate, endDate, dimensions: ['query', 'page'], rowLimit: ROW_LIMIT };
  if (country) body.dimensionFilterGroups = [{ filters: [{ dimension: 'country', operator: 'equals', expression: country }] }];
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Search Console の取得に失敗（HTTP ${res.status}・${site}）: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const rows = ((await res.json()).rows ?? []).map((r) => ({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position }));
  return { rows, truncated: rows.length === ROW_LIMIT };
}

/** 試験用: 終端日以降に差し替え行があればそれを使う。 */
export function fixtureRows(fixture, endDate) {
  const keys = Object.keys(fixture.fromEndDate ?? {}).filter((k) => k <= endDate).sort();
  return keys.length ? fixture.fromEndDate[keys.at(-1)] : (fixture.default ?? []);
}

export class ConfigError extends Error {}

export async function loadRows({ source, repoDir, config, window, env }) {
  if (source === 'fixture') {
    const f = JSON.parse(readFileSync(join(repoDir, 'data/seo/fixture-gsc.json'), 'utf8'));
    return { rows: fixtureRows(f, window.endDate), truncated: false };
  }
  const email = env.GSC_SERVICE_ACCOUNT_EMAIL, key = env.GSC_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !key) {
    throw new ConfigError('GSC の資格情報が未設定です（GSC_SERVICE_ACCOUNT_EMAIL / GSC_SERVICE_ACCOUNT_PRIVATE_KEY）。順位が 0 件なのではなく、そもそも取得できていません');
  }
  const accessToken = await getAccessToken(email, key);
  return fetchSearchAnalytics({ site: config.site, startDate: window.startDate, endDate: window.endDate, accessToken, country: config.country });
}
