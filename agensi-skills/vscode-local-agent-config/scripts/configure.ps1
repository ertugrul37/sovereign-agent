<#
.TITLE
    configure.ps1 — VS Code Local AI Agent Configurator (Windows)

.DESCRIPTION
    Interactive PowerShell script that configures local AI providers (Ollama,
    LM Studio, llama.cpp, OpenAI-compatible) for VS Code extensions:
      - Sovereign Agent (sovereignAgent.* settings in settings.json)
      - Continue.dev  (~/.continue/config.json models array)

    Validates that the target URL is local-only, tests endpoint connectivity,
    creates a backup before writing, and merges without clobbering existing config.

.USAGE
    .\configure.ps1

.PARAMETERS
    All parameters are gathered interactively at runtime.

.PREREQUISITES
    - PowerShell 5.1 or later
    - VS Code installed (for Sovereign Agent)
    - Continue.dev VS Code extension installed (for Continue.dev)
    - The chosen AI server running and reachable on the local network

.NOTES
    Author  : Agensi.io vscode-local-agent-config skill
    Version : 1.0.0
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Colour helpers ────────────────────────────────────────────────────────────
function Write-Header  { param([string]$msg) Write-Host "`n$msg" -ForegroundColor Cyan }
function Write-Step    { param([string]$msg) Write-Host "  » $msg" -ForegroundColor White }
function Write-Success { param([string]$msg) Write-Host "  ✔ $msg" -ForegroundColor Green }
function Write-Warn    { param([string]$msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Err     { param([string]$msg) Write-Host "  ✖ $msg" -ForegroundColor Red }

# ── Banner ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   VS Code Local AI Agent Configurator (Windows)  ║" -ForegroundColor Cyan
Write-Host "║   vscode-local-agent-config · Agensi.io skill    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan

# ── Helper: safe JSON read ────────────────────────────────────────────────────
function Read-JsonFile {
    param([string]$Path)
    if (Test-Path $Path) {
        try {
            $raw = Get-Content $Path -Raw -Encoding UTF8
            if ([string]::IsNullOrWhiteSpace($raw)) { return [PSCustomObject]@{} }
            return $raw | ConvertFrom-Json
        } catch {
            Write-Warn "Could not parse existing JSON at '$Path'. Starting fresh."
            return [PSCustomObject]@{}
        }
    }
    return [PSCustomObject]@{}
}

# ── Helper: set nested property on PSCustomObject ─────────────────────────────
function Set-JsonProperty {
    param([PSCustomObject]$Obj, [string]$Key, $Value)
    if ($Obj.PSObject.Properties[$Key]) {
        $Obj.$Key = $Value
    } else {
        $Obj | Add-Member -NotePropertyName $Key -NotePropertyValue $Value
    }
}

# ── Helper: backup a file ─────────────────────────────────────────────────────
function Backup-File {
    param([string]$Path)
    if (Test-Path $Path) {
        $bak = "$Path.bak"
        Copy-Item -Path $Path -Destination $bak -Force
        Write-Step "Backup created: $bak"
    }
}

# ── Helper: ensure directory exists ──────────────────────────────────────────
function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        Write-Step "Created directory: $Path"
    }
}

# ── Step 1: Choose extension(s) ───────────────────────────────────────────────
Write-Header "Step 1 — Choose extension(s) to configure"
Write-Host "  [1] Sovereign Agent" -ForegroundColor White
Write-Host "  [2] Continue.dev" -ForegroundColor White
Write-Host "  [3] Both" -ForegroundColor White
do {
    $extChoice = Read-Host "  Your choice (1/2/3)"
} until ($extChoice -in @('1','2','3'))

$configureSovereign = $extChoice -in @('1','3')
$configureContinue  = $extChoice -in @('2','3')

# ── Step 2: Gather connection details ─────────────────────────────────────────
Write-Header "Step 2 — Connection details"

$defaultUrl = "http://localhost:11434"
$inputUrl   = Read-Host "  Base URL (press Enter for default: $defaultUrl)"
if ([string]::IsNullOrWhiteSpace($inputUrl)) { $inputUrl = $defaultUrl }

# Validate local-only
$localPrefixes = @("http://localhost", "http://192.168.", "http://10.", "http://172.")
$isLocal = $false
foreach ($prefix in $localPrefixes) {
    if ($inputUrl.StartsWith($prefix)) { $isLocal = $true; break }
}
if (-not $isLocal) {
    Write-Err "URL must be local-only (localhost, 192.168.x, 10.x, or 172.x)."
    Write-Err "Provided: $inputUrl"
    exit 1
}
$baseUrl = $inputUrl.TrimEnd('/')

Write-Host ""
Write-Host "  Provider types:" -ForegroundColor White
Write-Host "    ollama | lm-studio | llama-cpp | openai-compatible" -ForegroundColor Gray
$provider = Read-Host "  Provider type"
if ([string]::IsNullOrWhiteSpace($provider)) {
    Write-Err "Provider type cannot be empty."
    exit 1
}

$model = Read-Host "  Model name (e.g. llama3, codestral, deepseek-coder)"
if ([string]::IsNullOrWhiteSpace($model)) {
    Write-Err "Model name cannot be empty."
    exit 1
}

# ── Step 3: Test endpoint connectivity ───────────────────────────────────────
Write-Header "Step 3 — Testing endpoint connectivity"

$testEndpoints = @("$baseUrl/api/tags", "$baseUrl/v1/models", $baseUrl)
$connected = $false

foreach ($ep in $testEndpoints) {
    try {
        Write-Step "Trying: $ep"
        $null = Invoke-RestMethod -Uri $ep -Method GET -TimeoutSec 5 -ErrorAction Stop
        Write-Success "Endpoint reachable: $ep"
        $connected = $true
        break
    } catch {
        # try next endpoint
    }
}

if (-not $connected) {
    Write-Warn "Could not reach any endpoint at $baseUrl."
    $cont = Read-Host "  Continue anyway? (y/N)"
    if ($cont -notmatch '^[Yy]') {
        Write-Err "Aborted. Ensure your AI server is running and try again."
        exit 1
    }
}

# ── Step 4: Configure Sovereign Agent ────────────────────────────────────────
if ($configureSovereign) {
    Write-Header "Step 4a — Configuring Sovereign Agent"

    $vscodePath = "$env:APPDATA\Code\User"
    $settingsPath = "$vscodePath\settings.json"

    Ensure-Dir $vscodePath
    Backup-File $settingsPath

    try {
        $settings = Read-JsonFile $settingsPath
        Set-JsonProperty $settings "sovereignAgent.baseUrl" $baseUrl
        Set-JsonProperty $settings "sovereignAgent.provider" $provider
        Set-JsonProperty $settings "sovereignAgent.model"   $model

        $json = $settings | ConvertTo-Json -Depth 10
        Set-Content -Path $settingsPath -Value $json -Encoding UTF8

        Write-Success "Sovereign Agent configured successfully."
        Write-Host "    File   : $settingsPath" -ForegroundColor Gray
        Write-Host "    baseUrl: $baseUrl"      -ForegroundColor Gray
        Write-Host "    provider: $provider"    -ForegroundColor Gray
        Write-Host "    model  : $model"        -ForegroundColor Gray
    } catch {
        Write-Err "Failed to write Sovereign Agent config: $_"
        exit 1
    }
}

# ── Step 5: Configure Continue.dev ───────────────────────────────────────────
if ($configureContinue) {
    Write-Header "Step 4b — Configuring Continue.dev"

    $continuePath   = "$env:USERPROFILE\.continue"
    $continueConfig = "$continuePath\config.json"

    Ensure-Dir $continuePath
    Backup-File $continueConfig

    try {
        $config = Read-JsonFile $continueConfig

        # Ensure models array exists
        if (-not $config.PSObject.Properties["models"]) {
            $config | Add-Member -NotePropertyName "models" -NotePropertyValue @()
        }

        # Build new model entry
        $newModel = [PSCustomObject]@{
            title    = $model
            provider = $provider
            model    = $model
            apiBase  = $baseUrl
        }

        # Avoid duplicate (same title + apiBase)
        $exists = $config.models | Where-Object {
            $_.title -eq $model -and $_.apiBase -eq $baseUrl
        }

        if ($exists) {
            Write-Warn "Model '$model' at '$baseUrl' already exists in Continue config. Skipping duplicate."
        } else {
            $config.models = @($config.models) + $newModel
            $json = $config | ConvertTo-Json -Depth 10
            Set-Content -Path $continueConfig -Value $json -Encoding UTF8

            Write-Success "Continue.dev configured successfully."
            Write-Host "    File    : $continueConfig" -ForegroundColor Gray
            Write-Host "    title   : $model"          -ForegroundColor Gray
            Write-Host "    provider: $provider"       -ForegroundColor Gray
            Write-Host "    model   : $model"          -ForegroundColor Gray
            Write-Host "    apiBase : $baseUrl"        -ForegroundColor Gray
        }
    } catch {
        Write-Err "Failed to write Continue.dev config: $_"
        exit 1
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   Configuration complete! ✔      ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Reload VS Code (Ctrl+Shift+P → 'Reload Window') to apply changes." -ForegroundColor Yellow
Write-Host ""
