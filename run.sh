#!/bin/bash

# Local-only deploy — build and run for development
# Production deploys happen automatically via GitHub Actions on push to main/master

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}1. Buildando as imagens locais...${NC}"
docker compose build

echo -e "${BLUE}2. Atualizando os serviços locais...${NC}"
docker compose up -d --remove-orphans

echo -e "${BLUE}3. Limpando imagens antigas...${NC}"
docker image prune -f

echo -e "${GREEN}Sucesso! O backend roda as migrations automaticamente no startup.${NC}"
