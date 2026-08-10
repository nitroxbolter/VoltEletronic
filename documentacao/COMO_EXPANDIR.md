# Como Expandir o Volt

Este guia existe para evoluir o Volt sem perder a lógica central do projeto.

---

## 1. Trocar ou ajustar o modelo local

Modelo padrão atual:

```text
llama3.2:3b
```

Locais relevantes:

- `backend/services/aiService.js`
- `electron/main.js`
- `resources/ollama/LEIA-ME.txt`

Se mudar o padrão:

1. atualizar código;
2. atualizar docs;
3. validar startup do Electron;
4. validar rota local;
5. validar fallback híbrido.

Arquivos de documentação que precisam acompanhar:

- `README.md`
- `documentacao/VISAO_GERAL.md`
- `documentacao/ESTRUTURA_ARQUIVOS.md`
- `documentacao/CONTEXTO_PARA_IA.md`
- `documentacao/COMO_EXPANDIR.md`
- `resources/ollama/LEIA-ME.txt`

---

## 2. Expandir a base técnica local

Pasta:

```text
backend/base/
```

Uso ideal:

- sintomas;
- procedimentos;
- observações técnicas reutilizáveis;
- base de componentes;
- fluxos de diagnóstico.

Boas práticas:

- conteúdo curto e objetivo;
- headings claros;
- evitar copiar datasheet inteiro;
- separar por assunto;
- preferir texto que ajude busca por chunk.

---

## 3. Expandir a memória estruturada

O banco ativo é:

```text
backend/data/volt.db
```

Antes de criar novas tabelas ou entidades, decidir:

- isso é dado de placa?
- é conhecimento geral?
- é caso real de reparo?
- é histórico de conversa?

Essa separação vale mais do que a implementação em si.

---

## 4. Expandir o fluxo guiado

Arquivo principal:

```text
frontend/src/components/CircuitAnalyzer.jsx
```

Regra de expansão:

- primeiro decidir o sintoma;
- depois ramificar;
- só mostrar opções já ativadas;
- não pular medições lógicas;
- não assumir `não liga` se o usuário ainda não disse isso.

Próximos ramos naturais:

- 3V/5V always-on;
- charger;
- sequência de power;
- backlight;
- vídeo externo/interno;
- consumo anormal;
- curto por setor.

Ao expandir:

1. refletir a mudança em `buildGuidedFlowSummary`;
2. sincronizar `guidedState`;
3. manter o texto de resumo coerente;
4. evitar abrir mapa técnico automaticamente.

---

## 5. Expandir o mapa técnico

Hoje o mapa técnico está concentrado em `CircuitAnalyzer.jsx`.

Se crescer muito, o caminho recomendado é:

```text
frontend/src/circuits/
  charger-bq24735.js
  no-power-entry.js
  lcd-edp.js
```

Cada circuito pode exportar:

- nós;
- arestas;
- grupos;
- estágios;
- faixas esperadas;
- textos de apoio.

Isso evita que `CircuitAnalyzer.jsx` vire um monólito difícil de manter.

---

## 6. Expandir lookup de esquema

Arquivo principal:

```text
frontend/src/components/ChatPanel.jsx
```

Regras:

- buscar por código de placa e modelo;
- tolerar pequenas variações de digitação;
- não tratar palavras genéricas como consulta de esquema;
- pedir confirmação quando houver mais de um resultado plausível.

Se adicionar novas heurísticas, validar:

- `LA-6901P`
- `la6901p`
- `acer a515`
- `positv`
- `sasung`
- `analisar` (não deve virar esquema)

---

## 7. Expandir comandos de chat

Arquivo:

```text
frontend/src/components/ChatPanel.jsx
```

Padrão:

- se for comando, responder localmente e retornar `true`;
- se não for, deixar seguir para IA.

Sempre atualizar:

- texto da ajuda;
- intenção esperada;
- persistência, se aplicável.

Evitar:

- esconder fluxo demais dentro de regex sem documentação;
- duplicar lógica que já existe no backend;
- criar comando que dependa de API remota para ação simples local.

---

## 8. Expandir a camada de IA

Arquivos principais:

- `backend/services/aiService.js`
- `backend/services/intentService.js`
- `backend/services/groqService.js`

Divisão ideal:

- `intentService`: respostas instantâneas e baratas;
- `aiService`: contexto e roteamento;
- `groqService`: transporte remoto;
- `tokenBudgetService`: limites.

Ao mexer nessa camada, validar:

- saudação;
- pergunta vaga;
- pergunta com placa;
- pergunta sem sintoma;
- pergunta técnica simples;
- fallback local -> API;
- logs da janela de debug.

---

## 9. Expandir persistência

O próximo passo natural é criar repositórios dedicados:

```text
backend/repositories/
  boardRepository.js
  repairCaseRepository.js
  knowledgeRepository.js
  checklistRepository.js
  chatRepository.js
```

Objetivo:

- tirar SQL dos serviços;
- facilitar testes;
- centralizar schema e queries.

Ao fazer isso:

- manter a API pública dos serviços o mais estável possível;
- evitar quebrar frontend e rotas em cascata.

---

## 10. Expandir debug

Arquivo principal:

```text
electron/main.js
```

Ao adicionar novos fluxos relevantes, logar:

- início;
- rota escolhida;
- fallback;
- tempo;
- erro;
- uso de API;
- tokens, quando existir.

Não vale entulhar log com ruído sem valor operacional.

---

## 11. Expandir a base de MOSFETs

Arquivos:

- `documentacao/MOSFETS.md`
- `backend/base/mosfets.md`
- `backend/data/mosfets.json`
- `backend/services/mosfetService.js`

Sempre registrar, quando possível:

- modelo;
- polaridade;
- VDS;
- corrente;
- RDS(on);
- VGS;
- Qg;
- encapsulamento;
- função no circuito;
- observações.

Nunca preencher dados ausentes por suposição.

---

## 12. Checklist de validação após mudanças

### Backend

```bash
node -e "require('./backend/services/intentService'); console.log('intent-ok')"
node --check backend/server.js
```

### Frontend

```bash
npm run build --prefix frontend
```

### Electron/manual

Validar:

1. startup em 3 etapas;
2. janela debug;
3. chat com nova conversa;
4. fluxo guiado;
5. lookup de esquema;
6. modo avançado;
7. caso `analisar` sem contexto;
8. caso `analisar circuito` com e sem medições.

---

## 13. O que expandir com cuidado especial

Mexer com mais cautela em:

- `ChatPanel.jsx`
- `CircuitAnalyzer.jsx`
- `aiService.js`
- `intentService.js`
- `electron/main.js`
- `databaseService.js`

São os pontos com maior efeito lateral no comportamento do produto.
