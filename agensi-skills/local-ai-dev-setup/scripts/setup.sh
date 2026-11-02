#!/usr/bin/env bash
#
# Automated Local AI Stack Setup (Linux / macOS)
# Detects hardware, sets up Ollama/LM Studio, pulls models, and runs smoke tests.
#

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}============================================="
echo -e "   Local AI Dev Setup - Automated Script     "
echo -e "=============================================${NC}"

# 1. Hardware Detection
echo -e "\n${CYAN}=== 1. Donanim Tespiti ===${NC}"

GPU="CPU Only (veya tespit edilemedi)"
VRAM=0

if command -v nvidia-smi &> /dev/null; then
    NVIDIA_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 || true)
    if [ -n "$NVIDIA_INFO" ]; then
        NAME=$(echo "$NVIDIA_INFO" | cut -d',' -f1)
        VRAM_MB=$(echo "$NVIDIA_INFO" | cut -d',' -f2 | tr -d ' ')
        VRAM=$((VRAM_MB / 1024))
        GPU="$NAME (${VRAM} GB VRAM)"
    fi
elif [ "$(uname)" = "Darwin" ]; then
    CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Apple Silicon")
    GPU="$CHIP (Shared Memory)"
fi

echo -e "GPU : $GPU"

if [ "$(uname)" = "Darwin" ]; then
    TOTAL_RAM_BYTES=$(sysctl -n hw.memsize)
    TOTAL_RAM_GB=$((TOTAL_RAM_BYTES / 1024 / 1024 / 1024))
    echo -e "RAM : Yaklasik ${TOTAL_RAM_GB} GB"
else
    TOTAL_RAM=$(free -h | awk '/^Mem:/ {print $2}')
    AVAIL_RAM=$(free -h | awk '/^Mem:/ {print $7}')
    echo -e "RAM : Toplam $TOTAL_RAM (Kullanilabilir: $AVAIL_RAM)"
fi

DISK_AVAIL=$(df -h . | awk 'NR==2 {print $4}')
echo -e "Disk: Mevcut bos alan: $DISK_AVAIL"

# 2. Provider Selection
echo -e "\n${CYAN}=== 2. Provider Secimi ===${NC}"
echo "1) Ollama (Onerilen)"
echo "2) LM Studio / llama.cpp / Diger"
echo "3) Atla"
read -r -p "Seciminiz [1-3] (Varsayilan: 1): " CHOICE
CHOICE=${CHOICE:-1}

if [ "$CHOICE" = "1" ]; then
    if ! command -v ollama &> /dev/null; then
        echo -e "${YELLOW}Ollama bulunamadi.${NC}"
        if [ "$(uname)" = "Darwin" ] && command -v brew &> /dev/null; then
            read -r -p "Homebrew ile kurulsun mu? (e/h): " INSTALL_BREW
            if [[ "$INSTALL_BREW" =~ ^[eEyY] ]]; then
                brew install ollama
            fi
        else
            read -r -p "Ollama resmi script ile kurulsun mu? (e/h): " INSTALL_SH
            if [[ "$INSTALL_SH" =~ ^[eEyY] ]]; then
                curl -fsSL https://ollama.com/install.sh | sh
            fi
        fi
    else
        echo -e "${GREEN}[OK] Ollama bulundu: $(ollama --version)${NC}"
    fi

    # Model Selection
    echo -e "\n${CYAN}=== 3. Model Indirme ===${NC}"
    echo "1) qwen2.5-coder:7b (Hafif Kodlama - 4.7 GB)"
    echo "2) qwen2.5-coder:14b (Orta Kodlama - 9 GB)"
    echo "3) deepseek-coder-v2:16b (Ileri Duzey - 9.1 GB)"
    echo "4) llama3.1:8b (Genel Kullanim - 4.7 GB)"
    echo "5) Ozel model adi gir"
    echo "6) Atla"
    read -r -p "Secim [1-6] (Varsayilan: 1): " M_CHOICE
    M_CHOICE=${M_CHOICE:-1}

    TARGET_MODEL=""
    case "$M_CHOICE" in
        1) TARGET_MODEL="qwen2.5-coder:7b" ;;
        2) TARGET_MODEL="qwen2.5-coder:14b" ;;
        3) TARGET_MODEL="deepseek-coder-v2:16b" ;;
        4) TARGET_MODEL="llama3.1:8b" ;;
        5) read -r -p "Model adi: " TARGET_MODEL ;;
        *) TARGET_MODEL="" ;;
    esac

    if [ -n "$TARGET_MODEL" ]; then
        echo -e "${CYAN}$TARGET_MODEL indiriliyor...${NC}"
        ollama pull "$TARGET_MODEL"
        echo -e "${GREEN}[OK] $TARGET_MODEL hazir.${NC}"
    fi

    # Smoke Test
    echo -e "\n${CYAN}=== 4. Endpoint Testi ===${NC}"
    SMOKE_MODEL=${TARGET_MODEL:-"qwen2.5-coder:7b"}
    RESPONSE=$(curl -s -X POST http://localhost:11434/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$SMOKE_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with only the word PONG\"}],\"max_tokens\":10}" || true)

    if echo "$RESPONSE" | grep -q "PONG"; then
        echo -e "${GREEN}[OK] Smoke test basarili! Local model yanit verdi.${NC}"
    else
        echo -e "${YELLOW}[!] Yanit dogrulanamadi. 'ollama serve' aktif oldugundan emin olun.${NC}"
    fi
fi

echo -e "\n${GREEN}[v] Gizlilik: Tum trafik 127.0.0.1 uzerinde kalir. Buluta veri gonderilmez.${NC}"
echo -e "${CYAN}Kurulum tamamlandi!${NC}\n"

