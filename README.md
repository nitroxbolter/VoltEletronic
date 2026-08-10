# Volt — Assistente de Eletrônica IA

Volt é um aplicativo desktop para bancada de eletrônica. Ele roda localmente com Electron, React, Node.js e Ollama, mantém memória técnica em SQLite e pode usar Groq de forma híbrida quando a análise precisa ir além do que vale fazer localmente.

O objetivo do projeto não é ser um chat genérico. O Volt tenta:

- identificar placa, equipamento e sintoma;
- localizar esquema ou boardview local;
- reaproveitar notas, defeitos, casos de reparo e conhecimento salvo;
- guiar o técnico por fluxo de diagnóstico;
- usar Llama local para respostas rápidas;
- usar Groq apenas quando houver ganho real.

---

## Estado atual

Hoje o Volt já possui:

- chat técnico com histórico por sessão;
- startup automático de Ollama, backend e interface;
- janela separada de debug com logs de startup e fluxo IA;
- modo híbrido `local primeiro, API se precisar`;
- armazenamento ativo em SQLite (`backend/data/volt.db`);
- migração inicial dos JSONs legados;
- base local de MOSFETs para comparação sem depender da API;
- análise guiada por fluxo interativo;
- mapa técnico separado do fluxo guiado;
- visualização inline de esquema/boardview;
- salvamento automático de memória técnica por linguagem natural.

---

## Arquitetura resumida

```text
Usuario
  -> ChatPanel / telas React
  -> backend Express
  -> aiService
      -> resposta instantanea local
      -> contexto local (placa, casos, conhecimento, checklists, esquema)
      -> Groq somente quando necessario

Persistencia
  -> SQLite: backend/data/volt.db
  -> JSONs legados: backend/data/*.json

Execucao local
  -> Electron
  -> Ollama embutido em resources/ollama
  -> modelo local: llama3.2:3b
```

---

## Modelos usados

### Modelo local padrão

```text
Nome: Llama 3.2 3B Q4
Tag Ollama: llama3.2:3b
Tamanho aproximado: ~2 GB
Perfil: rapido
Papel: respostas locais, triagem, saudações, comandos, filtros e apoio ao fluxo
```

### Modelo remoto padrão

```text
Nome: Groq Llama 3.1 8B Instant
Tag: llama-3.1-8b-instant
Papel: analise tecnica com contexto filtrado
```

### Limites Groq Free considerados pelo projeto

| Limite | Valor |
|---|---:|
| Requisicoes por minuto | 30 |
| Requisicoes por dia | 14.400 |
| Tokens por minuto | 6.000 |
| Tokens por dia | 500.000 |

O Volt foi ajustado para nunca mandar PDF inteiro para a API. Primeiro ele filtra localmente, depois envia apenas o necessario.

---

## Estrutura principal

```text
app/
├── README.md
├── package.json
├── backend/
├── electron/
├── frontend/
├── documentacao/
└── resources/ollama/
```

Documentos principais:

- `documentacao/VISAO_GERAL.md`
- `documentacao/ESTRUTURA_ARQUIVOS.md`
- `documentacao/CONTEXTO_PARA_IA.md`
- `documentacao/COMO_EXPANDIR.md`
- `documentacao/MOSFETS.md`

---

## Como executar

Na pasta `app/`:

```bash
npm run install:all
```

### Desenvolvimento

```bash
npm run dev
```

Isso sobe:

- backend Express;
- frontend Vite.

### Desktop com Electron

```bash
npm run start
```

No modo Electron atual:

- o frontend roda em `http://127.0.0.1:5176`;
- o backend roda na porta `3003`;
- o preload faz a ponte segura com arquivos locais;
- a janela de debug abre separada.

### Build do frontend

```bash
npm run build
```

### Build do instalador

```bash
npm run build:electron
```

---

## Startup do app

Ao abrir com Electron, o Volt faz três etapas:

1. iniciar ou reutilizar o Ollama;
2. iniciar ou reutilizar o backend;
3. aquecer o modelo local em memória.

Enquanto isso:

- a tela `loading.html` mostra progresso;
- a janela `Volt Debug` recebe logs em tempo real.

Isso ajuda a diagnosticar:

- Ollama não encontrado;
- backend antigo ocupando a porta;
- timeout do modelo;
- uso local vs API no fluxo do chat.

---

## Onde ficam os dados

### Banco ativo

```text
backend/data/volt.db
```

Guarda:

- placas;
- defeitos;
- notas;
- pontos de tensão;
- checklists;
- conhecimento geral;
- casos de reparo;
- sessões e mensagens de chat;
- indexação da base Markdown.

### Arquivos legados

```text
backend/data/boards.json
backend/data/knowledge.json
backend/data/mosfets.json
```

Esses arquivos são legado/importação inicial. O app atual usa SQLite como fonte principal.

### Base técnica em Markdown

```text
backend/base/*.md
```

Esses arquivos são indexados em chunks dentro do SQLite para recuperação local.

---

## Fluxo de IA

### Local primeiro

O Volt tenta responder sem API quando:

- é saudação;
- é comando;
- é confirmação simples;
- é pergunta curta de triagem;
- é consulta local de MOSFET;
- é um caso onde falta contexto e basta pedir placa/sintoma.

### API somente quando precisa

A Groq entra quando:

- o caso técnico exige análise maior;
- o Llama local não entregou resposta útil;
- o modo avançado foi ligado;
- existe contexto local suficiente para valer a chamada.

### Regra importante

```text
Pergunta vaga -> pedir contexto
Pergunta tecnica -> montar contexto local
Somente depois -> decidir se usa API
```

Exemplos de contexto local que entram antes da API:

- placa detectada;
- esquema ou boardview localizado;
- notas da placa;
- casos de reparo parecidos;
- chunks da base técnica;
- fluxo guiado atual;
- medições do mapa técnico.

---

## Interface atual

### Sidebar

- `Armazenar Placa`
- `Carregar Placas`
- `Analisador`

### Chat

O chat hoje suporta:

- sessões salvas;
- nova conversa;
- aliases;
- comandos locais;
- modo avançado liga/desliga;
- abertura de esquema por texto;
- integração com checklist e fluxo guiado.

### Analisador

O espaço central hoje pode mostrar:

- checklist visual;
- fluxo guiado `Sim/Não`;
- esquema/boardview;
- mapa técnico.

Para casos como `não liga`, o comportamento desejado é:

- abrir o fluxo guiado;
- deixar o mapa técnico como passo manual, não automático.

---

## Memória técnica

O Volt separa memória em quatro grupos:

1. dados da placa;
2. casos reais de reparo;
3. conhecimento geral;
4. histórico de conversas.

Essa separação é importante para futuras IAs:

- caso real não deve ser tratado como regra universal;
- conhecimento geral não deve substituir histórico de bancada;
- chat salvo pode virar base de consulta futura;
- placa mantém detalhes específicos de hardware.

---

## Base de MOSFETs

O projeto possui documentação e dados locais para comparação de MOSFETs:

- `documentacao/MOSFETS.md`
- `backend/base/mosfets.md`
- `backend/data/mosfets.json`
- `backend/services/mosfetService.js`

Consultas como:

- `posso usar AON7408 no lugar do AON7410?`
- `qual substituto para AON6428?`

devem priorizar a base local antes de qualquer API.

---

## Comandos úteis

Exemplos:

- `ajuda`
- `listar conhecimento`
- `addcontexto: <fato>`
- `adicionar checklist: <problema> | <passo1>, <passo2>`
- `adicionar na placa <modelo>: <obs>`
- `analisar circuito`

Observação:

- `analisar` sozinho deve pedir placa/modelo e sintoma;
- `analisar circuito` deve ser usado quando já existem medições no mapa técnico.
- `nao sei o modelo da placa` deve iniciar triagem geral local, sem busca de esquema e sem API.
- o checklist visual integra o fluxo `Sim/Não`: lado esquerdo com etapas e lado direito com perguntas.
- o fluxo começa por `Liga?` e `Liga sem vídeo?`; as próximas perguntas aparecem conforme as respostas.

---

## Arquivos mais importantes

| Area | Arquivo |
|---|---|
| Rotas backend | `backend/server.js` |
| Orquestração IA | `backend/services/aiService.js` |
| Triagem local instantânea | `backend/services/intentService.js` |
| Orçamento Groq | `backend/services/tokenBudgetService.js` |
| Contexto de esquema | `backend/services/schematicContextService.js` |
| Memória automática | `backend/services/autoMemoryService.js` |
| Histórico de chat | `backend/services/chatHistoryService.js` |
| Tela principal | `frontend/src/App.jsx` |
| Chat | `frontend/src/components/ChatPanel.jsx` |
| Fluxo/guiado e mapa | `frontend/src/components/CircuitAnalyzer.jsx` |
| Checklist visual | `frontend/src/components/DiagnosticChecklistPanel.jsx` |
| Bootstrap Electron | `electron/main.js` |
| Ponte segura | `electron/preload.js` |

---

## Solução rápida de problemas

### Porta ocupada

O projeto já tenta liberar/reutilizar portas, mas se precisar:

```bash
npm run kill
```

### Ollama sem modelo

Baixe o modelo local:

```powershell
cd "D:\PROJETOS\Projeto Eletronica\app"
$root=(Resolve-Path .\resources\ollama).Path
$env:USERPROFILE=Join-Path $root 'home'
$env:HOME=Join-Path $root 'home'
$env:OLLAMA_MODELS=Join-Path $root 'models'
.\resources\ollama\ollama.exe pull llama3.2:3b
```

### Backend isolado

```bash
npm run dev:backend
```

### Frontend isolado

```bash
npm run dev:frontend
```

---

## Leitura recomendada

Para entender ou evoluir o projeto, leia nesta ordem:

1. `documentacao/CONTEXTO_PARA_IA.md`
2. `documentacao/VISAO_GERAL.md`
3. `documentacao/ESTRUTURA_ARQUIVOS.md`
4. `documentacao/COMO_EXPANDIR.md`
5. `documentacao/MOSFETS.md`

---

## Norte do produto

O Volt deve evoluir para ser:

```text
um assistente de bancada
que conhece a placa
que encontra o esquema
que aprende com os reparos locais
que guia o tecnico por etapas
e que gasta API so quando faz sentido
```
