# Native Windows deployment path for the self-hosted Docker stack.
# Mirrors deploy.sh when WSL/Bash is unavailable: production preflight → cold host
# build → migrations/RLS → app+worker swap → health gate. Run from PowerShell:
#   npm run deploy:windows
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) { throw "missing .env - deployment secrets must be supplied on the host." }

# Compose and the host-side scripts must use the same environment. This intentionally
# does not print values, as the file contains production secrets.
Get-Content ".env" | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $name, $value = $matches[1], $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path ("Env:" + $name) -Value $value
  }
}
$env:NODE_ENV = "production"

Write-Host "> 1/7 production environment preflight..."
npm run env:production:check

Write-Host "> 2/7 cold host build..."
$cache = Join-Path $root ".next\cache\turbopack"
if (Test-Path $cache) { Remove-Item -LiteralPath $cache -Recurse -Force }
$env:NODE_OPTIONS = "--max-old-space-size=8192"
npm run build

Write-Host "> 3/7 copy standalone assets..."
Copy-Item ".next\static" ".next\standalone\.next\" -Recurse -Force
Copy-Item "public" ".next\standalone\" -Recurse -Force
Copy-Item ".env" ".next\standalone\.env" -Force

Write-Host "> 4/7 apply migrations and RLS..."
npm run db:migrate
npm run db:rls

Write-Host "> 5/7 save rollback image..."
$previous = (docker inspect sellerctrl-app --format '{{.Image}}' 2>$null)
if ($previous) { docker tag $previous sellerctrl-app:rollback }

Write-Host "> 6/7 build and swap containers..."
Push-Location "docker"
try { docker compose --env-file ../.env --profile app up -d --build app worker } finally { Pop-Location }

Write-Host "> 7/7 health gate..."
for ($i = 0; $i -lt 20; $i++) {
  $app = docker inspect --format '{{.State.Health.Status}}' sellerctrl-app 2>$null
  $worker = docker inspect --format '{{.State.Health.Status}}' sellerctrl-worker 2>$null
  if ($app -eq "healthy" -and $worker -eq "healthy") {
    Write-Host "deployed and healthy."
    exit 0
  }
  Start-Sleep -Seconds 6
}

if ($previous) {
  Write-Error "new containers did not become healthy - rolling back"
  docker tag sellerctrl-app:rollback sellerctrl-app:latest
  Push-Location "docker"
  try { docker compose --env-file ../.env --profile app up -d --no-build app worker } finally { Pop-Location }
}
throw "Deployment health gate failed."
