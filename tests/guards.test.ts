import { describe, expect, it } from 'vitest';
import { detectSecret, SECRET_PATTERNS } from '../src/lib/guards';

/**
 * FALSE-POSITIVE FIXTURE SET. This matters more than the true-positive
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
  'https://graph.microsoft.com/v1.0/users?$skiptoken=X%274453707402000100000017433A2E4B41766B6F6C6D6F3A6B61766B6F6C6D6F2E636F6D29557365725F...',
  'https://graph.microsoft.com/v1.0/users/delta?$deltatoken=oEcOySpF_hWYmSIUZBOIfPzcwisr_zOXYtRgXNMwbfvQsUQ9Z3mFBtsNGsQY36RSDnn5f',
  // Graph / PowerShell one-liners that mention passwords legitimately
  'New-MgUser -DisplayName "Jane" -PasswordProfile @{ ForceChangePasswordNextSignIn = $true } -AccountEnabled',
  'Set-ADAccountPassword -Identity jdoe -Reset -NewPassword (Read-Host -AsSecureString)',
  '$cred = Get-Credential; Connect-ExchangeOnline -Credential $cred',
  'Get-MgUser -Filter "passwordPolicies eq \'DisablePasswordExpiration\'" -All',
  'Update-MgUser -UserId $id -PasswordPolicies DisablePasswordExpiration',
  'az ad app credential reset --id $appId --years 1',
  'Remove-MgApplicationPassword -ApplicationId $appId -KeyId $keyId',
  'Get-ADUser -Filter * -Properties PasswordLastSet, PasswordNeverExpires | Where-Object { $_.PasswordNeverExpires -eq $true }',
  'Set-ADUser jdoe -PasswordNeverExpires $true -ChangePasswordAtLogon $false',
  'Set-MsolUser -UserPrincipalName jdoe@contoso.com -PasswordNeverExpires $true',
  'Set-ADAccountPassword -Identity jdoe -NewPassword (ConvertTo-SecureString -String $newPassword -AsPlainText -Force)',
  'ConvertTo-SecureString "$env:TEMP_PW" -AsPlainText -Force',
  '$sec = Read-Host "Enter password" -AsSecureString',
  'New-Object System.Management.Automation.PSCredential($user, $secPassword)',
  'Get-ADDefaultDomainPasswordPolicy',
  'Get-MgUserAuthenticationPasswordMethod -UserId jdoe@contoso.com',
  'Set-MgUserAuthenticationMethodPassword -UserId $id -AuthenticationMethodId 28c10230-6103-485e-b985-444c60001490',
  'Reset-MgUserAuthenticationMethodPassword -UserId $id -AuthenticationMethodId 28c10230-6103-485e-b985-444c60001490',
  'Get-MgReportAuthenticationMethodUserRegistrationDetail -Filter "isSsprRegistered eq false"',
  'net user jdoe /passwordreq:yes /passwordchg:yes',
  'net accounts /maxpwage:90 /minpwlen:14',
  'net use Z: \\\\fileserver\\share /user:contoso\\jdoe /persistent:yes',
  'net use \\\\fileserver\\share /user:contoso\\jdoe *',
  'runas /user:contoso\\admin "mmc.exe dsa.msc"',
  'cmdkey /list',
  'az login --service-principal -u $env:AZURE_CLIENT_ID -p $env:AZURE_CLIENT_SECRET --tenant $env:AZURE_TENANT_ID',
  'az login --service-principal --username $appId --password $secret --tenant contoso.onmicrosoft.com',
  'az keyvault secret show --vault-name kv-prod-01 --name db-password --query value -o tsv',
  'az keyvault secret set --vault-name kv-prod-01 --name db-password --value "$(cat pw.txt)"',
  'az storage account keys list --account-name stcontosoprod --resource-group rg-prod',
  'az ad sp credential reset --id $appId --display-name rotate-2026-09',
  'Connect-MgGraph -ClientSecretCredential $cred -TenantId contoso.onmicrosoft.com',
  '$token = Get-MsalToken -ClientId $id -TenantId $tenant; Connect-MgGraph -AccessToken ($token.AccessToken | ConvertTo-SecureString -AsPlainText -Force)',
  'Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $token" }',
  'Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $($token.AccessToken)" }',
  'curl -H "Authorization: Bearer $TOKEN" https://graph.microsoft.com/v1.0/me',
  'curl -H "Authorization: Bearer <access-token>" https://graph.microsoft.com/v1.0/me',
  'curl -u "$USER:$PASS" https://api.example.com/health',
  'curl -u admin https://api.example.com/health',
  'Authorization: Bearer {{token}}',
  'Authorization: Bearer YOUR_ACCESS_TOKEN',
  'password=<your-password>',
  'password=${DB_PASSWORD}',
  'password=%PASSWORD%',
  'password: ********',
  'Password: see the vault',
  'Password: contact the helpdesk',
  'token: null',
  '"password": ""',
  'secretName: db-password-1',
  'kind: Secret',
  '  secretKeyRef:\n    name: app-secrets\n    key: db-password',
  'Get-AzKeyVaultSecret -VaultName kv-prod-01 -Name db-password -AsPlainText',
  '$pwd = Get-Location; Set-Location $pwd',
  'cd $pwd; pwd',
  'openssl req -new -key server.key -out server.csr',
  'ssh -i ~/.ssh/id_ed25519 admin@bastion.contoso.com',
  'git clone https://github.com/contoso/scripts.git',
  'git clone git@github.com:contoso/scripts.git',
  'ssh://git@github.com/contoso/scripts.git',
  'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
  'https://login.microsoftonline.com/common/oauth2/nativeclient',
  'https://portal.azure.com/#@contoso.onmicrosoft.com/resource/subscriptions/00000000-0000-0000-0000-000000000000/overview',
  'https://sql.contoso.com:1433/database',
  'Server=tcp:sql.contoso.com,1433;Initial Catalog=Inventory;Authentication=Active Directory Default;',
  'Server=tcp:sql.contoso.com,1433;Database=Inv;User ID=sa;Password=${SQL_PASSWORD};',
  'Pwd was reset by helpdesk; Server rebooted at 03:00',
  // KQL containing hashes and GUIDs
  'DeviceProcessEvents | where SHA256 == "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f" | project Timestamp, DeviceName',
  'SigninLogs | where AppId == "1b730954-1685-4b74-9bfd-dac224a7b894" | summarize count() by UserPrincipalName',
  'AuditLogs | where OperationName has "password" | project TimeGenerated, InitiatedBy',
  'SigninLogs | where AuthenticationDetails has "Password" and ResultType == "50126"',
  'SigninLogs | where TokenIssuerType == "AzureAD" | summarize count() by AppDisplayName',
  'IdentityInfo | where AccountUPN endswith "@contoso.com" | project AccountUPN, PasswordLastSet',
  // Device IDs, Autopilot hardware hash (very long base64)
  'Get-WindowsAutopilotInfo -OutputFile C:\\hash.csv',
  'T0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PQ==',
  'Intune device id: 7d6e5f4c-3b2a-1908-7f6e-5d4c3b2a1908 / Azure AD device id 0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
  // Portal deep-links
  'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ConditionalAccessBlade/~/Policies',
  'https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesWindowsMenu/~/windowsEnrollment',
  'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/PasswordResetMenuBlade/~/Properties',
  'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/AuthenticationMethodsMenuBlade/~/PasswordProtection',
  'https://admin.microsoft.com/#/users/:/UserDetails/$id/Account/ResetPassword',
  // Misc admin strings
  'contoso.onmicrosoft.com',
  'Set-MsolDirSyncEnabled -EnableDirSync $false',
  'dsregcmd /status',
  'Get-MgServicePrincipal -Filter "appId eq \'00000003-0000-0000-c000-000000000000\'"',
  'sk-not-a-key', // too short for the API-key pattern
  'AKIAEXAMPLE', // too short
  'The token starts with eyJ but is not a JWT',
  '-----BEGIN CERTIFICATE-----',
  'Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) -RecordType ExchangeAdmin',
  'ghp_ is the GitHub prefix', // prefix alone
  'Set-Content -Path .\\out.txt -Value "Token lifetime: 1h"',
  'password: string; // TypeScript field',
  'Password must be at least 14 characters and contain 3 of 4 character classes',
  'Rotate the client secret every 90 days; see KB0012345',
  'The API key is stored in Key Vault under kv-prod-01/api-key-graph',
  'Get-Service -Name "Netlogon","W32Time","Spooler" | Format-Table -AutoSize',
  '*://*.microsoft.com/*',
  'https://admin.exchange.microsoft.com/*',
  'Get-MgUser -All -Property Id,DisplayName,SignInActivity | Select-Object -First 100',
];

const SECRETS: Array<[string, string]> = [
  // key material
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIE...', 'pem'],
  ['-----BEGIN PRIVATE KEY-----', 'pem'],
  ['-----BEGIN EC PRIVATE KEY-----', 'pem'],
  ['-----BEGIN OPENSSH PRIVATE KEY-----', 'pem'],
  ['-----BEGIN PGP PRIVATE KEY BLOCK-----', 'pem'],
  ['PuTTY-User-Key-File-3: ssh-ed25519', 'putty'],
  ['AGE-SECRET-KEY-1QYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQY', 'age'],
  // Microsoft
  ['Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL2dyYXBoLm1pY3Jvc29mdC5jb20ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'jwt'],
  ['$secret = "Ab18Q~kLmNoPqRsTuVwXyZ0123456789abcdefgh"', 'entra-client-secret'],
  ['-ClientSecret xY.7Q~kLmNoPqRsTuVwXyZ0123456789abcdefg', 'entra-client-secret'],
  ['Kfp8Q~4oT4X5C9mWaLpBSr_5CgRBz_3bzD9ZycRL', 'entra-client-secret'],
  ['0.AXoAv4j5cvGGr0GRqy180BHbR4hyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'entra-refresh-token'],
  ['ESTSAUTHPERSISTENT=0.AXoAv4j5cvGGr0GRqy180BHbR4hyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AgABAAEAAAD', 'ms-session-cookie'],
  ['FedAuth=77u/PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48U1A+VjEzLDBoLmZ8bWVtYmVyc2hpcHwxMDAzMjAwMGZm', 'ms-session-cookie'],
  ['DefaultEndpointsProtocol=https;AccountName=stg;AccountKey=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUA==;EndpointSuffix=core.windows.net', 'azure-storage-conn'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn+AStAbCdEA==', 'azure-storage-key'],
  ['https://stcontoso.blob.core.windows.net/backups?sv=2022-11-02&ss=b&srt=sco&sp=rwdlacx&se=2026-12-31T23:59:59Z&st=2026-09-01T00:00:00Z&spr=https&sig=abcDEF123456789%2Bxyz%2FABCDEFGHIJKLMNOPQRSTUVWXYZ%3D', 'azure-sas'],
  ['SharedAccessSignature sr=sb%3A%2F%2Fcontoso.servicebus.windows.net%2F&sig=abcdefghijklmnopqrstuvwxyz0123456789ABCD%3D&se=1700000000&skn=RootManageSharedAccessKey', 'azure-sas'],
  ['https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=abcdefghijklmnopqrstuvwxyz0123456789ABCD', 'azure-sas'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnACDbAbCdEQ==', 'azure-cosmos-key'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFG+AEhAAbCdE=', 'azure-messaging-key'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFG+ASbBAbCdE=', 'azure-messaging-key'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGAzCaAAbCdE=', 'azure-redis-key'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRAzFuAbCdEg==', 'azure-functions-key'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPAzSeAAbCdE', 'azure-search-key'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP+ACRAAbCdE', 'azure-acr-key'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZJQQJ99AABCDEFGHIJKLMNOPQRSTUVWXYZ', 'azure-cask'],
  ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnAZDOabcd', 'azure-devops-pat'],
  ['administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::', 'ntlm'],
  // AWS / Google
  ['aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'aws'],
  ['ASIAIOSFODNN7EXAMPLE', 'aws'],
  ['aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'aws-secret'],
  ['AIzaSyA1234567890abcdefghijklmnopqrstuv', 'google'],
  ['ya29.a0AfH6SMBx1234567890abcdefghijklmnopqrstuvwxyz', 'google-oauth'],
  ['{ "type": "service_account", "project_id": "contoso" }', 'gcp-service-account'],
  // source control / packages
  ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij', 'github'],
  ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', 'github-pat'],
  ['glpat-abcdefghijklmnopqrst', 'gitlab'],
  ['npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij', 'npm'],
  ['pypi-AgEIcHlwaS5vcmcCJDAxMjM0NTY3ODktYWJjZC1lZmdoLWlqa2wtbW5vcHFyc3R1dnd4', 'pypi'],
  ['dckr_pat_abcdefghijklmnopqrstuvwxyz', 'docker'],
  ['ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789', 'atlassian'],
  ['dapi0123456789abcdef0123456789abcdef', 'databricks'],
  ['PMAK-0123456789abcdef01234567-0123456789abcdef0123456789abcdef01', 'postman'],
  ['hvs.abcdefghijklmnopqrstuvwxyz0123', 'hashicorp'],
  ['dop_v1_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'digitalocean'],
  ['tskey-auth-kABCDEF1CNTRL-abcdefghijklmnopqrstuvwxyz', 'tailscale'],
  ['ops_eyJzaWduSW5BZGRyZXNzIjoibXkuMXBhc3N3b3JkLmNvbSIsInVzZXJBdXRoIjp7Im1ldGhvZCI6IlNSUGctNDA5NiJ9fQ', 'onepassword'],
  // chat / SaaS / AI
  ['xoxb-1234567890-abcdefghijkl', 'slack'],
  ['https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX', 'slack-webhook'],
  ['https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef', 'discord-webhook'],
  ['123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0', 'telegram'],
  ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', 'openai-anthropic'],
  ['OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789', 'openai-anthropic'],
  ['hf_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh', 'huggingface'],
  ['sk_live_abcdefghijklmnopqrstuvwx', 'stripe'],
  ['SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ', 'sendgrid'],
  ['SK0123456789abcdef0123456789abcdef', 'twilio'],
  ['shpat_0123456789abcdef0123456789abcdef', 'shopify'],
  ['0123456789abcdef0123456789abcdef-us12', 'mailchimp'],
  ['key-0123456789abcdef0123456789abcdef', 'mailgun'],
  // structural
  ['https://admin:Hunter2!@sql.contoso.com/db', 'url-userinfo'],
  ['Authorization: Basic YWRtaW46SHVudGVyMiE=', 'basic-auth'],
  ['Authorization: Bearer 8f3a1c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5', 'bearer'],
  ['Server=tcp:sql.contoso.com,1433;Database=Inv;User ID=sa;Password=Hunter2!;', 'sql-conn'],
  ['Data Source=.;Initial Catalog=X;Pwd = topsecret ;', 'sql-conn'],
  // context: keyword + literal
  ['password=Hunter2!', 'kw-assign'],
  ['Password: Summer2026!', 'kw-assign'],
  ['"password": "xWwvJ]6NMw+bWH-d"', 'kw-assign'],
  ["'client_secret' => 'a1b2c3d4e5f6g7h8'", 'kw-assign'],
  ['DB_PASSWORD=Hunter2!Hunter2!', 'kw-assign'],
  ['MSSQL_SA_PASSWORD=YourStrong!Passw0rd', 'kw-assign'],
  ['AZURE_CLIENT_SECRET=abc123DEF456ghi789', 'kw-assign'],
  ['$env:ARM_CLIENT_SECRET = "abc123DEF456ghi789"', 'kw-assign'],
  ['client_secret=abc123DEF456ghi789&grant_type=client_credentials', 'kw-assign'],
  ['api_key: 0123456789abcdef', 'kw-assign'],
  ['Ocp-Apim-Subscription-Key: 0123456789abcdef0123456789abcdef', 'kw-assign'],
  ['x-functions-key: abcDEF123456789xyz==', 'kw-assign'],
  ['cmdkey /add:fileserver /user:contoso\\svc /pass:P@ssw0rd2026', 'kw-assign'],
  ['ALTER LOGIN sa WITH PASSWORD = \'Str0ng!Passw0rd\'', 'kw-assign'],
  ["CREATE ROLE app WITH LOGIN PASSWORD 'Str0ng!Passw0rd'", 'kw-assign'],
  ['token=8f3a1c2d4e5f6071', 'kw-assign'],
  // context: parameter + literal
  ['-Password "Hunter2!"', 'kw-param'],
  ['Set-ADAccountPassword -Identity jdoe -Reset -NewPassword "TempP@ss2026"', 'kw-param'],
  ['Set-MsolUserPassword -UserPrincipalName jdoe@contoso.com -NewPassword TempP@ss2026 -ForceChangePassword $true', 'kw-param'],
  ['az login --service-principal -u $appId --password abc123DEF456 --tenant x', 'kw-param'],
  ['az storage blob upload --account-name st --account-key abcDEF123456789==', 'kw-param'],
  ["--client-secret 'abc123DEF456ghi789'", 'kw-param'],
  ['gh auth login --with-token abc123DEF456ghi789', 'kw-param'],
  // context: PowerShell / SQL / CLI shapes
  ['$sec = ConvertTo-SecureString "P@ssw0rd!" -AsPlainText -Force', 'ps-securestring'],
  ['ConvertTo-SecureString -String \'P@ssw0rd!\' -AsPlainText -Force', 'ps-securestring'],
  ['ConvertTo-SecureString -AsPlainText -Force -String "P@ssw0rd!"', 'ps-securestring'],
  ['New-Object PSCredential("contoso\\svc", (ConvertTo-SecureString "P@ssw0rd!" -AsPlainText -Force))', 'ps-securestring'],
  ["CREATE USER 'app'@'%' IDENTIFIED BY 'Str0ng!Passw0rd'", 'sql-identified-by'],
  ['curl -u admin:Hunter2! https://api.example.com/health', 'curl-user'],
  ['net use Z: \\\\fileserver\\share /user:contoso\\jdoe P@ssw0rd2026', 'net-use'],
];

describe('guards — false-positive fixture set (must be empty)', () => {
  it('has at least 100 legitimate fixtures', () => expect(LEGIT.length).toBeGreaterThanOrEqual(100));
  it.each(LEGIT)('no warning for %s', (s) => {
    expect(detectSecret(s)).toBeNull();
  });
  it.each(LEGIT)('no warning for %s even under a label that says "password"', (s) => {
    expect(detectSecret(s, 'Admin password')).toBeNull();
  });
});

describe('guards — true positives', () => {
  it.each(SECRETS)('warns for %s', (s, id) => {
    expect(detectSecret(s)?.id).toBe(id);
  });
  it('variables, placeholders and expressions after password= are NOT flagged', () => {
    expect(detectSecret('-Password $cred')).toBeNull();
    expect(detectSecret('-Password (Read-Host -AsSecureString)')).toBeNull();
    expect(detectSecret('password=$env:PW')).toBeNull();
    expect(detectSecret('password={{ vault_pw }}')).toBeNull();
    expect(detectSecret('password=[REDACTED]')).toBeNull();
    expect(detectSecret('password=@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/db)')).toBeNull();
  });
  it('a bare word after password= without a digit or symbol is NOT flagged', () => {
    expect(detectSecret('password=changeme')).toBeNull();
    expect(detectSecret('Password: rotated')).toBeNull();
  });
  it('a bare high-entropy shape without a marker or keyword never fires', () => {
    expect(detectSecret('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBeNull(); // AWS secret key shape, no key name
    expect(detectSecret('Kfp8Q4oT4X5C9mWaLpBSr5CgRBz3bzD9ZycRL')).toBeNull(); // Entra-like, marker removed
  });
  it('handles empty input', () => expect(detectSecret('')).toBeNull());
  it('reports the tier', () => {
    expect(detectSecret('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')?.kind).toBe('format');
    expect(detectSecret('password=Hunter2!')?.kind).toBe('context');
  });
});

describe('guards — label-assisted rule', () => {
  it('flags a bare password-shaped value under a label that names a password or secret', () => {
    expect(detectSecret('Summer2026!', 'Break-glass admin password')?.id).toBe('label-context');
    expect(detectSecret('Hunter2', 'sa password')?.id).toBe('label-context');
    expect(detectSecret('JBSWY3DPEHPK3PXP', 'MFA secret')?.id).toBe('label-context');
    expect(detectSecret('P@ssw0rd', 'Password')?.id).toBe('label-context');
    expect(detectSecret('abc123DEF456', 'Graph API key')?.id).toBe('label-context');
  });
  it('does not fire without a label', () => {
    expect(detectSecret('Summer2026!')).toBeNull();
    expect(detectSecret('Summer2026!', '')).toBeNull();
  });
  it('does not fire when the label is about the concept rather than a value', () => {
    expect(detectSecret('Summer2026!', 'Password policy example')).toBeNull();
    expect(detectSecret('kv-secret-prod-01', 'Secret name')).toBeNull();
    expect(detectSecret('28c10230-6103-485e-b985-444c60001490', 'Password method id')).toBeNull();
    expect(detectSecret('90', 'Password expiry days')).toBeNull();
  });
  it('does not fire on values that are known non-secret shapes', () => {
    expect(detectSecret('72f988bf-86f1-41af-91ab-2d7cd011db47', 'Tenant password')).toBeNull(); // GUID
    expect(detectSecret('A909502DD82AE41433E6F83886B00D4277A32A7B', 'Cert secret')).toBeNull(); // thumbprint
    expect(detectSecret('Get-ADDefaultDomainPasswordPolicy', 'Password')).toBeNull(); // cmdlet
    expect(detectSecret('jdoe2@contoso.com', 'Password')).toBeNull(); // UPN
    expect(detectSecret('https://aka.ms/sspr', 'Password')).toBeNull(); // URL
    expect(detectSecret('srv-dc01.contoso.local', 'Password')).toBeNull(); // hostname
    expect(detectSecret('C:\\Temp\\pw1.txt', 'Password')).toBeNull(); // path
    expect(detectSecret('$env:ADMIN_PW', 'Password')).toBeNull(); // variable
    expect(detectSecret('PasswordNeverExpires', 'Password attribute')).toBeNull(); // no digit/symbol
    expect(detectSecret('Set-ADAccountPassword -Identity jdoe', 'Password')).toBeNull(); // multi-token
  });
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
  it('pattern ids are unique', () => {
    const ids = SECRET_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('pathological inputs at the 2000-char cap finish quickly (no catastrophic backtracking)', () => {
    const cases = [
      'a'.repeat(2000),
      '-'.repeat(2000),
      '-a'.repeat(1000),
      'a-'.repeat(1000),
      'password=' + '"'.repeat(1990),
      '-Password ' + "'".repeat(1990),
      'password=' + ' '.repeat(1990),
      'ConvertTo-SecureString ' + '-x '.repeat(600) + '-AsPlainText',
      'net use ' + '/user:a '.repeat(240),
      'https://' + 'a:'.repeat(990),
      'Bearer ' + 'a'.repeat(1990),
      ('password: ' + 'x'.repeat(30) + '\n').repeat(50),
    ];
    for (const c of cases) {
      const t0 = performance.now();
      detectSecret(c, 'Admin password');
      expect(performance.now() - t0, `slow on ${c.slice(0, 30)}…`).toBeLessThan(50);
    }
  });
});
