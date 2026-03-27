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

echo -e "${BLUE}4. 🗄️  Rodando migrations do Cassandra...${NC}"
# Aguarda o Cassandra estar pronto
for i in $(seq 1 30); do
  if docker compose exec -T cassandra cqlsh -e "SELECT now() FROM system.local;" > /dev/null 2>&1; then
    break
  fi
  echo "  Aguardando Cassandra ficar pronto... ($i/30)"
  sleep 2
done
# Copia e executa cada migration (CREATE IF NOT EXISTS garante idempotência)
docker compose cp database/migrations cassandra:/tmp/migrations
docker compose exec -T cassandra bash -c 'for f in $(ls /tmp/migrations/[0-9]*.cql | sort); do
  output=$(cqlsh -f "$f" 2>&1)
  status=$?
  # Filtra erros de "already exists" (ALTER TABLE ADD em coluna existente — esperado)
  filtered=$(echo "$output" | grep -v "already exists" | grep -i "error" || true)
  if [ -n "$filtered" ]; then
    echo "  ✗ $(basename $f)"
    echo "$filtered"
  else
    echo "  ✓ $(basename $f)"
  fi
done'

echo -e "${BLUE}5. 🧹 Limpando imagens antigas (Dangling Images)...${NC}"
# Remove imagens "órfãs" que ficaram sobrando do build anterior para não encher o HD
docker image prune -f

echo -e "${GREEN}✅ Sucesso! O ambiente local está atualizado e o Docker Hub também.${NC}"