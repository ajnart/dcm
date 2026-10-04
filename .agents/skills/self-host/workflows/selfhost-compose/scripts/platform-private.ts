import { chmodSync, lstatSync, type Stats } from "node:fs";
import { spawnSync } from "node:child_process";

export function privateMode(stat: Stats, expected: number): boolean {
  if (process.platform === "win32") return true;
  return (stat.mode & 0o7777) === expected;
}

export function ownedByCurrentUser(stat: Stats): boolean {
  if (process.platform === "win32") return true;
  return typeof process.getuid === "function" && stat.uid === process.getuid();
}

function windowsAcl(path: string, protect: boolean): void {
  const script = `
$ErrorActionPreference = 'Stop'
$p = [Environment]::GetEnvironmentVariable('SELFHOST_PRIVATE_PATH')
$item = Get-Item -LiteralPath $p -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $p
if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
$allowed = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
${protect ? `
if ($item.PSIsContainer) { $acl = New-Object System.Security.AccessControl.DirectorySecurity }
else { $acl = New-Object System.Security.AccessControl.FileSecurity }
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in $allowed) {
  $identitySid = New-Object System.Security.Principal.SecurityIdentifier($identity)
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  if ($item.PSIsContainer) { $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identitySid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $p -AclObject $acl
$acl = Get-Acl -LiteralPath $p
` : ""}
if (-not $acl.AreAccessRulesProtected) { throw 'inherited ACL' }
$ownerAllow = $false
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($rule.IsInherited) { throw 'inherited rule' }
  if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
    if ($allowed -notcontains $rule.IdentityReference.Value) { throw 'broad ACL' }
    if ($rule.IdentityReference.Value -eq $sid.Value -and ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) { $ownerAllow = $true }
  }
}
if (-not $ownerAllow) { throw 'missing owner permission' }
`;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { ...process.env, SELFHOST_PRIVATE_PATH: path }, timeout: 10000, maxBuffer: 16384, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("Private storage owner or ACL verification failed");
}

export function assertPrivatePath(path: string, mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !ownedByCurrentUser(stat) || !privateMode(stat, mode)) {
    throw new Error("Private storage must be current-user-owned with exact private permissions");
  }
  if (process.platform === "win32") windowsAcl(path, false);
}

/** Use only for newly created storage, before writing any private payload. */
export function protectPrivatePath(path: string, mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !ownedByCurrentUser(stat)) throw new Error("Private storage owner is unsafe");
  if (process.platform === "win32") windowsAcl(path, true);
  else chmodSync(path, mode);
  assertPrivatePath(path, mode);
}
