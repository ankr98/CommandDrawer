import { describe, expect, it } from 'vitest';
import { newFolder } from '../src/lib/schema';
import {
  allMatches,
  bestMatch,
  isValidPattern,
  literalSegments,
  matches,
  originOf,
  parsePattern,
  patternForHost,
  resolveFolder,
  ROOT_OVERRIDE,
  sampleUrl,
  score,
  shadowedBy,
} from '../src/lib/matcher';

describe('sampleUrl / shadowedBy — static overlap warnings', () => {
  it.each(['https://portal.azure.com/*', '*://*.microsoft.com/*', 'https://developer.microsoft.com/*graph*', '<all_urls>', 'http://*/*', 'https://x.com/a/*', 'https://x.com/*tab=users*', 'file:///*'])(
    'sample of %s matches its own pattern',
    (p) => {
      const s = sampleUrl(p)!;
      expect(s).not.toBeNull();
      expect(matches(p, s)).toBe(true);
    },
  );
  it('fills wildcards with plain placeholders', () => {
    expect(sampleUrl('https://portal.azure.com/*')).toBe('https://portal.azure.com/x');
    expect(sampleUrl('*://*.microsoft.com/*')).toBe('https://sub.microsoft.com/x');
    expect(sampleUrl('<all_urls>')).toBe('https://example.com/x');
    expect(sampleUrl('garbage')).toBeNull();
  });
  it('a broad folder is told which more specific folders win on their URLs', () => {
    const wide = newFolder({ id: 'wide', name: 'PowerShell', order: 0, urlPatterns: ['https://*.microsoft.com/*'] });
    const exo = newFolder({ id: 'exo', name: 'Exchange Online', parentId: 'wide', order: 0, urlPatterns: ['https://admin.exchange.microsoft.com/*'] });
    const unrelated = newFolder({ id: 'gh', name: 'GitHub', order: 1, urlPatterns: ['https://github.com/*'] });
    const sh = shadowedBy([wide, exo, unrelated], 'wide');
    expect(sh).toHaveLength(1);
    expect(sh[0]).toMatchObject({ pattern: 'https://*.microsoft.com/*', byPattern: 'https://admin.exchange.microsoft.com/*', tie: false });
    expect(sh[0]!.by.id).toBe('exo');
    expect(shadowedBy([wide, exo, unrelated], 'exo')).toEqual([]);
    expect(shadowedBy([wide, exo, unrelated], 'gh')).toEqual([]);
  });
  it('an identical pattern in a folder higher in the list is reported as a tie', () => {
    const first = newFolder({ id: 'a', name: 'A', order: 0, urlPatterns: ['https://portal.azure.com/*'] });
    const second = newFolder({ id: 'b', name: 'B', order: 1, urlPatterns: ['https://portal.azure.com/*'] });
    const sh = shadowedBy([first, second], 'b');
    expect(sh).toHaveLength(1);
    expect(sh[0]).toMatchObject({ tie: true, byPattern: 'https://portal.azure.com/*' });
    expect(sh[0]!.by.id).toBe('a');
    expect(shadowedBy([first, second], 'a')).toEqual([]);
  });
  it('dedupes per winning folder and pattern, ignores invalid patterns and unknown folders', () => {
    const wide = newFolder({ id: 'wide', name: 'W', order: 0, urlPatterns: ['https://*.microsoft.com/*', '*://*.microsoft.com/*', 'not a pattern'] });
    const exo = newFolder({ id: 'exo', name: 'E', order: 1, urlPatterns: ['https://admin.exchange.microsoft.com/*'] });
    expect(shadowedBy([wide, exo], 'wide')).toHaveLength(1);
    expect(shadowedBy([wide, exo], 'nope')).toEqual([]);
  });
});

describe('parsePattern', () => {
  it.each([
    ['https://portal.azure.com/*', { scheme: 'https', host: 'portal.azure.com', subdomainWildcard: false, path: '/*' }],
    ['*://*.microsoft.com/*', { scheme: '*', host: 'microsoft.com', subdomainWildcard: true, path: '/*' }],
    ['https://developer.microsoft.com/*graph*', { host: 'developer.microsoft.com', path: '/*graph*' }],
    ['HTTPS://Admin.Site.COM/Feature/*', { scheme: 'https', host: 'admin.site.com', path: '/Feature/*' }],
    ['<all_urls>', { allUrls: true, anyHost: true }],
    ['http://*/*', { anyHost: true, path: '/*' }],
    ['file:///*', { scheme: 'file', host: '' }],
  ])('parses %s', (p, expected) => {
    expect(parsePattern(p)).toMatchObject(expected);
  });
  it.each(['', 'portal.azure.com', 'https://portal.azure.com', 'https://*portal.azure.com/*', 'https://a.*.com/*', 'gopher://x/*', 'https:///x', 'https://', 'https://host name/*'])(
    'rejects %s',
    (p) => {
      expect(isValidPattern(p)).toBe(false);
    },
  );
});

describe('matches — fixture table', () => {
  const T: Array<[string, string, boolean]> = [
    ['https://portal.azure.com/*', 'https://portal.azure.com/#home', true],
    ['https://portal.azure.com/*', 'https://portal.azure.com/', true],
    ['https://portal.azure.com/*', 'http://portal.azure.com/', false],
    ['*://portal.azure.com/*', 'http://portal.azure.com/', true],
    ['*://portal.azure.com/*', 'ftp://portal.azure.com/', false],
    ['https://*.microsoft.com/*', 'https://entra.microsoft.com/', true],
    ['https://*.microsoft.com/*', 'https://microsoft.com/', true],
    ['https://*.microsoft.com/*', 'https://notmicrosoft.com/', false],
    ['https://*.microsoft.com/*', 'https://a.b.microsoft.com/x', true],
    ['https://developer.microsoft.com/*graph*', 'https://developer.microsoft.com/en-us/graph/graph-explorer', true],
    ['https://developer.microsoft.com/*graph*', 'https://developer.microsoft.com/en-us/fluentui', false],
    ['https://admin.site.com/feature/*', 'https://admin.site.com/feature/x', true],
    ['https://admin.site.com/feature/*', 'https://admin.site.com/features/x', false],
    ['https://admin.site.com/feature*', 'https://admin.site.com/features/x', true],
    ['https://admin.site.com/feature/*', 'https://admin.site.com/other', false],
    ['https://admin.site.com/*', 'https://admin.site.com/feature/x', true],
    ['https://admin.site.com/*', 'https://admin.site.com:8443/x', true],
    ['https://ADMIN.site.com/*', 'https://admin.SITE.com/x', true],
    ['https://x.com/a/*', 'https://x.com/a', false],
    ['https://x.com/a*', 'https://x.com/a', true],
    // query string participates in path matching, fragment does not
    ['https://x.com/*tab=users*', 'https://x.com/admin?tab=users', true],
    ['https://x.com/*tab=users*', 'https://x.com/admin#tab=users', false],
    ['<all_urls>', 'https://anything.example/x', true],
    ['<all_urls>', 'file:///home/me/x.txt', true],
    ['*://*/*', 'https://anything.example/x', true],
    ['*://*/*', 'file:///home/me/x.txt', false],
    ['https://x.com/*', 'not a url', false],
    ['not a pattern', 'https://x.com/', false],
  ];
  it.each(T)('%s vs %s → %s', (pattern, url, expected) => {
    expect(matches(pattern, url)).toBe(expected);
  });
});

describe('score — specificity tiers', () => {
  const url = 'https://admin.site.com/feature/x/y';
  const s = (p: string) => score(p, url)!;
  it('exact host + path beats exact host + /* (the case called for in the spec)', () => {
    expect(s('https://admin.site.com/feature/*')).toBeGreaterThan(s('https://admin.site.com/*'));
  });
  it('exact host + /* beats wildcard subdomain + path', () => {
    expect(s('https://admin.site.com/*')).toBeGreaterThan(s('https://*.site.com/feature/*'));
  });
  it('wildcard subdomain + path beats wildcard subdomain + /*', () => {
    expect(s('https://*.site.com/feature/*')).toBeGreaterThan(s('https://*.site.com/*'));
  });
  it('wildcard subdomain + /* beats any-host', () => {
    expect(s('https://*.site.com/*')).toBeGreaterThan(s('*://*/*'));
    expect(s('*://*/*')).toBeGreaterThan(0);
    expect(s('<all_urls>')).toBe(s('*://*/*'));
  });
  it('within a tier, more literal segments win', () => {
    expect(s('https://admin.site.com/feature/x/*')).toBeGreaterThan(s('https://admin.site.com/feature/*'));
    expect(literalSegments('/feature/x/*')).toBe(2);
    expect(literalSegments('/*graph*')).toBe(1);
    expect(literalSegments('/*')).toBe(0);
  });
  it('scheme wildcard does not change the tier', () => {
    expect(s('*://admin.site.com/feature/*')).toBe(s('https://admin.site.com/feature/*'));
  });
  it('is null when not matching or invalid', () => {
    expect(score('https://other.com/*', url)).toBeNull();
    expect(score('garbage', url)).toBeNull();
  });
});

const root = newFolder({ id: 'root', name: 'Admin', order: 0, urlPatterns: ['https://admin.site.com/*'] });
const feature = newFolder({ id: 'feature', name: 'Feature', order: 1, urlPatterns: ['https://admin.site.com/feature/*'] });
const ps = newFolder({ id: 'ps', name: 'PowerShell', order: 2, urlPatterns: ['https://*.microsoft.com/*'] });
const exo = newFolder({ id: 'exo', name: 'Exchange Online', parentId: 'ps', order: 0, urlPatterns: ['https://admin.exchange.microsoft.com/*'] });
const graph = newFolder({ id: 'graph', name: 'Graph API', parentId: 'ps', order: 1, urlPatterns: [] });
const folders = [root, feature, ps, exo, graph];

describe('bestMatch / resolveFolder — acceptance criteria', () => {
  it('two folders match, /feature/* wins on /feature/x', () => {
    expect(bestMatch(folders, 'https://admin.site.com/feature/x')!.folder.id).toBe('feature');
    expect(bestMatch(folders, 'https://admin.site.com/other')!.folder.id).toBe('root');
  });
  it("a child folder's pattern outscores every root folder's → opens on the child", () => {
    const m = bestMatch(folders, 'https://admin.exchange.microsoft.com/#/mailboxes')!;
    expect(m.folder.id).toBe('exo');
    expect(m.folder.parentId).toBe('ps');
  });
  it("a child with no patterns never auto-matches, even when its parent's pattern matches", () => {
    const m = bestMatch(folders, 'https://entra.microsoft.com/')!;
    expect(m.folder.id).toBe('ps');
    expect(allMatches(folders, 'https://entra.microsoft.com/').map((x) => x.folder.id)).toEqual(['ps']);
  });
  it('no folder matches → root view, no error', () => {
    expect(bestMatch(folders, 'https://github.com/x')).toBeNull();
    expect(resolveFolder(folders, 'https://github.com/x', null)).toEqual({ kind: 'none', folderId: null });
    expect(resolveFolder(folders, null, null)).toEqual({ kind: 'none', folderId: null });
  });
  it('override beats auto-match; root sentinel pins the root view', () => {
    expect(resolveFolder(folders, 'https://admin.site.com/feature/x', 'ps')).toEqual({ kind: 'override', folderId: 'ps' });
    expect(resolveFolder(folders, 'https://admin.site.com/feature/x', ROOT_OVERRIDE)).toEqual({ kind: 'override', folderId: null });
  });
  it('an override pointing at a deleted folder falls back to auto-match', () => {
    const r = resolveFolder(folders, 'https://admin.site.com/feature/x', 'gone');
    expect(r).toMatchObject({ kind: 'match', folderId: 'feature', host: 'admin.site.com' });
  });
  it('ties break on folder order, then shallower depth', () => {
    const a = newFolder({ id: 'a', name: 'A', order: 5, urlPatterns: ['https://x.com/*'] });
    const b = newFolder({ id: 'b', name: 'B', order: 1, urlPatterns: ['https://x.com/*'] });
    expect(bestMatch([a, b], 'https://x.com/')!.folder.id).toBe('b');
    const child = newFolder({ id: 'c', name: 'C', parentId: 'a', order: 5, urlPatterns: ['https://x.com/*'] });
    expect(bestMatch([child, a], 'https://x.com/')!.folder.id).toBe('a');
  });
  it('invalid patterns inside a folder are ignored, not fatal', () => {
    const f = newFolder({ id: 'f', name: 'F', urlPatterns: ['nonsense', 'https://x.com/*'] });
    expect(bestMatch([f], 'https://x.com/')!.pattern).toBe('https://x.com/*');
  });
});

describe('helpers', () => {
  it('originOf', () => {
    expect(originOf('https://admin.site.com:8443/x?y#z')).toBe('https://admin.site.com:8443');
    expect(originOf('chrome://extensions/')).toBe('chrome://extensions');
    expect(originOf('not a url')).toBeNull();
    expect(originOf(null)).toBeNull();
  });
  it('patternForHost', () => {
    expect(patternForHost('https://intune.microsoft.com/#view/x')).toBe('https://intune.microsoft.com/*');
    expect(patternForHost('http://localhost:3000/')).toBe('http://localhost/*');
    expect(patternForHost('about:blank')).toBeNull();
  });
});
