$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 first.' }
if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw 'Install JDK 17 or newer first.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
if (-not (Test-Path -LiteralPath 'frontend/node_modules')) { npm --prefix frontend ci; if ($LASTEXITCODE -ne 0) { throw 'Angular dependency installation failed.' } }
if (Test-Path -LiteralPath '../openrouter token.txt') {
  node scripts/configure-local-ai.mjs '../openrouter token.txt'
  if ($LASTEXITCODE -ne 0) { throw 'AI configuration failed.' }
}
Write-Host 'Autopost: http://127.0.0.1:5173'
npm run dev
