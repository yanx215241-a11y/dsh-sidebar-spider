<#
.SYNOPSIS
  Install the DSH Sidebar Spider client plugin into a local DSH desktop profile.

.DESCRIPTION
  Appends one `- insert:` row to <DSH_HOME>\profiles\<Profile>\cordis.patch.yml so the
  DSH desktop app hot-loads plugin/lib/index.js as a client plugin. The previous patch
  file is backed up next to it. Re-running is safe (it detects the existing row).

.PARAMETER Profile
  DSH profile name. Default: desktop (the profile used by the DSH desktop app).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

# --- locate this repo + the plugin host entry -------------------------------
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostEntry = Join-Path $root 'plugin\lib\index.js'
if (-not (Test-Path -LiteralPath $hostEntry)) {
    throw "Missing plugin entry: $hostEntry (run install.ps1 from the repository root)."
}

# --- locate the DSH profile -------------------------------------------------
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$patchFile = Join-Path $profileDir 'cordis.patch.yml'
if (-not (Test-Path -LiteralPath $profileDir)) {
    throw "DSH profile not found: $profileDir`nStart the DSH desktop app once (so it creates the profile), then re-run."
}
if (-not (Test-Path -LiteralPath $patchFile)) {
    Set-Content -LiteralPath $patchFile -Value "[]`r`n" -Encoding UTF8
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$fileUrl = 'file:///' + ($hostEntry -replace '\\', '/')
$content = [System.IO.File]::ReadAllText($patchFile)
$existing = [regex]::Match($content, "(?ms)^(\s*-\s*id:\s*ui-sidebar-spider\s*\r?\n\s*name:\s*')([^']+)(')")
if ($existing.Success) {
    $recorded = $existing.Groups[2].Value
    if ($recorded -eq $fileUrl) {
        Write-Host "[install] Sidebar Spider is already installed with this path: $recorded"
        exit 0
    }
    $backup = "$patchFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $patchFile -Destination $backup -Force
    $updated = $content.Substring(0, $existing.Groups[2].Index) + $fileUrl + $content.Substring($existing.Groups[2].Index + $existing.Groups[2].Length)
    [System.IO.File]::WriteAllText($patchFile, $updated, $utf8NoBom)
    Write-Host '[install] Updated the recorded plugin path:'
    Write-Host "         old: $recorded"
    Write-Host "         new: $fileUrl"
    Write-Host "         backup: $backup"
    Write-Host '[install] DSH hot-reloads the plugin within a few seconds.'
    exit 0
}

# --- append the loader row --------------------------------------------------
$backup = "$patchFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $patchFile -Destination $backup -Force

$block = @(
    ''
    '# Sidebar Spider plugin (installed by install.ps1). Remove this block to uninstall.'
    '- insert:'
    '    - id: ui-sidebar-spider'
    "      name: '$fileUrl'"
) -join "`r`n"

$newContent = $content.TrimEnd() + "`r`n" + $block + "`r`n"
[System.IO.File]::WriteAllText($patchFile, $newContent, $utf8NoBom)

Write-Host '[install] Done.'
Write-Host "         patch:  $patchFile"
Write-Host "         entry:  $fileUrl"
Write-Host "         backup: $backup"
Write-Host '[install] DSH hot-reloads the plugin within a few seconds (no app restart).'
Write-Host '[install] Open it from the right sidebar "+" -> guide -> Spider, or run a web search in any session.'
