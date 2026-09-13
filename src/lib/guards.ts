/**
 * Inline secret-shape detection.
 *
 * Two tiers, both allowlist-only:
 *
 *  1. FORMAT — a fixed literal prefix or structural marker issued by a known
 *     provider (`ghp_`, `AKIA`, `-----BEGIN`, the `8Q~` marker inside Entra client
 *     secrets, the `+ASt` marker inside Azure Storage keys). No entropy, no length
 *     scoring, no bare shapes.
 *
 *  2. CONTEXT — a password-ish keyword (`password=`, `-ClientSecret`, `/pass:`)
 *     immediately followed by a LITERAL value. Variables (`$cred`, `%PW%`),
 *     placeholders (`<your-secret>`, `{{ vault }}`, `***`), expressions
 *     (`(Read-Host)`) and cmdlet names never count, and the literal has to contain a
 *     digit or a password-style symbol so prose after `Password:` stays quiet.
 *
 * When a pattern produces a false positive against tests/guards.test.ts it is
 * REMOVED, not tuned. This is a nudge, not a control: Save is never disabled by it.
 */

export type SecretKind = 'format' | 'context';

export interface SecretPattern {
  id: string;
  /** Short human name shown in the warning line, e.g. "GitHub token". */
  name: string;
  /** Regex source. Compiled once. */
  source: string;
  flags?: string;
  /** Extra context that must ALSO be present for the pattern to count. */
  requires?: { source: string; flags?: string };
  /** 'format' (default): known issuer format. 'context': keyword next to a literal. */
  kind?: SecretKind;
}

// ---- building blocks for the context tier ------------------------------------

/** A value that starts like a variable, placeholder, expression, splat or mask is never a literal secret. */
const NOT_PLACEHOLDER = '(?![$%{<\\[(@*])';
/** Real passwords and keys carry a digit or a symbol that prose and identifiers rarely do. */
const STRENGTH = '[0-9!@#%^&*+?]';

/**
 * A literal secret value of at least `min` characters: double-quoted, single-quoted,
 * or bare (bare stops at whitespace, quotes and `;`). Leading `-` is rejected on
 * bare values so the next CLI switch is never mistaken for a password.
 */
function literal(min: number): string {
  return (
    `(?:"${NOT_PLACEHOLDER}(?=[^"\\n]*${STRENGTH})[^"\\n]{${min},}"` +
    `|'${NOT_PLACEHOLDER}(?=[^'\\n]*${STRENGTH})[^'\\n]{${min},}'` +
    `|${NOT_PLACEHOLDER}(?!["'\\-])(?=[^\\s"';]*${STRENGTH})[^\\s"';]{${min},})`
  );
}

/** Keywords that name a secret when they sit right before `=` or `:`. */
const KEYWORD =
  '(?:passw(?:or)?d|pwd|pass|passphrase|passcode' +
  '|(?:client|app(?:lication)?|api|shared|consumer|signing|encryption|webhook)[_-]?secret|secret' +
  '|(?:api|access|secret(?:[_-]?access)?|private|subscription|consumer|auth|shared|master|admin|primary|secondary|account|service|license|signing|encryption)[_-]?key|apikey' +
  '|(?:access|refresh|auth|api|bearer|session|id|sas|personal[_-]?access|oauth|bot|app|service|admin|secret|security)[_-]?token|token' +
  '|ocp-apim-subscription-key|x-api-key|x-functions-key|x-auth-token)';

/** Parameter names (PowerShell `-Name`, CLI `--name`) whose argument is a secret. */
const PARAM_SUFFIX = '(?:password|passwd|passphrase|secret|apikey|api-key|access-key|account-key|secret-?key|token|pat)';

// ---- the list ----------------------------------------------------------------

/** Shipped as data so the list can grow without touching logic. Order matters: first hit wins. */
export const SECRET_PATTERNS: SecretPattern[] = [
  // ---- Key material ----------------------------------------------------------
  { id: 'pem', name: 'private key block', source: '-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----' },
  { id: 'putty', name: 'PuTTY private key file', source: 'PuTTY-User-Key-File-\\d' },
  { id: 'age', name: 'age secret key', source: '\\bAGE-SECRET-KEY-1[A-Z0-9]{58}\\b' },

  // ---- Microsoft: Entra ID / Azure ------------------------------------------
  {
    id: 'jwt',
    name: 'JWT / access token',
    source: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b',
  },
  // Entra ID application client secret. Current issuer format is 40 characters with a
  // fixed "8Q~" (older: "7Q~") marker at offset 3. The '~' never occurs in GUIDs, hex,
  // base64 or Autopilot hashes, so this passes the false-positive fixture set.
  {
    id: 'entra-client-secret',
    name: 'Entra ID client secret',
    source: '(?<![A-Za-z0-9_.~-])[A-Za-z0-9_.~-]{3}[78]Q~[A-Za-z0-9_.~-]{31,34}(?![A-Za-z0-9_.~-])',
  },
  // Entra ID refresh tokens issued by the v2 endpoint start with "0.A" and run to well
  // over a thousand base64url characters.
  { id: 'entra-refresh-token', name: 'Entra ID refresh token', source: '(?<![A-Za-z0-9_.-])0\\.A[A-Za-z0-9_-]{100,}' },
  // Sign-in and SharePoint session cookies. Anyone holding these is signed in as you.
  {
    id: 'ms-session-cookie',
    name: 'Microsoft sign-in session cookie',
    source: '\\b(?:ESTSAUTH(?:PERSISTENT|LIGHT)?|FedAuth|rtFa|SPOIDCRL)=[A-Za-z0-9+/=%._-]{60,}',
  },
  // Azure "identifiable" keys carry a fixed provider signature at a fixed offset.
  // Storage account keys: 88 chars, "+ASt" at 76.
  { id: 'azure-storage-key', name: 'Azure Storage account key', source: '[A-Za-z0-9+/]{76}\\+ASt[A-Za-z0-9+/]{5}[AQgw]==' },
  { id: 'azure-storage-conn', name: 'Azure Storage account key', source: 'AccountKey=[A-Za-z0-9+/=]{40,}' },
  // Shared access signatures: blob/queue/table SAS, Event Hub/Service Bus SAS, Logic App callback URLs.
  {
    id: 'azure-sas',
    name: 'Azure shared access signature (SAS)',
    source: '(?:[?&;]|\\b)sig=[A-Za-z0-9%+/=_-]{20,}',
    requires: { source: '(?:[?&]sv=|SharedAccessSignature\\s)', flags: 'i' },
  },
  { id: 'azure-cosmos-key', name: 'Azure Cosmos DB key', source: '[A-Za-z0-9+/]{76}ACDb[A-Za-z0-9+/]{5}[AQgw]==' },
  { id: 'azure-batch-key', name: 'Azure Batch key', source: '[A-Za-z0-9+/]{76}\\+ABa[A-Za-z0-9+/]{5}[AQgw]==' },
  { id: 'azure-messaging-key', name: 'Azure Event Hub / Service Bus / Relay key', source: '[A-Za-z0-9+/]{33}\\+(?:AEh|ASb|ARm)[A-P][A-Za-z0-9+/]{5}=' },
  { id: 'azure-iot-key', name: 'Azure IoT Hub key', source: '[A-Za-z0-9+/]{33}AIoT[A-P][A-Za-z0-9+/]{5}=' },
  { id: 'azure-redis-key', name: 'Azure Cache for Redis key', source: '[A-Za-z0-9]{33}AzCa[A-P][A-Za-z0-9]{5}=' },
  { id: 'azure-functions-key', name: 'Azure Functions host key', source: '[A-Za-z0-9_-]{44}AzFu[A-Za-z0-9_-]{5}[AQgw]==' },
  { id: 'azure-search-key', name: 'Azure AI Search key', source: '[A-Za-z0-9]{42}AzSe[A-D][A-Za-z0-9]{5}' },
  { id: 'azure-acr-key', name: 'Azure Container Registry key', source: '[A-Za-z0-9+/]{42}\\+ACR[A-D][A-Za-z0-9+/]{5}' },
  // Common Annotated Security Key: the newer cross-service Azure format, "JQQJ9" at 52.
  { id: 'azure-cask', name: 'Azure service key', source: '[A-Za-z0-9]{52}JQQJ9[9DH][A-Za-z0-9]{24,28}(?:==)?' },
  { id: 'azure-devops-pat', name: 'Azure DevOps personal access token', source: '\\b[A-Za-z0-9]{76}AZDO[A-Za-z0-9]{4}\\b' },
  // NTLM hash pair. The LM half is the well-known empty-password constant.
  { id: 'ntlm', name: 'NTLM password hash', source: '\\baad3b435b51404eeaad3b435b51404ee:[0-9a-f]{32}\\b', flags: 'i' },

  // ---- AWS / Google ----------------------------------------------------------
  { id: 'aws', name: 'AWS access key', source: '\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b' },
  { id: 'aws-secret', name: 'AWS secret access key', source: '\\baws_secret_access_key\\s*[=:]\\s*["\']?[A-Za-z0-9/+]{40}\\b', flags: 'i' },
  { id: 'google', name: 'Google API key', source: '\\bAIza[0-9A-Za-z_-]{35}\\b' },
  { id: 'google-oauth', name: 'Google OAuth token', source: '\\bya29\\.[A-Za-z0-9_-]{30,}' },
  { id: 'gcp-service-account', name: 'Google service account JSON', source: '"type"\\s*:\\s*"service_account"' },

  // ---- Source control / CI / packages ---------------------------------------
  { id: 'github', name: 'GitHub token', source: '\\bgh[pousr]_[A-Za-z0-9]{36}\\b' },
  { id: 'github-pat', name: 'GitHub token', source: '\\bgithub_pat_[A-Za-z0-9_]{22,}\\b' },
  { id: 'gitlab', name: 'GitLab token', source: '\\bglpat-[A-Za-z0-9_-]{20,}' },
  { id: 'npm', name: 'npm token', source: '\\bnpm_[A-Za-z0-9]{36}\\b' },
  { id: 'pypi', name: 'PyPI token', source: '\\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}' },
  { id: 'docker', name: 'Docker Hub token', source: '\\bdckr_pat_[A-Za-z0-9_-]{20,}' },
  { id: 'atlassian', name: 'Atlassian API token', source: '\\bATATT3[A-Za-z0-9_=-]{30,}' },
  { id: 'databricks', name: 'Databricks token', source: '\\bdapi[a-f0-9]{32}\\b' },
  { id: 'postman', name: 'Postman API key', source: '\\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\\b' },
  { id: 'hashicorp', name: 'HashiCorp Vault token', source: '\\bhv[sbr]\\.[A-Za-z0-9_-]{24,}' },
  { id: 'digitalocean', name: 'DigitalOcean token', source: '\\bdo[opr]_v1_[a-f0-9]{64}\\b' },
  { id: 'tailscale', name: 'Tailscale key', source: '\\btskey-(?:auth|api|client)-[A-Za-z0-9]+-[A-Za-z0-9]{20,}' },
  { id: 'onepassword', name: '1Password service account token', source: '\\bops_eyJ[A-Za-z0-9_-]{20,}' },

  // ---- Chat / SaaS / AI -----------------------------------------------------
  { id: 'slack', name: 'Slack token', source: '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b' },
  { id: 'slack-webhook', name: 'Slack webhook URL', source: 'https://hooks\\.slack\\.com/services/T[A-Za-z0-9]+/B[A-Za-z0-9]+/[A-Za-z0-9]{10,}' },
  { id: 'discord-webhook', name: 'Discord webhook URL', source: 'https://discord(?:app)?\\.com/api/webhooks/\\d+/[A-Za-z0-9_-]{60,}' },
  { id: 'telegram', name: 'Telegram bot token', source: '\\b\\d{8,10}:AA[A-Za-z0-9_-]{33}\\b' },
  { id: 'openai-anthropic', name: 'API key', source: '\\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\\b' },
  { id: 'huggingface', name: 'Hugging Face token', source: '\\bhf_[A-Za-z0-9]{34}\\b' },
  { id: 'stripe', name: 'Stripe key', source: '\\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\\b' },
  { id: 'sendgrid', name: 'SendGrid API key', source: '\\bSG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}\\b' },
  { id: 'twilio', name: 'Twilio API key', source: '\\bSK[0-9a-f]{32}\\b' },
  { id: 'shopify', name: 'Shopify token', source: '\\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}\\b' },
  { id: 'mailchimp', name: 'Mailchimp API key', source: '\\b[a-f0-9]{32}-us\\d{1,2}\\b' },
  { id: 'mailgun', name: 'Mailgun API key', source: '\\bkey-[a-f0-9]{32}\\b' },

  // ---- Structural: credentials embedded in URLs, headers, connection strings -
  {
    id: 'url-userinfo',
    name: 'password embedded in a URL',
    source: `[a-z][a-z0-9+.-]*://[^/\\s:@]+:${NOT_PLACEHOLDER}[^/\\s@]{3,}@[^\\s/]+`,
    flags: 'i',
  },
  { id: 'basic-auth', name: 'Basic authentication header', source: '\\bAuthorization:\\s*Basic\\s+[A-Za-z0-9+/]{16,}={0,2}', flags: 'i' },
  { id: 'bearer', name: 'bearer token', source: '\\bBearer\\s+(?=[A-Za-z0-9._~+/-]*[0-9])[A-Za-z0-9._~+/-]{40,}={0,2}' },
  {
    id: 'sql-conn',
    name: 'connection-string password',
    source: `(?:Password|Pwd)\\s*=\\s*${NOT_PLACEHOLDER}[^;\\s]+`,
    flags: 'i',
    requires: { source: '(?:Server|Data Source)\\s*=', flags: 'i' },
  },

  // ---- Context tier: keyword + literal --------------------------------------
  // -Password "Hunter2!"   -ClientSecret abc…   --account-key …   --token …
  {
    id: 'kw-param',
    kind: 'context',
    name: 'value passed to a password / secret / token parameter',
    source: `(?<![\\w-])-{1,2}(?:[A-Za-z]+-)*[A-Za-z]*${PARAM_SUFFIX}\\s+${literal(6)}`,
    flags: 'i',
  },
  // password = "Hunter2!"   "client_secret": "…"   DB_PASSWORD=…   /pass:…   token: …
  {
    id: 'kw-assign',
    kind: 'context',
    name: 'value after a password / secret / key keyword',
    source: `(?<![$%A-Za-z0-9])${KEYWORD}(?:["']?\\s*[:=]>?\\s*|\\s+(?=["']))${literal(8)}`,
    flags: 'i',
  },
  // ConvertTo-SecureString "P@ssw0rd" -AsPlainText -Force — the classic plaintext-in-a-script.
  {
    id: 'ps-securestring',
    kind: 'context',
    name: 'plaintext password in ConvertTo-SecureString',
    source: 'ConvertTo-SecureString\\b(?:\\s+-\\w+)*\\s+(?:-String\\s+)?(?:"(?!\\$)[^"\\n]{4,}"|\'[^\'\\n]{4,}\')',
    flags: 'i',
    requires: { source: '-AsPlainText', flags: 'i' },
  },
  // MySQL / Oracle: CREATE USER … IDENTIFIED BY 'x'
  { id: 'sql-identified-by', kind: 'context', name: 'SQL password', source: "IDENTIFIED\\s+BY\\s+'[^'\\n]{4,}'", flags: 'i' },
  // curl -u user:password
  {
    id: 'curl-user',
    kind: 'context',
    name: 'user:password on the command line',
    source: `(?:^|\\s)(?:-u|--user)\\s+["']?(?![$%])[^\\s"':]+:${NOT_PLACEHOLDER}[^\\s"']{4,}`,
  },
  // net use \\server\share /user:dom\name P@ssw0rd
  {
    id: 'net-use',
    kind: 'context',
    name: 'password on the command line',
    source: `\\bnet\\s+use\\b[^\\n]*\\/user:\\S+\\s+${NOT_PLACEHOLDER}(?![/"'\\-])(?=\\S*${STRENGTH})\\S{6,}`,
    flags: 'i',
  },
];

export interface SecretHit {
  id: string;
  name: string;
  kind: SecretKind;
}

const compiled = SECRET_PATTERNS.map((p) => ({
  ...p,
  kind: p.kind ?? ('format' as SecretKind),
  re: new RegExp(p.source, p.flags ?? ''),
  req: p.requires ? new RegExp(p.requires.source, p.requires.flags ?? '') : null,
}));

// ---- label-assisted rule -----------------------------------------------------
// The plan rejects keyword matching on the label ALONE ("reset user password" is a
// legitimate label). Combined with a value that is a single password-shaped token
// and nothing else, it becomes a strong signal: a label that says "password" over a
// value like `Summer2026!` is exactly the thing this extension is not for.

const LABEL_SAYS_SECRET = /\b(?:passw(?:or)?d|passwd|pwd|passphrase|passcode|secret|api[ _-]?key|apikey|token|credentials?)\b/i;
/** Labels about a password's NAME, ID, policy, rotation, expiry… describe the concept, not a value. */
const LABEL_IS_META =
  /\b(?:name|id|url|link|endpoint|polic|expir|reset|rotat|lifetime|length|count|age|history|complexit|regex|attribute|propert|filter|query|report|prompt|change|last|never|hash|scope|audit|log|list|get|set|find|search|check|test)/i;

/** True when `value` is one bare password-shaped token: 6–64 chars, no whitespace, carries a digit or symbol, and is not a known non-secret shape. */
function looksLikeBarePassword(value: string): boolean {
  const v = value.trim();
  if (!/^\S{6,64}$/.test(v)) return false;
  if (/^[$%{<\[(@*\\/-]/.test(v)) return false; // variable, placeholder, path, switch
  if (/^[A-Za-z_][A-Za-z0-9_.-]*[:=]/.test(v)) return false; // key=value pair: the keyword tier decides those
  if (!/[0-9!@#$%^&*+=?~]/.test(v)) return false; // no digit / symbol → prose, cmdlet, hostname
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return false; // GUID
  if (/^[0-9a-f]{16,}$/i.test(v)) return false; // thumbprint / hash
  if (/^[\d.,:_-]+$/.test(v)) return false; // number, version, port, date
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return false; // email / UPN
  if (/:\/\/|^[a-z][a-z0-9+.-]*:/i.test(v)) return false; // URL / scheme
  if (/\\/.test(v)) return false; // path
  if (/^[A-Z][a-z]+-[A-Z][A-Za-z]*$/.test(v)) return false; // Verb-Noun cmdlet
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(v)) return false; // hostname / domain
  return true;
}

/**
 * Returns the first matching pattern, or null. Runs entirely locally.
 * `label` is optional; when given, a label that names a password/secret over a
 * value that is one bare password-shaped token also counts.
 */
export function detectSecret(value: string, label?: string): SecretHit | null {
  if (!value) return null;
  for (const p of compiled) {
    if (p.re.test(value) && (!p.req || p.req.test(value))) return { id: p.id, name: p.name, kind: p.kind };
  }
  if (label && LABEL_SAYS_SECRET.test(label) && !LABEL_IS_META.test(label) && looksLikeBarePassword(value)) {
    return { id: 'label-context', name: 'password-shaped value under a label that says so', kind: 'context' };
  }
  return null;
}

/** Warning line shown under the value field. Names the reason so it reads as correct every time. */
export function secretWarning(hit: SecretHit): string {
  return `Looks like a credential (${hit.name}). Snippets are stored in plain text — never save secrets here.`;
}

/** Settings and About pages. */
export const PLAINTEXT_DISCLOSURE = 'Not a password manager. Snippets are stored unencrypted and synced with your browser profile. Never store passwords, secrets or tokens here.';

/** One line, for the popup footer. */
export const FOOTER_DISCLOSURE = 'Never save passwords, secrets or tokens here.';
