#!/bin/bash

# Dev local — infra no Docker, backend e frontend na máquina (build incremental rápido)

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${BLUE}1. Subindo infra (Cassandra, Redis, Baileys)...${NC}"
docker compose up -d cassandra redis baileys

echo -e "${BLUE}2. Aguardando Cassandra ficar healthy...${NC}"
until docker compose exec cassandra cqlsh -e "DESCRIBE KEYSPACES" &>/dev/null; do
  sleep 2
  echo -n "."
done
echo ""

echo -e "${GREEN}Infra pronta!${NC}"
echo ""
echo -e "${YELLOW}Rode em terminais separados:${NC}"
echo ""
echo -e "  ${GREEN}Backend:${NC} DATABASE_URL=localhost:9042 BAILEYS_URL=http://localhost:3025 cargo watch -x run"
echo -e "  ${GREEN}Frontend:${NC} yarn dev"
