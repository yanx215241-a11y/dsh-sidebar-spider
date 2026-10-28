<#
.SYNOPSIS
  Push this repository to https://github.com/yanx215241-a11y/dsh-sidebar-spider
  (one-click helper; run it from the repository folder).

.DESCRIPTION
  - verifies this folder is a git repository with a clean status
  - sets (or fixes) the "origin" remote to the target repository
  - pushes the local "main" branch
  - if the first push is rejected, tries a rebase pull and pushes again
  - opens the repository page when done

  The first run will let Git Credential Manager ask you to sign in to GitHub
  (browser window / token). No token is stored in this script.

.PARAMETER DryRun
  Only configure the remote and print what would be pushed; no network access.
#>
[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$remote = 'https://github.com/yanx215241-a11y/dsh-sidebar-spider.git'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repo

Write-Host '=== DSH Sidebar Spider · one-click push ===' -ForegroundColor Cyan
Write-Host "repo:   $repo"
Write-Host "remote: $remote"

if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    throw "This folder is not a git repository: $repo"
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'git was not found on PATH. Install Git for Windows first.'
}

# --- local status -----------------------------------------------------------
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "branch: $branch"
$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0) {
    Write-Host 'WARNING: there are uncommitted changes in this folder:' -ForegroundColor Yellow
    $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
    Write-Host 'They will NOT be pushed. Commit them first (or ignore this warning).'
}

$log = @(git log --oneline -n 5)
Write-Host 'recent commits:'
$log | ForEach-Object { Write-Host "  $_" }

# --- make sure origin points at the target ---------------------------------
$existing = $null
try { $existing = (git remote get-url origin 2>$null) } catch { $existing = $null }
if (-not $existing) {
    git remote add origin $remote
    Write-Host "added remote origin -> $remote"
} elseif ($existing.Trim() -ne $remote) {
    git remote set-url origin $remote
    Write-Host "updated remote origin: $existing -> $remote"
} else {
    Write-Host 'remote origin already correct.'
}

Write-Host ''
Write-Host 'push command that will run:'
Write-Host "  git push -u origin $branch"
Write-Host ''

if ($DryRun) {
    Write-Host 'DryRun: skipped the actual network push.' -ForegroundColor Yellow
    exit 0
}

# --- push ------------------------------------------------------------------
git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'First push failed. Trying to sync with the remote (pull --rebase) and retry...' -ForegroundColor Yellow
    git pull --rebase origin $branch
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'pull --rebase failed. Common reasons:' -ForegroundColor Red
        Write-Host '  - the repository is brand new/empty (then just run the push again; it usually works)'
        Write-Host '  - you are not signed in to GitHub (Git Credential Manager should open a login window)'
        Write-Host '  - network/proxy issue'
        throw "git pull --rebase exited with $LASTEXITCODE"
    }
    git push -u origin $branch
    if ($LASTEXITCODE -ne 0) {
        throw "git push still failed (exit $LASTEXITCODE). Send this window's output to the assistant."
    }
}

Write-Host ''
Write-Host 'SUCCESS. Repository page: https://github.com/yanx215241-a11y/dsh-sidebar-spider' -ForegroundColor Green
try { Start-Process 'https://github.com/yanx215241-a11y/dsh-sidebar-spider' } catch { }
Write-Host ''
Write-Host 'Press Enter to close.'
Read-Host | Out-Null
