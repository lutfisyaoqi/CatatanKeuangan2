$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot

& (Join-Path $projectDir 'stop-web.ps1')

Push-Location $projectDir
try {
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'Build frontend gagal; server ringan tidak dijalankan.'
  }

  & (Join-Path $projectDir 'run-web.ps1')
} finally {
  Pop-Location
}
