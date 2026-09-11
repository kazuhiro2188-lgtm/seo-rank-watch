import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath } from './normalize.mjs';

export const DEFAULT_LIMITS = {
  minImpressions: 30, rank1Threshold: 1.3, worsenThreshold: 3.0, improveDelta: 1.0,
  maxAttemptsPerFile: 3, maxExtensions: 2,
  maxAddedLines: 60, maxDeletedRatio: 0.2, minOutputRatio: 0.7, japaneseRatioMin: 0.3,
};

const REQUIRED = ['site', 'baseUrl', 'contentDir', 'pathToFile', 'contentFormat', 'frontmatter', 'build', 'deploy'];

export function validateConfig(raw) {
  const missing = REQUIRED.filter((k) => raw[k] === undefined);
  if (missing.length) throw new Error(`seo.config.json に必須項目がありません: ${missing.join(', ')}`);
  if (raw.contentFormat !== 'markdown-plain') throw new Error(`contentFormat は markdown-plain のみ対応です（指定: ${raw.contentFormat}）`);
  if (!String(raw.pathToFile).includes('{path}')) throw new Error('pathToFile には {path} を含めてください');
  if (!Array.isArray(raw.frontmatter.editable)) throw new Error('frontmatter.editable は配列です');
  if (!['git-push', 'static-dir'].includes(raw.deploy?.type)) throw new Error(`deploy.type は git-push か static-dir です（指定: ${raw.deploy?.type}）`);
  return {
    language: 'ja', linkAllowlist: [], bannedWords: [], country: null,
    ...raw,
    limits: { ...DEFAULT_LIMITS, ...(raw.limits ?? {}) },
    keys: { warnAfterDays: 75, reissueAfterDays: 90, ...(raw.keys ?? {}) },
  };
}

export function loadConfig(repoDir) {
  const p = join(repoDir, 'seo.config.json');
  if (!existsSync(p)) throw new Error(`seo.config.json がありません: ${p}`);
  return validateConfig(JSON.parse(readFileSync(p, 'utf8')));
}

/** 対象パス → リポジトリ相対のファイルパス。トップページ・親ディレクトリ参照は対応外（null）。 */
export function resolveFile(config, targetPath) {
  const p = normalizePath(targetPath);
  if (!p || p === '/' || p.split('/').includes('..')) return null;
  const rel = config.pathToFile.replace('{path}', p.slice(1));
  return rel.startsWith(`${config.contentDir}/`) ? rel : null;
}
