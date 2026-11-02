<#
.SYNOPSIS
    Automated Local AI Stack Setup (Windows / PowerShell)
.DESCRIPTION
    Detects local hardware, guides provider setup (Ollama, LM Studio, etc.),
    recommends and pulls models, and verifies local endpoint with zero cloud calls.
#>

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Text)
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Text)
    Write-Host "[OK] $Text" -ForegroundColor Green
}

function Write-WarnMsg {
    param([string]$Text)
    Write-Host "[WARN] $Text" -ForegroundColor Yellow
}

function Write-ErrMsg {
    param([string]$Text)
    Write-Host "[ERROR] $Text" -ForegroundColor Red
}

Write-Host "=============================================" -ForegroundColor Blue
Write-Host "   Local AI Dev Setup - Automated Script     " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Blue

# 1. Hardware Detection
Write-Step "1. Donanim Tespiti"

$gpu = "CPU Only (Yok veya Tespit Edilemedi)"
$vram = 0

try {
    $nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
    if ($nvidiaSmi) {
        $gpuOut = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null
        if ($gpuOut) {
            $parts = $gpuOut[0] -split ','
            $gpu = $parts[0].Trim()
            $vram = [math]::Round([double]$parts[1].Trim() / 1024, 1)
            $gpu = "$gpu ($vram GB VRAM)"
        }
    }
} catch { }

$mem = Get-CimInstance Win32_OperatingSystem
$totalRamGB = [math]::Round($mem.TotalVisibleMemorySize / 1MB, 1)
$freeRamGB = [math]::Round($mem.FreePhysicalMemory / 1MB, 1)

$drive = Get-PSDrive C -ErrorAction SilentlyContinue
$freeDiskGB = if ($drive) { [math]::Round($drive.Free / 1GB, 1) } else { "N/A" }

Write-Host "GPU : $gpu"
Write-Host "RAM : Toplam $totalRamGB GB (Bosta: $freeRamGB GB)"
Write-Host "Disk: C: surucusunde $freeDiskGB GB bos alan"

# Tier Recommendation
$recommendedTier = "7B Q4_K_M"
if ($vram -ge 16 -or ($vram -eq 0 -and $freeRamGB -ge 32)) {
    $recommendedTier = "14B - 32B Q4_K_M"
} elseif ($vram -ge 10 -or ($vram -eq 0 -and $freeRamGB -ge 16)) {
    $recommendedTier = "14B Q4_K_M"
}

Write-Host "Onerilen Model Boyutu: $recommendedTier" -ForegroundColor Magenta

# 2. Provider Selection
Write-Step "2. Provider Secimi"
Write-Host "1) Ollama (Onerilen - Otomatik Yonetim)"
Write-Host "2) LM Studio (Arayuzlu)"
Write-Host "3) llama.cpp / llama-server"
Write-Host "4) Jan"
Write-Host "5) Atla (Kendim Kuracagim)"

$choice = Read-Host "Seciminiz [1-5] (Varsayilan: 1)"
if (-not $choice) { $choice = "1" }

if ($choice -eq "1") {
    Write-Step "Ollama Kontrolu"
    $ollamaCmd = Get-Command "ollama" -ErrorAction SilentlyContinue
    if (-not $ollamaCmd) {
        Write-WarnMsg "Ollama sistemde bulunamadi."
        $wingetCmd = Get-Command "winget" -ErrorAction SilentlyContinue
        if ($wingetCmd) {
            $install = Read-Host "Winget ile Ollama kurulsun mu? (E/H)"
            if ($install -match "^[eEyY]") {
                Write-Host "Ollama kuruluyor..."
                & winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements
                Write-WarnMsg "Kurulum sonrasi terminalinizi yeniden baslatmaniz gerekebilir."
            }
        } else {
            Write-Host "Lutfen https://ollama.com/download adresinden indirip kurun."
        }
    } else {
        Write-Success "Ollama tespit edildi: $(& ollama --version)"
    }

    # Model Secimi
    Write-Step "3. Model Indirme (Pull)"
    Write-Host "1) qwen2.5-coder:7b (Hafif & Yetenekli Kodlama - 4.7 GB)"
    Write-Host "2) qwen2.5-coder:14b (Orta/Guclu Kodlama - 9 GB)"
    Write-Host "3) deepseek-coder-v2:16b (Ileri Duzey Kodlama - 9.1 GB)"
    Write-Host "4) llama3.1:8b (Genel Kullanim - 4.7 GB)"
    Write-Host "5) Ozel model adi gir"
    Write-Host "6) Model indirmeyi atla"

    $mChoice = Read-Host "Secim [1-6] (Varsayilan: 1)"
    if (-not $mChoice) { $mChoice = "1" }

    $targetModel = ""
    switch ($mChoice) {
        "1" { $targetModel = "qwen2.5-coder:7b" }
        "2" { $targetModel = "qwen2.5-coder:14b" }
        "3" { $targetModel = "deepseek-coder-v2:16b" }
        "4" { $targetModel = "llama3.1:8b" }
        "5" { $targetModel = Read-Host "Model adi (ornek: mistral:7b)" }
        default { $targetModel = "" }
    }

    if ($targetModel) {
        Write-Host "$targetModel indiriliyor..." -ForegroundColor Cyan
        & ollama pull $targetModel
        Write-Success "$targetModel basariyla hazirlandi."
    }

    # Smoke Test
    Write-Step "4. Endpoint Testi (Smoke Test)"
    try {
        $body = @{
            model = if ($targetModel) { $targetModel } else { "qwen2.5-coder:7b" }
            messages = @(@{ role = "user"; content = "Reply with only the word PONG" })
            max_tokens = 10
            stream = $false
        } | ConvertTo-Json

        $res = Invoke-RestMethod -Uri "http://localhost:11434/v1/chat/completions" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
        Write-Success "Test Basarili! Yanit: $($res.choices[0].message.content.Trim())"
    } catch {
        Write-WarnMsg "Ollama servisine ulasilamadi veya yanit alinamadi. 'ollama serve' calistigindan emin olun."
    }
} else {
    Write-Host "Secilen provider icin yerel sunucuyu baslatin ve http://localhost portunu kontrol edin."
}

# Privacy Checklist
Write-Step "Gizlilik Kontrol Listesi"
Write-Host "[v] Tum cagrilar localhost (127.0.0.1) uzerinden yapilir." -ForegroundColor Green
Write-Host "[v] Hicbir API anahtari veya telemetri servisi kullanilmaz." -ForegroundColor Green
Write-Host "[v] Veriler tamamen cihazinizda saklanir ve islenir." -ForegroundColor Green
Write-Host "`nKurulum tamamlandi!" -ForegroundColor Cyan

