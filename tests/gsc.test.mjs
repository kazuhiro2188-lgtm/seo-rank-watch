import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { buildSignedJwt, fixtureRows } from '../scripts/lib/gsc.mjs';

test('buildSignedJwt は RS256 で検証できる JWT を作る', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = buildSignedJwt({ email: 'sa@x.iam.gserviceaccount.com', privateKey: pem, scope: 's' }, 1_000);
  const [h, c, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.iss, 'sa@x.iam.gserviceaccount.com');
  assert.equal(claims.exp, 4_600);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, sig, 'base64url'));
});
test('fixtureRows は終端日以降の差し替えがあればそれを、無ければ default を返す', () => {
  const f = { default: [{ query: 'd' }], fromEndDate: { '2026-10-01': [{ query: 'oct' }], '2026-11-01': [{ query: 'nov' }] } };
  assert.deepEqual(fixtureRows(f, '2026-09-30'), [{ query: 'd' }]);
  assert.deepEqual(fixtureRows(f, '2026-10-01'), [{ query: 'oct' }]);
  assert.deepEqual(fixtureRows(f, '2026-12-25'), [{ query: 'nov' }]);
  assert.deepEqual(fixtureRows({ default: [] }, '2026-12-25'), []);
});
