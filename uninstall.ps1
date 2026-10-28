<#
.SYNOPSIS
  Uninstall the DSH Sidebar Spider client plugin from a local DSH desktop profile.

.DESCRIPTION
  Removes the `# Sidebar Spider plugin` comment + `- insert:` block from
  <DSH_HOME>\profiles\<Profile>\cordis.patch.yml (the file is backed up first).
  DSH hot-reloads the profile, so the Spider tab disappears within seconds.

.PARAMETER Profile
  DSH profile name. Default: desktop.

.PARAMETER DryRun
  Only report what would be removed; do not write the patch file.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$patchFile = Join-Path $dshHome "profiles\$Profile\cordis.patch.yml"
if (-not (Test-Path -LiteralPath $patchFile)) {
    Write-Host "[uninstall] Patch file not found: $patchFile (nothing to do)."
    exit 0
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($patchFile)
$pattern = '(?ms)^# Sidebar Spider plugin[^\r\n]*\r?\n(?:[ \t]*(?:#[^\r\n]*)?\r?\n)*- insert:\r?\n(?:[ \t]+[^\r\n]*\r?\n?)*'
if ($content -notmatch $pattern) {
    Write-Host "[uninstall] No Sidebar Spider block found in $patchFile (nothing to do)."
    exit 0
}

$blockMatch = [regex]::Match($content, $pattern)
Write-Host "[uninstall] Removing $($blockMatch.Value.Split("`n").Count) line(s) from $patchFile"
if ($DryRun) {
    Write-Host '[uninstall] DryRun: no changes written.'
    exit 0
}

$backup = "$patchFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $patchFile -Destination $backup -Force

$newContent = [regex]::Replace($content, $pattern, '')
$newContent = $newContent.TrimEnd() + "`r`n"
[System.IO.File]::WriteAllText($patchFile, $newContent, $utf8NoBom)

Write-Host '[uninstall] Done. DSH unloads the plugin within a few seconds.'
Write-Host "            backup: $backup"
