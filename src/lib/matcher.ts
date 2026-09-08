/**
 * Chrome match-pattern parsing, specificity scoring and folder resolution.
 * Pure functions only. Plan §5.1 / §5.2.
 */
import type { Folder } from './schema';
import { depthOf } from './tree';

export interface ParsedPattern {
  raw: string;
  /** '*' means http or https */
  scheme: '*' | 'http' | 'https' | 'file' | 'ftp';
  /** lower-cased host without a leading '*.' ; '' for file: ; '*' for any host */
  host: string;
  /** true for `*.example.com` (matches example.com and all subdomains) */
  subdomainWildcard: boolean;
  /** true for host `*` or <all_urls> */
  anyHost: boolean;
  /** path pattern including the leading '/', may contain '*' */
  path: string;
  allUrls: boolean;
}

const SCHEMES = new Set(['*', 'http', 'https', 'file', 'ftp']);

/** Parse a Chrome match pattern. Returns null when invalid. */
export function parsePattern(input: string): ParsedPattern | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw === '<all_urls>') {
    return { raw, scheme: '*', host: '*', subdomainWildcard: false, anyHost: true, path: '/*', allUrls: true };
  }
  const m = /^([a-z*]+):\/\/([^/]*)(\/.*)?$/i.exec(raw);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  if (!SCHEMES.has(scheme)) return null;
  let hostPart = m[2]!.toLowerCase();
  const path = m[3] ?? '';
  if (!path.startsWith('/')) return null;
  if (scheme === 'file') {
    if (hostPart !== '') return null;
    return { raw, scheme: 'file', host: '', subdomainWildcard: false, anyHost: false, path, allUrls: false };
  }
  if (hostPart === '') return null;
  // strip an explicit port; Chrome patterns ignore ports for matching in practice, and admins rarely type them
  hostPart = hostPart.replace(/:\d+$/, '');
  let subdomainWildcard = false;
  let anyHost = false;
  if (hostPart === '*') {
    anyHost = true;
  } else if (hostPart.startsWith('*.')) {
    subdomainWildcard = true;
    hostPart = hostPart.slice(2);
    if (!hostPart || hostPart.includes('*')) return null;
  } else if (hostPart.includes('*')) {
    return null;
  }
  if (!anyHost && !/^[a-z0-9.-]+$/.test(hostPart)) return null;
  return {
    raw,
    scheme: scheme as ParsedPattern['scheme'],
    host: anyHost ? '*' : hostPart,
    subdomainWildcard,
    anyHost,
    path,
    allUrls: false,
  };
}

export function isValidPattern(p: string): boolean {
  return parsePattern(p) !== null;
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 's');
}

function schemeMatches(p: ParsedPattern, scheme: string): boolean {
  if (p.allUrls) return true;
  if (p.scheme === '*') return scheme === 'http' || scheme === 'https';
  return p.scheme === scheme;
}

function hostMatches(p: ParsedPattern, host: string): boolean {
  if (p.anyHost) return true;
  const h = host.toLowerCase();
  if (p.subdomainWildcard) return h === p.host || h.endsWith('.' + p.host);
  return h === p.host;
}

/** Chrome matches the path pattern against path + query string; the fragment is ignored. */
function pathMatches(p: ParsedPattern, url: URL): boolean {
  const target = url.pathname + url.search;
  return globToRegExp(p.path).test(target);
}

export function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function matches(pattern: string | ParsedPattern, url: string | URL): boolean {
  const p = typeof pattern === 'string' ? parsePattern(pattern) : pattern;
  const u = typeof url === 'string' ? parseUrl(url) : url;
  if (!p || !u) return false;
  const scheme = u.protocol.replace(/:$/, '');
  return schemeMatches(p, scheme) && hostMatches(p, u.hostname) && pathMatches(p, u);
}

/** Number of path segments that contain at least one literal character. */
export function literalSegments(path: string): number {
  return path
    .split('/')
    .filter((seg) => seg.length > 0)
    .filter((seg) => seg.replace(/\*/g, '').length > 0).length;
}

function literalChars(path: string): number {
  return path.replace(/\*/g, '').replace(/^\//, '').length;
}

/**
 * Specificity tiers, most specific first (plan §5.1):
 *   1. exact host + specific path        4. subdomain wildcard + '/*'
 *   2. exact host + '/*'                 5. any host / everything else
 *   3. subdomain wildcard + specific path
 * Within a tier, more literal path segments win, then more literal characters.
 * Returns null when the pattern does not match (or is invalid).
 */
export function score(pattern: string | ParsedPattern, url: string | URL): number | null {
  const p = typeof pattern === 'string' ? parsePattern(pattern) : pattern;
  const u = typeof url === 'string' ? parseUrl(url) : url;
  if (!p || !u || !matches(p, u)) return null;
  const specificPath = p.path !== '/*' && p.path !== '/';
  let tier: number;
  if (p.anyHost) tier = 5;
  else if (p.subdomainWildcard) tier = specificPath ? 3 : 4;
  else tier = specificPath ? 1 : 2;
  const segs = Math.min(literalSegments(p.path), 99);
  const chars = Math.min(literalChars(p.path), 999);
  return (6 - tier) * 1_000_000 + segs * 1_000 + chars;
}

export interface Match {
  folder: Folder;
  pattern: string;
  score: number;
}

/**
 * Best-matching folder for a URL. Depth-blind; children compete equally.
 * Children do NOT inherit parent patterns. Ties: folder order, then shallower depth.
 */
export function bestMatch(folders: readonly Folder[], url: string | URL): Match | null {
  const u = typeof url === 'string' ? parseUrl(url) : url;
  if (!u) return null;
  let best: Match | null = null;
  let bestDepth = Infinity;
  for (const folder of folders) {
    for (const pattern of folder.urlPatterns) {
      const s = score(pattern, u);
      if (s === null) continue;
      const depth = depthOf(folders, folder.id);
      const better =
        !best ||
        s > best.score ||
        (s === best.score && folder.order < best.folder.order) ||
        (s === best.score && folder.order === best.folder.order && depth < bestDepth);
      if (better) {
        best = { folder, pattern, score: s };
        bestDepth = depth;
      }
    }
  }
  return best;
}

/** All matching folders, best first (for the pattern tester / debugging). */
export function allMatches(folders: readonly Folder[], url: string | URL): Match[] {
  const u = typeof url === 'string' ? parseUrl(url) : url;
  if (!u) return [];
  const out: Match[] = [];
  for (const folder of folders) {
    let top: Match | null = null;
    for (const pattern of folder.urlPatterns) {
      const s = score(pattern, u);
      if (s !== null && (!top || s > top.score)) top = { folder, pattern, score: s };
    }
    if (top) out.push(top);
  }
  return out.sort((a, b) => b.score - a.score || a.folder.order - b.folder.order);
}

/** Sentinel override meaning "the user pinned the root view". */
export const ROOT_OVERRIDE = '__root__';

export type Resolution =
  | { kind: 'override'; folderId: string | null }
  | { kind: 'match'; folderId: string; host: string; pattern: string }
  | { kind: 'none'; folderId: null };

/**
 * Selection precedence on popup open (plan §5.2):
 *   1. session override for this tab + origin
 *   2. best auto-match
 *   3. root view
 */
export function resolveFolder(folders: readonly Folder[], url: string | null, override: string | null | undefined): Resolution {
  if (override) {
    if (override === ROOT_OVERRIDE) return { kind: 'override', folderId: null };
    if (folders.some((f) => f.id === override)) return { kind: 'override', folderId: override };
    // Folder was deleted since the override was set — fall through to auto-match.
  }
  if (url) {
    const m = bestMatch(folders, url);
    if (m) {
      const u = parseUrl(url);
      return { kind: 'match', folderId: m.folder.id, host: u?.hostname ?? '', pattern: m.pattern };
    }
  }
  return { kind: 'none', folderId: null };
}

/** Origin string used for override keys; null for URLs without a usable origin. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = parseUrl(url);
  if (!u) return null;
  if (u.origin === 'null' || !u.origin) return u.protocol + '//' + (u.hostname || '');
  return u.origin;
}

/** A sensible pattern for "map this folder to the current site". */
export function patternForHost(url: string): string | null {
  const u = parseUrl(url);
  if (!u || !u.hostname) return null;
  const scheme = u.protocol === 'http:' ? 'http' : 'https';
  return `${scheme}://${u.hostname}/*`;
}

/**
 * A concrete URL that a pattern matches, with wildcards filled by plain
 * placeholders. Used to ask "who wins on the URLs this pattern is about?".
 * Returns null for invalid patterns.
 */
export function sampleUrl(pattern: string | ParsedPattern): string | null {
  const p = typeof pattern === 'string' ? parsePattern(pattern) : pattern;
  if (!p) return null;
  const scheme = p.scheme === '*' ? 'https' : p.scheme;
  const host = p.scheme === 'file' ? '' : p.anyHost ? 'example.com' : p.subdomainWildcard ? `sub.${p.host}` : p.host;
  return `${scheme}://${host}${p.path.replace(/\*/g, 'x')}`;
}

export interface Shadow {
  /** This folder's pattern that loses. */
  pattern: string;
  /** The folder that opens instead. */
  by: Folder;
  /** Its winning pattern. */
  byPattern: string;
  /** True when both patterns are equally specific and folder order decided. */
  tie: boolean;
}

/**
 * Patterns in OTHER folders that take precedence over this folder's patterns on
 * the URLs they cover. For every pattern Q elsewhere whose sample URL one of this
 * folder's patterns also matches, report Q's folder if it wins there. One entry
 * per (winning folder, winning pattern).
 */
export function shadowedBy(folders: readonly Folder[], folderId: string): Shadow[] {
  const me = folders.find((f) => f.id === folderId);
  if (!me) return [];
  const mine = me.urlPatterns.map(parsePattern).filter((p): p is ParsedPattern => p !== null);
  if (!mine.length) return [];
  const out: Shadow[] = [];
  const seen = new Set<string>();
  for (const other of folders) {
    if (other.id === folderId) continue;
    for (const q of other.urlPatterns) {
      const sample = sampleUrl(q);
      const u = sample ? parseUrl(sample) : null;
      if (!u || !matches(q, u)) continue;
      const losing = mine.find((p) => matches(p, u));
      if (!losing) continue;
      const w = bestMatch(folders, u);
      if (!w || w.folder.id === folderId) continue;
      const key = `${w.folder.id}\n${w.pattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pattern: losing.raw, by: w.folder, byPattern: w.pattern, tie: score(w.pattern, u) === score(losing, u) });
    }
  }
  return out;
}
