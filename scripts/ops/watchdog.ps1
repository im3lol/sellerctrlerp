# SellerCtrl watchdog — a Task Scheduler job every 5 minutes, independent of everything else.
#
# Why it exists: on 12 Sep 2026 the tunnel supervisor (supervise-tunnel.ps1) died with the
# process that had launched it and took cloudflared with it. The app and the containers
# were healthy the whole time, yet the public site answered Cloudflare error 1033 for
# hours and nothing paged: the only alert lived inside the supervisor that had died, and
# it watched the LOCAL app, not the public URL.
#
# Each run:
#   1. Supervisor missing (its single-instance mutex isn't held) -> relaunch it through WMI,
#      so its parent is WmiPrvSE and nothing that exits later can take it down with it.
#   2. Public URL failing -> page after two runs in a row (~10 min), saying whether it's the
#      tunnel (local app fine) or the app itself (local app down too).
#   3. Local app down -> judged on the CONTAINERS, not on a Docker Desktop window:
#      engine not answering -> start Docker Desktop (or restart it after ~15 min wedged);
#      engine fine but the stack stopped -> docker compose up -d. A clean SIGTERM shutdown
#      (reboot) leaves `restart: unless-stopped` containers down, which is how 6 Oct 2026
#      stayed broken for 36 hours while this branch only checked for the process.
#   4. One message when it goes wrong, one when it's back.
$ErrorActionPreference = 'SilentlyContinue'

$dir    = 'C:\Users\3lyge\sellerctrl-tunnel'
$state  = Join-Path $dir 'watchdog-state.json'
$log    = Join-Path $dir 'watchdog.log'
$public = 'https://app.sellerctrl.com/api/health'
$local  = 'http://localhost:3001/api/health'
$supervisorCmd = 'powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -NonInteractive -File "C:\Users\3lyge\sellerctrl-tunnel\supervise-tunnel.ps1"'

function Log([string]$m) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 200KB) { Remove-Item $log }
  Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $m) -Encoding utf8
}

# Same Telegram credentials the app uses, read from the project's .env — no second copy.
$tg = @{}
foreach ($line in Get-Content 'E:\Dev\Ctrl ERP\.env') {
  if ($line -match '^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)\s*=\s*"?([^"#\s]+)"?') { $tg[$matches[1]] = $matches[2] }
}
function Send-Alert([string]$text) {
  if (-not $tg.TELEGRAM_BOT_TOKEN -or -not $tg.TELEGRAM_CHAT_ID) { Log "alert skipped (no Telegram keys): $text"; return }
  # One retry: a dropped alert is a silent outage, and Telegram hands out the odd transient
  # 400/429 (seen 7 Oct 2026 on a message that sent fine seconds later).
  $body = @{ chat_id = $tg.TELEGRAM_CHAT_ID; text = $text; disable_web_page_preview = $true } | ConvertTo-Json -Compress
  foreach ($attempt in 1, 2) {
    try {
      Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$($tg.TELEGRAM_BOT_TOKEN)/sendMessage" `
        -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 10 | Out-Null
      Log "alert sent: $text"
      return
    } catch {
      Log "alert attempt $attempt FAILED: $($_.Exception.Message)"
      if ($attempt -eq 1) { Start-Sleep -Seconds 5 }
    }
  }
}

function Up([string]$url, [int]$timeout) {
  try { return (Invoke-WebRequest $url -TimeoutSec $timeout -UseBasicParsing).StatusCode -eq 200 } catch { return $false }
}

$s = @{ publicFails = 0; alerted = $false; downSince = $null; engineFails = 0 }
if (Test-Path $state) {
  try { $j = Get-Content $state -Raw | ConvertFrom-Json; $s.publicFails = [int]$j.publicFails; $s.alerted = [bool]$j.alerted; $s.downSince = $j.downSince; $s.engineFails = [int]$j.engineFails } catch { }
}

# 1. Is the supervisor alive? It holds this mutex for as long as it runs; when it dies the
#    OS drops the mutex. Checking the mutex, not the process list, means our own command
#    line can never be mistaken for the supervisor's.
$m = $null
if ([System.Threading.Mutex]::TryOpenExisting('Global\SellerCtrlTunnelSupervisor', [ref]$m)) {
  $m.Dispose()
} else {
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $supervisorCmd }
  Log "supervisor missing -> relaunched via WMI (pid $($r.ProcessId), rc $($r.ReturnValue))"
  Send-Alert "⚠️ SellerCtrl: سكربت النفق كان واقف — شغّلته تاني تلقائياً."
  Start-Sleep -Seconds 25   # let cloudflared register before judging the public URL
}

# 2. Public vs local.
$pub = Up $public 20
$loc = Up $local 8
if ($pub) {
  if ($s.alerted) { Send-Alert ("✅ SellerCtrl رجع يوصل من برّه — كان واقف من " + $s.downSince) }
  if ($s.publicFails -gt 0) { Log "public recovered after $($s.publicFails) failed check(s)" } else { Log "ok" }
  $s.publicFails = 0; $s.alerted = $false; $s.downSince = $null
} else {
  $s.publicFails++
  if (-not $s.downSince) { $s.downSince = (Get-Date).ToString('HH:mm') }
  Log "public DOWN (local app up=$loc, consecutive=$($s.publicFails))"
  # 3. The app itself is down. Judge by what actually serves the site — the containers —
  #    not by whether a Docker Desktop window exists. On 6 Oct 2026 the containers stopped
  #    after a reboot (clean SIGTERM, so `restart: unless-stopped` did NOT bring them back)
  #    while Docker Desktop's process kept running, and this branch stayed silent for 36 hours.
  if (-not $loc) {
    docker ps --format '{{.Names}}' 2>$null | Out-Null
    $engineOk = ($LASTEXITCODE -eq 0)
    if (-not $engineOk) {
      $s.engineFails++
      if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
        Log "Docker Desktop was not running -> started it"
      } elseif ($s.engineFails -ge 3) {
        # Running but not answering for ~15 min: the engine is wedged, so restart the lot.
        Get-Process 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 5
        Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
        Log "Docker engine wedged for $($s.engineFails) runs -> restarted Docker Desktop"
        Send-Alert "⚠️ SellerCtrl: محرك Docker كان معلّق — أعدت تشغيله تلقائياً."
        $s.engineFails = 0
      } else {
        Log "Docker Desktop is running but its engine is not answering (strike $($s.engineFails)/3)"
      }
    } else {
      $s.engineFails = 0
      $running = docker ps --filter 'name=sellerctrl-app' --filter 'status=running' --format '{{.Names}}'
      if (-not $running) {
        Push-Location 'E:\Dev\Ctrl ERP\docker'
        docker compose --env-file '..\.env' --profile app up -d 2>&1 | Out-Null
        $rc = $LASTEXITCODE
        Pop-Location
        Log "containers were stopped -> docker compose up -d (exit $rc)"
        Send-Alert "⚠️ SellerCtrl: كونتينرات النظام كانت واقفة — شغّلتها تلقائياً."
      }
    }
  }
  if ($s.publicFails -ge 2 -and -not $s.alerted) {
    $why = if ($loc) { "التطبيق شغّال على الجهاز، والمشكلة في النفق (Cloudflare)." } else { "التطبيق نفسه واقف على الجهاز (Docker) — بحاول أشغّله تلقائياً." }
    Send-Alert ("🔴 SellerCtrl مش بيوصل من برّه من " + $s.downSince + " — " + $why)
    $s.alerted = $true
  }
}
$s | ConvertTo-Json | Set-Content -Path $state -Encoding utf8
