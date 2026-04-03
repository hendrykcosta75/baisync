#!/bin/bash

# Cores para o terminal (estético, mas ajuda a ler)
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}1. 🏗️  Buildando as imagens locais...${NC}"
# O --no-cache é opcional, use se quiser um build totalmente limpo
docker compose build

echo -e "${BLUE}2. 📤 Enviando para o Docker Hub (enki10/intertial-codebase)...${NC}"
docker compose push

echo -e "${BLUE}3. 🚀 Atualizando os serviços locais...${NC}"
# O comando 'up -d' percebe que a imagem mudou e recria apenas o necessário
docker compose up -d --remove-orphans

echo -e "${BLUE}4. 🧹 Limpando imagens antigas (Dangling Images)...${NC}"
# Remove imagens "órfãs" que ficaram sobrando do build anterior para não encher o HD
docker image prune -f

echo -e "${GREEN}✅ Sucesso! O backend roda as migrations automaticamente no startup.${NC}"
