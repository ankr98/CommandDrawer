/**
 * Inline secret-shape detection. Plan §6.1.
 *
 * STRICT ALLOWLIST ONLY. Every pattern anchors on a fixed literal prefix or a
 * structural marker issued by a known provider. No entropy, no length scoring,
 * no bare `password=`. When a pattern produces a false positive against
 * tests/fixtures it is REMOVED, not tuned.
 *
 * This is a nudge, not a control. The Save button is never disabled by it.
 */

export interface SecretPattern {
  id: string;
  /** Short human name used in the warning line. */
  name: string;
  /** Regex source. Compiled once. */
  source: string;
  flags?: string;
  /** Extra context that must ALSO be present for the pattern to count. */
  requires?: { source: string; flags?: string };
}

/** Shipped as data so the list can grow without touching logic. */
export const SECRET_PATTERNS: SecretPattern[] = [
  { id: 'pem', name: 'private key block', source: '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
  {
    id: 'jwt',
    name: 'JWT token',
    source: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b',
  },
  { id: 'github', name: 'GitHub token', source: '\\bgh[pousr]_[A-Za-z0-9]{36}\\b' },
  { id: 'github-pat', name: 'GitHub token', source: '\\bgithub_pat_[A-Za-z0-9_]{22,}\\b' },
  { id: 'aws', name: 'AWS access key', source: '\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b' },
  { id: 'slack', name: 'Slack token', source: '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b' },
  { id: 'openai-anthropic', name: 'API key', source: '\\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\\b' },
  { id: 'google', name: 'Google API key', source: '\\bAIza[0-9A-Za-z_-]{35}\\b' },
  { id: 'azure-storage', name: 'Azure Storage account key', source: 'AccountKey=[A-Za-z0-9+/=]{40,}' },
  {
    id: 'sql-conn',
    name: 'connection-string password',
    source: '(?:Password|Pwd)\\s*=\\s*[^;\\s]+',
    flags: 'i',
    requires: { source: '(?:Server|Data Source)\\s*=', flags: 'i' },
  },
  // Entra ID application client secret. Current issuer format is 40 characters with a
  // fixed "8Q~" (older: "7Q~") marker at offset 3. The '~' never occurs in GUIDs, hex,
  // base64 or Autopilot hashes, so this passes the false-positive fixture set.
  {
    id: 'entra-client-secret',
    name: 'Entra ID client secret',
    source: '(?<![A-Za-z0-9_.~-])[A-Za-z0-9_.~-]{3}[78]Q~[A-Za-z0-9_.~-]{31,34}(?![A-Za-z0-9_.~-])',
  },
];

export interface SecretHit {
  id: string;
  name: string;
}

const compiled = SECRET_PATTERNS.map((p) => ({
  ...p,
  re: new RegExp(p.source, p.flags ?? ''),
  req: p.requires ? new RegExp(p.requires.source, p.requires.flags ?? '') : null,
}));

/** Returns the first matching pattern, or null. Runs entirely locally. */
export function detectSecret(value: string): SecretHit | null {
  if (!value) return null;
  for (const p of compiled) {
    if (p.re.test(value) && (!p.req || p.req.test(value))) return { id: p.id, name: p.name };
  }
  return null;
}

export const SECRET_WARNING_TEXT = "This looks like a credential. Snippets are stored in plaintext — don't save secrets here.";
export const PLAINTEXT_DISCLOSURE =
  "Snippets are stored unencrypted and synced with your browser profile. Don't store passwords, tokens or keys here.";
