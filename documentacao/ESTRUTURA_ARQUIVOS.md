# Estrutura de Arquivos — Referência Atual

Este é o mapa prático do projeto no estado atual.

---

## Árvore principal

```text
app/
├── README.md
├── package.json
├── backend/
│   ├── package.json
│   ├── server.js
│   ├── base/
│   │   ├── defeitos_comuns.md
│   │   ├── eletronica_basica.md
│   │   └── mosfets.md
│   ├── data/
│   │   ├── volt.db
│   │   ├── boards.json
│   │   ├── knowledge.json
│   │   └── mosfets.json
│   └── services/
│       ├── aiService.js
│       ├── autoMemoryService.js
│       ├── baseKnowledgeService.js
│       ├── boardService.js
│       ├── chatHistoryService.js
│       ├── checklistService.js
│       ├── databaseService.js
│       ├── envService.js
│       ├── groqService.js
│       ├── intentService.js
│       ├── knowledgeService.js
│       ├── mosfetService.js
│       ├── pdfService.js
│       ├── repairCaseService.js
│       ├── schematicContextService.js
│       └── tokenBudgetService.js
├── documentacao/
│   ├── COMO_EXPANDIR.md
│   ├── CONTEXTO_PARA_IA.md
│   ├── ESTRUTURA_ARQUIVOS.md
│   ├── MOSFETS.md
│   └── VISAO_GERAL.md
├── electron/
│   ├── debug.html
│   ├── loading.html
│   ├── main.js
│   └── preload.js
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── BoardDetail.jsx
│           ├── BoardForm.jsx
│           ├── BoardList.jsx
│           ├── ChatInput.jsx
│           ├── ChatMessage.jsx
│           ├── ChatPanel.jsx
│           ├── CircuitAnalyzer.jsx
│           ├── DiagnosticChecklistPanel.jsx
│           └── Sidebar.jsx
├── resources/
│   └── ollama/
│       ├── LEIA-ME.txt
│       └── ollama.exe
└── scripts/
    └── free-dev-ports.js
```

---

## Raiz

### `package.json`

Controla os scripts da aplicação inteira.

Scripts principais hoje:

| Script | Função |
|---|---|
| `npm run install:all` | instala raiz, backend e frontend |
| `npm run dev` | sobe backend e frontend |
| `npm run start` | sobe frontend + Electron |
| `npm run build` | build do frontend |
| `npm run build:electron` | build do instalador |
| `npm run kill` | mata Node e Electron no Windows |

Observação importante:

- `prestart` executa `scripts/free-dev-ports.js`;
- frontend dev atual usa porta `5176`;
- backend Electron atual usa porta `3003`.

### `README.md`

Resumo operacional do projeto. Deve refletir sempre:

- modelo local atual;
- modo híbrido atual;
- scripts reais;
- estrutura de memória;
- comportamento do app.

---

## Backend

### `backend/server.js`

Entrada do backend Express.

Responsabilidades:

- iniciar API REST;
- healthcheck;
- protocolo de debug;
- rotas de chat;
- rotas de histórico;
- rotas de memória automática;
- CRUD de placas, notas, defeitos, tensão;
- CRUD de conhecimento;
- CRUD de casos de reparo;
- CRUD de checklist;
- rotas de MOSFET;
- servir esquema vinculado;
- extração automática de PDF.

Rotas expostas hoje:

```text
GET    /health
GET    /debug-info
POST   /chat

GET    /chat-sessions
POST   /chat-sessions
GET    /chat-sessions/search
GET    /chat-sessions/:id
PATCH  /chat-sessions/:id
POST   /chat-sessions/:id/messages
DELETE /chat-sessions/:id

POST   /memory/auto-save

GET    /knowledge
POST   /knowledge
POST   /knowledge/structured
GET    /knowledge/search
POST   /knowledge/:id/solucao
DELETE /knowledge/:id

GET    /mosfets
GET    /mosfets/suggest
GET    /mosfets/compare
GET    /mosfets/:model

GET    /boards
POST   /boards
GET    /boards/search
GET    /boards/:id
DELETE /boards/:id
POST   /boards/:id/defects
DELETE /boards/:id/defects/:defectId
POST   /boards/:id/notes
DELETE /boards/:id/notes/:noteId
POST   /boards/:id/voltagepoints
DELETE /boards/:id/voltagepoints/:vpId
GET    /boards/:id/schematic
POST   /boards/:id/parse-schematic

GET    /repair-cases
GET    /boards/:id/repair-cases
POST   /boards/:id/repair-cases
DELETE /repair-cases/:id

GET    /checklist
POST   /checklist
DELETE /checklist/:id
```

### `backend/services/aiService.js`

Orquestra a IA.

Responsabilidades:

- decidir local/API;
- montar prompt final;
- reunir contexto local;
- incluir esquema filtrado;
- publicar metadados de rota;
- registrar logs do fluxo.

Não deve virar depósito de SQL ou regras de rota.

### `backend/services/intentService.js`

Camada de respostas instantâneas locais.

Responsável por:

- saudações;
- confirmações;
- pedidos curtos de contexto;
- triagem simples;
- perguntas vagas como `analisar`;
- respostas locais de baixo custo.

Esse serviço é essencial para evitar chamadas desnecessárias ao Ollama e à Groq.

### `backend/services/groqService.js`

Cliente da Groq.

Uso:

- somente quando o `aiService` decidir por rota remota;
- modelo padrão: `llama-3.1-8b-instant`;
- endpoint compatível com OpenAI.

### `backend/services/tokenBudgetService.js`

Faz controle local do orçamento Groq Free:

- RPM;
- RPD;
- TPM;
- TPD;
- corte de contexto.

### `backend/services/schematicContextService.js`

Seleciona trechos úteis de esquema para IA.

Regras:

- nunca mandar PDF inteiro para a API;
- usar cache local;
- focar termos relevantes da pergunta.

### `backend/services/boardService.js`

Gerencia placas, notas, defeitos e pontos de tensão.

### `backend/services/repairCaseService.js`

Gerencia casos reais de reparo.

### `backend/services/knowledgeService.js`

Gerencia conhecimento geral.

### `backend/services/checklistService.js`

Gerencia checklist de diagnóstico.

### `backend/services/chatHistoryService.js`

Gerencia sessões e mensagens de chat.

### `backend/services/autoMemoryService.js`

Interpreta pedidos naturais como:

```text
salve essa informacao
guarde isso
registre esse defeito
```

e decide em qual memória gravar.

### `backend/services/mosfetService.js`

Camada local de consulta e comparação de MOSFETs.

### `backend/services/databaseService.js`

Inicializa `better-sqlite3`, schema, índices e migra JSON legado para `volt.db`.

### `backend/services/baseKnowledgeService.js`

Indexa `backend/base/*.md` no SQLite em:

- `knowledge_sources`
- `knowledge_chunks`

### `backend/services/pdfService.js`

Utilitário para PDF. Hoje ainda é menos central que `server.js` na extração, mas continua sendo lugar natural para ampliar parsing futuro.

---

## Dados locais

### `backend/data/volt.db`

Banco ativo.

Principais tabelas esperadas:

- `boards`
- `board_defects`
- `board_notes`
- `voltage_points`
- `repair_cases`
- `repair_measurements`
- `knowledge_entries`
- `checklists`
- `knowledge_sources`
- `knowledge_chunks`
- `chat_sessions`
- `chat_messages`

### `backend/data/*.json`

Legado e seed histórico.

Hoje não devem voltar a ser a fonte principal.

### `backend/base/*.md`

Base técnica manual e editável.

Boa para:

- procedimentos;
- sintomas;
- observações reutilizáveis;
- base de MOSFETs;
- fluxos técnicos.

---

## Frontend

### `frontend/src/App.jsx`

Controla a navegação principal e o estado compartilhado, incluindo o checklist diagnóstico recebido do chat.

### `frontend/src/components/ChatPanel.jsx`

É uma das peças centrais do produto.

Responsabilidades:

- mensagens;
- sessões salvas;
- aliases;
- comandos locais;
- lookup de esquema;
- integração com checklist/fluxo;
- envio de contexto do analisador;
- modo avançado local/API.

### `frontend/src/components/CircuitAnalyzer.jsx`

Hoje concentra quatro papéis:

- fluxo guiado;
- checklist visual;
- esquema;
- mapa técnico.

Estado importante:

- `workspaceTab`;
- `guidedState`;
- `window.__analyzerCtx`.

### `frontend/src/components/DiagnosticChecklistPanel.jsx`

Renderiza o checklist visual alimentado pelo chat.

Regra importante:

- só mostrar etapas realmente ativadas;
- não poluir com estados não mencionados.

### `frontend/src/components/BoardForm.jsx`

Cadastro de placa e vínculo com esquema.

### `frontend/src/components/BoardList.jsx`

Lista e busca placas.

### `frontend/src/components/BoardDetail.jsx`

Tela de detalhe da placa com:

- notas;
- defeitos;
- pontos de tensão;
- casos de reparo;
- esquema vinculado.

### `frontend/src/components/Sidebar.jsx`

Menu lateral principal.

---

## Electron

### `electron/main.js`

Responsável por:

- configurar app;
- centralizar `userData`;
- subir Ollama;
- baixar/garantir modelo;
- subir backend;
- mostrar `loading.html`;
- abrir `debug.html`;
- publicar logs;
- expor IPCs para arquivos locais;
- abrir frontend.

Também contém:

- proteção para reusar backend atual;
- encerramento de processo antigo por porta;
- warmup do modelo;
- centralização do runtime Ollama em pasta local do projeto/app.

### `electron/preload.js`

Ponte segura entre renderer e recursos do sistema.

Deve permanecer com:

- `contextIsolation: true`
- `nodeIntegration: false`

### `electron/loading.html`

Tela de startup em três etapas.

### `electron/debug.html`

Janela de debug do Volt.

---

## Resources

### `resources/ollama/`

Contém:

- `ollama.exe`
- documentação local de empacotamento
- pasta de runtime local quando o app cria `home/` e `models/`

---

## Scripts

### `scripts/free-dev-ports.js`

Executado no `prestart`.

Serve para evitar conflito comum de porta em ambiente local antes do Electron/dev.

---

## Regras práticas de manutenção

1. Se mudar modelo, atualizar `README`, docs e `resources/ollama/LEIA-ME.txt`.
2. Se mudar rota, atualizar docs e comandos.
3. Se criar nova memória, documentar onde ela vive e como entra no contexto.
4. Se ampliar o fluxo guiado, manter separado do mapa técnico.
5. Se mudar heurística de local/API, atualizar `README` e `CONTEXTO_PARA_IA.md`.
