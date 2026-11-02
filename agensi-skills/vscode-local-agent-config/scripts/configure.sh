#!/usr/bin/env bash
#
# Configure Local AI for VS Code / Continue.dev (Linux / macOS)
# Safely updates settings.json and Continue config with local endpoints.
#

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}====================================================="
echo -e "   VS Code Local Agent Configuration Script          "
echo -e "=====================================================${NC}"

# Target OS Path Resolution
OS="$(uname)"
if [ "$OS" = "Darwin" ]; then
    VSCODE_SETTINGS="$HOME/Library/Application Support/Code/User/settings.json"
else
    VSCODE_SETTINGS="$HOME/.config/Code/User/settings.json"
fi
CONTINUE_CONFIG="$HOME/.continue/config.json"

echo "Hangi eklenti yapilandirilacak?"
echo "1) Sovereign Agent (VS Code settings.json)"
echo "2) Continue.dev (~/.continue/config.json)"
echo "3) Her ikisi de"
read -r -p "Seciminiz [1-3] (Varsayilan: 1): " CHOICE
CHOICE=${CHOICE:-1}

read -r -p "Base URL [http://localhost:11434]: " BASE_URL
BASE_URL=${BASE_URL:-http://localhost:11434}

# Local Check
if [[ ! "$BASE_URL" =~ ^https?://(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])) ]]; then
    echo -e "${RED}[ERROR] BaseUrl yerel bir IP veya localhost degil! Gizlilik geregi durduruldu.${NC}"
    exit 1
fi

read -r -p "Model adi [qwen2.5-coder:7b]: " MODEL_NAME
MODEL_NAME=${MODEL_NAME:-qwen2.5-coder:7b}

# 1. Sovereign Agent Settings
if [ "$CHOICE" = "1" ] || [ "$CHOICE" = "3" ]; then
    echo -e "\n${CYAN}Sovereign Agent ayarlari yapilandiriliyor...${NC}"
    mkdir -p "$(dirname "$VSCODE_SETTINGS")"
    
    if [ ! -f "$VSCODE_SETTINGS" ]; then
        echo "{}" > "$VSCODE_SETTINGS"
    fi
    
    # Backup
    cp "$VSCODE_SETTINGS" "$VSCODE_SETTINGS.bak"
    echo "Yedek alindi: $VSCODE_SETTINGS.bak"
    
    if command -v jq &> /dev/null; then
        TEMP_FILE=$(mktemp)
        jq --arg url "$BASE_URL" --arg model "$MODEL_NAME" \
           '. + {
               "sovereignAgent.baseUrl": $url,
               "sovereignAgent.model": $model,
               "sovereignAgent.requireWriteApproval": true,
               "sovereignAgent.requireCommandApproval": true
           }' "$VSCODE_SETTINGS" > "$TEMP_FILE"
        mv "$TEMP_FILE" "$VSCODE_SETTINGS"
        echo -e "${GREEN}[OK] $VSCODE_SETTINGS guncellendi.${NC}"
    else
        echo -e "${YELLOW}[!] 'jq' paketi bulunamadi. Ayarlar manuel olarak dosyaniza eklenmeli.${NC}"
    fi
fi

# 2. Continue.dev Settings
if [ "$CHOICE" = "2" ] || [ "$CHOICE" = "3" ]; then
    echo -e "\n${CYAN}Continue.dev ayarlari yapilandiriliyor...${NC}"
    mkdir -p "$(dirname "$CONTINUE_CONFIG")"
    
    if [ ! -f "$CONTINUE_CONFIG" ]; then
        cat << 'EOF' > "$CONTINUE_CONFIG"
{
  "models": [],
  "tabAutocompleteModel": null
}
EOF
    fi

    cp "$CONTINUE_CONFIG" "$CONTINUE_CONFIG.bak"
    echo "Yedek alindi: $CONTINUE_CONFIG.bak"

    if command -v jq &> /dev/null; then
        TEMP_FILE=$(mktemp)
        jq --arg title "Local $MODEL_NAME" --arg model "$MODEL_NAME" --arg apiBase "$BASE_URL" \
           '.models += [{
               "title": $title,
               "provider": "ollama",
               "model": $model,
               "apiBase": $apiBase
           }]' "$CONTINUE_CONFIG" > "$TEMP_FILE"
        mv "$TEMP_FILE" "$CONTINUE_CONFIG"
        echo -e "${GREEN}[OK] $CONTINUE_CONFIG guncellendi.${NC}"
    fi
fi

echo -e "\n${GREEN}[v] Yapilandirma basariyla tamamlandi!${NC}"

