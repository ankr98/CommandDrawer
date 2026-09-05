import { describe, expect, it } from 'vitest';
import { detectSecret, SECRET_PATTERNS } from '../src/lib/guards';

/**
 * FALSE-POSITIVE FIXTURE SET. Plan §6.1: this matters more than the true-positive
 * set. Every string here is a legitimate admin snippet and must produce NO warning.
 * Add to it whenever a real snippet trips a warning it shouldn't.
 */
const LEGIT: string[] = [
  // GUIDs: tenant, app, object, policy ids
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  'f8cdef31-a31e-4b4a-93e4-5f571e91255a',
  '-TenantId 72f988bf-86f1-41af-91ab-2d7cd011db47',
  'Connect-MgGraph -ClientId 1b730954-1685-4b74-9bfd-dac224a7b894 -TenantId 72f988bf-86f1-41af-91ab-2d7cd011db47',
  // certificate thumbprints (40 hex)
  'A909502DD82AE41433E6F83886B00D4277A32A7B',
  'Connect-ExchangeOnline -CertificateThumbprint 3F1C9A8B2E7D4C6A5B0E9F8D7C6B5A4E3D2C1B0A -AppId 1b730954-1685-4b74-9bfd-dac224a7b894 -Organization contoso.onmicrosoft.com',
  // SHA-256 hashes
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  // -EncodedCommand base64
  'powershell -EncodedCommand VwByAGkAdABlAC0ASABvAHMAdAAgACIASABlAGwAbABvACwAIABXAG8AcgBsAGQAIgA=',
  'powershell.exe -NoProfile -EncodedCommand RwBlAHQALQBNAGcAVQBzAGUAcgAgAC0ARgBpAGwAdABlAHIAIAAiAHMAdABhAHIAdABzAFcAaQB0AGgAKABkAGkAcwBwAGwAYQB5AE4AYQBtAGUALAAnAEEAJwApACIA',
  // Graph URLs with $filter and encoded params
  "https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName,'A')&$select=id,displayName,userPrincipalName",
  'https://graph.microsoft.com/beta/deviceManagement/managedDevices?$filter=operatingSystem%20eq%20%27Windows%27&$top=50',
  "https://graph.microsoft.com/v1.0/groups?$filter=groupTypes/any(c:c+eq+'Unified')&$count=true",
  'https://graph.microsoft.com/v1.0/auditLogs/signIns?$filter=createdDateTime ge 2026-09-01T00:00:00Z and status/errorCode ne 0',
  // Graph / PowerShell one-liners that mention passwords legitimately
  'New-MgUser -DisplayName "Jane" -PasswordProfile @{ ForceChangePasswordNextSignIn = $true } -AccountEnabled',
  'Set-ADAccountPassword -Identity jdoe -Reset -NewPassword (Read-Host -AsSecureString)',
  '$cred = Get-Credential; Connect-ExchangeOnline -Credential $cred',
  'Get-MgUser -Filter "passwordPolicies eq \'DisablePasswordExpiration\'" -All',
  'Update-MgUser -UserId $id -PasswordPolicies DisablePasswordExpiration',
  'az ad app credential reset --id $appId --years 1',
  'Remove-MgApplicationPassword -ApplicationId $appId -KeyId $keyId',
  // KQL containing hashes and GUIDs
  'DeviceProcessEvents | where SHA256 == "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f" | project Timestamp, DeviceName',
  'SigninLogs | where AppId == "1b730954-1685-4b74-9bfd-dac224a7b894" | summarize count() by UserPrincipalName',
  'AuditLogs | where OperationName has "password" | project TimeGenerated, InitiatedBy',
  // Device IDs, Autopilot hardware hash (very long base64)
  'Get-WindowsAutopilotInfo -OutputFile C:\\hash.csv',
  'T0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PQ==',
  'Intune device id: 7d6e5f4c-3b2a-1908-7f6e-5d4c3b2a1908 / Azure AD device id 0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
  // Portal deep-links
  'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ConditionalAccessBlade/~/Policies',
  'https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesWindowsMenu/~/windowsEnrollment',
  'https://portal.azure.com/#@contoso.onmicrosoft.com/resource/subscriptions/00000000-0000-0000-0000-000000000000/overview',
  // Misc admin strings
  'contoso.onmicrosoft.com',
  'Set-MsolDirSyncEnabled -EnableDirSync $false',
  'dsregcmd /status',
  'Get-MgServicePrincipal -Filter "appId eq \'00000003-0000-0000-c000-000000000000\'"',
  'sk-not-a-key', // too short for the API-key pattern
  'AKIAEXAMPLE', // too short
  'Server=tcp:sql.contoso.com,1433;Initial Catalog=Inventory;Authentication=Active Directory Default;',
  'Pwd was reset by helpdesk; Server rebooted at 03:00', // "Pwd" without "=" does not match
  'The token starts with eyJ but is not a JWT',
  '-----BEGIN CERTIFICATE-----',
  'Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) -RecordType ExchangeAdmin',
  'ghp_ is the GitHub prefix', // prefix alone
];

const SECRETS: Array<[string, string]> = [
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIE...', 'pem'],
  ['-----BEGIN PRIVATE KEY-----', 'pem'],
  ['-----BEGIN EC PRIVATE KEY-----', 'pem'],
  ['Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL2dyYXBoLm1pY3Jvc29mdC5jb20ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'jwt'],
  ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij', 'github'],
  ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', 'github-pat'],
  ['aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'aws'],
  ['ASIAIOSFODNN7EXAMPLE', 'aws'],
  ['xoxb-1234567890-abcdefghijkl', 'slack'],
  ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', 'openai-anthropic'],
  ['OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789', 'openai-anthropic'],
  ['AIzaSyA1234567890abcdefghijklmnopqrstuv', 'google'],
  ['DefaultEndpointsProtocol=https;AccountName=stg;AccountKey=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUA==;EndpointSuffix=core.windows.net', 'azure-storage'],
  ['Server=tcp:sql.contoso.com,1433;Database=Inv;User ID=sa;Password=Hunter2!;', 'sql-conn'],
  ['Data Source=.;Initial Catalog=X;Pwd = topsecret ;', 'sql-conn'],
  ['$secret = "Ab18Q~kLmNoPqRsTuVwXyZ0123456789abcdefgh"', 'entra-client-secret'],
  ['-ClientSecret xY.7Q~kLmNoPqRsTuVwXyZ0123456789abcdefg', 'entra-client-secret'],
];

describe('guards — false-positive fixture set (must be empty)', () => {
  it('has at least 30 legitimate fixtures', () => expect(LEGIT.length).toBeGreaterThanOrEqual(30));
  it.each(LEGIT)('no warning for %s', (s) => {
    expect(detectSecret(s)).toBeNull();
  });
});

describe('guards — true positives', () => {
  it.each(SECRETS)('warns for %s', (s, id) => {
    expect(detectSecret(s)?.id).toBe(id);
  });
  it('bare password= without connection-string context is NOT flagged', () => {
    expect(detectSecret('password=Hunter2!')).toBeNull();
    expect(detectSecret('-Password $cred')).toBeNull();
  });
  it('handles empty input', () => expect(detectSecret('')).toBeNull());
});

describe('guards — admission criteria', () => {
  it('every pattern anchors on a literal prefix or structural marker (no bare shape)', () => {
    for (const p of SECRET_PATTERNS) {
      // Each source must contain at least 3 consecutive literal characters.
      expect(p.source.replace(/\\[bBdDwWsS]/g, '')).toMatch(/[A-Za-z0-9~=-]{3,}/);
    }
  });
  it('every pattern compiles', () => {
    for (const p of SECRET_PATTERNS) expect(() => new RegExp(p.source, p.flags ?? '')).not.toThrow();
  });
});
