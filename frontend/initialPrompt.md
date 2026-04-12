# 🎯 Prompt para Implementação do Frontend — Plataforma de Assistentes de IA

Você é um desenvolvedor frontend sênior especialista em React, TypeScript e design de interfaces modernas.

Sua tarefa é criar o **frontend inicial de uma plataforma web para gerenciamento de assistentes de IA de atendimento**, que futuramente será integrada com sistemas como Chatwoot e engines de skills.

---

## 🎯 Objetivo (MVP)

Implementar apenas o essencial:

- Página de listagem de assistentes
- Criar novo assistente
- Editar assistente existente

---

## 🧱 Stack obrigatória

- React + TypeScript
- Vite (preferencial)
- Gerenciamento de estado simples (useState ou Zustand)
- **HeroUI** (usar sempre que possível para inputs, selects, botões, cards, modais, etc.)
- React Hook Form (para formulários)
- Zod (validação)

---

## 📄 Estrutura de páginas

### 1. Página principal `/assistants`

Exibir lista de assistentes em formato de cards ou tabela.

Cada assistente deve mostrar:

- Nome
- Descrição (resumo)
- LLM selecionada
- Modelo
- Criatividade (temperature)
- Botão "Editar"

Também deve ter:

- Botão "Criar Assistente"

---

### 2. Modal ou página de criação/edição

Formulário reutilizável para criar e editar assistentes.

---

## 🧠 Modelo de dados do Assistente

```ts
type Assistant = {
  id: string;
  name: string;
  description: string;
  llmProvider: "openai" | "claude" | "gemini";
  model: string;
  temperature: number; // 0 a 1
  maxTokens: number;
  systemPrompt: string;
};
```

---

## 🧩 Regras do formulário

Campos obrigatórios:

- Nome (input)
- Descrição (textarea)
- LLM Provider (select)
  - OpenAI
  - Claude
  - Gemini

- Modelo (select dinâmico baseado no provider)

### Modelos por provider:

Use os melhores modelos disponiveis em API para cada provider, lembre que o objetivo é construir assistentes de IA para atendimento de leads.

- Criatividade (temperature)
  - Slider de 0 a 1
  - Mostrar valor atual

- Max Tokens (number input)

- Prompt do sistema (textarea grande)

---

## 🎨 UI/UX

- Usar **HeroUI em TODOS os componentes possíveis**
- Interface limpa, moderna e responsiva
- Cards com sombra leve
- Botões com destaque claro (primary / secondary)
- Modal elegante para criação/edição
- Feedback visual ao salvar

---

## ⚙️ Funcionalidade (MVP sem backend)

- Armazenar dados em memória (useState)
- Simular CRUD:
  - Criar assistente
  - Editar assistente
- IDs podem ser gerados com `uuid`

---

## 🧠 Boas práticas

- Componentização clara:
  - AssistantList
  - AssistantCard
  - AssistantForm
- Separar lógica de UI
- Tipagem forte com TypeScript
- Código limpo e escalável

---

## 🚀 Extras (se sobrar tempo)

- Persistência em localStorage
- Filtro por provider
- Busca por nome

---

## 📦 Entrega esperada

- Código completo funcional
- Estrutura de pastas organizada
- Componentes reutilizáveis
- UI consistente usando HeroUI
