# Contexto Para Futuras Análises de IA

Este arquivo existe para uma futura IA entender o Volt rapidamente e mexer no projeto sem quebrar a lógica principal.

---

## Resumo executivo

Volt é um app desktop de bancada para eletrônica. O projeto atual combina:

- Electron;
- React;
- Node/Express;
- Ollama local com `llama3.2:3b`;
- Groq opcional com `llama-3.1-8b-instant`;
- memória local consolidada em SQLite.

O produto tenta agir mais como um assistente de bancada com memória do que como um chat solto.

---

## O que não deve ser quebrado

### 1. Contexto local vem antes da API

Regra:

```text
localizar dados locais -> filtrar -> responder localmente ou usar API
```

Não inverter isso.

### 2. Tipos de memória são diferentes

Separar:

- dados de placa;
- caso real de reparo;
- conhecimento geral;
- sessão de chat.

Não misturar tudo em uma única coleção sem semântica.

### 3. O chat precisa saber pedir contexto

Quando o usuário disser algo como:

- `analisar`
- `problema`
- `defeito`
- `nao sei o modelo da placa`

o Volt deve pedir:

- modelo da placa ou equipamento;
- sintoma principal;
- medições, se existirem.

Não vale mandar isso para API sem contexto.

Caso especial:

```text
Usuario: "nao sei o modelo da placa"
```

Comportamento correto:

- nao procurar esquema por termos como `da placa`;
- nao chamar Groq;
- iniciar triagem geral/checklist local;
- pedir que o usuario escolha o sintoma principal.

### 4. Checklist e fluxo guiado são a mesma superfície

O checklist visual é a tela principal de triagem.

Ele deve conter:

- painel esquerdo com etapas já identificadas;
- painel direito com perguntas `Sim/Não`;
- perguntas iniciais `Liga?` e `Liga sem vídeo?`;
- ramificações conforme as respostas do usuário ou botões.

O mapa técnico é ferramenta manual de medição.

Ele não deve abrir automaticamente no lugar do checklist.

---

## Modelos atuais

### Local

```text
DEFAULT_MODEL = llama3.2:3b
```

Papel:

- instant intents;
- triagem simples;
- respostas curtas;
- baixa latência;
- suporte ao modo offline.

### Remoto

```text
DEFAULT_GROQ_MODEL = llama-3.1-8b-instant
```

Papel:

- análise técnica mais profunda;
- síntese de múltiplas fontes locais;
- fallback para perguntas técnicas maiores.

---

## Limites da Groq considerados

```text
RPM  = 30
RPD  = 14400
TPM  = 6000
TPD  = 500000
```

A IA futura deve assumir que há orçamento limitado e manter a política:

```text
nao mandar PDF inteiro
nao mandar contexto cru demais
nao gastar API em saudacao ou pergunta vaga
```

---

## Onde estão as decisões de IA

| Tema | Arquivo |
|---|---|
| orquestração principal | `backend/services/aiService.js` |
| intenções instantâneas locais | `backend/services/intentService.js` |
| Groq | `backend/services/groqService.js` |
| orçamento | `backend/services/tokenBudgetService.js` |
| esquema filtrado | `backend/services/schematicContextService.js` |
| memória automática | `backend/services/autoMemoryService.js` |
| comparação de MOSFET | `backend/services/mosfetService.js` |

---

## Onde estão os dados

### Banco ativo

```text
backend/data/volt.db
```

### Legado

```text
backend/data/*.json
```

Esses JSONs não são mais o armazenamento principal, mas continuam úteis como legado e seed.

### Base Markdown

```text
backend/base/*.md
```

Essa base é indexada no SQLite e deve continuar sendo pensada como conhecimento editável por humano.

---

## Como o chat pensa hoje

### Camada 1: comando local

Em `ChatPanel.jsx`, antes de enviar para IA:

- confirmar seleção de esquema;
- resolver aliases;
- executar comandos explícitos;
- tratar `analisar`/`analisar circuito`;
- salvar memória;
- criar checklist;
- gravar nota de placa.

### Camada 2: resposta local instantânea

Em `intentService.js`:

- saudações;
- social;
- obrigado;
- confirmação;
- pedidos genéricos;
- triagem curta;
- perguntas vagas.

### Camada 3: IA local/remota

Em `aiService.js`:

- usa memória recente do chat;
- consulta base técnica;
- tenta detectar placa;
- injeta checklists, notas, casos, esquema filtrado;
- decide rota local, híbrida ou API.

---

## Como a UI central pensa hoje

`CircuitAnalyzer.jsx` contém múltiplas superfícies:

- `checklist`
- `schematic`
- `analyzer`

Significado:

- `checklist`: resumo visual e fluxo guiado por botões `Sim/Não`;
- `schematic`: PDF/imagem/boardview;
- `analyzer`: mapa técnico de medições.

Regra importante:

- se houver triagem, abrir `checklist`, não `analyzer`;
- `analisar` sozinho sempre pede código/modelo da placa e sintoma;
- `analisar circuito` é usado apenas quando já existem medições no mapa técnico.

---

## Fluxo guiado atual

O fluxo guiado fica integrado ao checklist.

Estado atual inclui, entre outros:

- `powerOn`
- `noVideo`
- `powerState`
- `dcinPresent`
- `shuntPresent`
- `shortAtShunt`
- `shortAfterShunt`
- `visualFound`
- `injectionDone`
- `externalVideo`
- `screenLight`

Ramo `não liga`:

1. perguntar se há tensão no DC jack / entrada principal;
2. se houver tensão, perguntar se chega ao resistor shunt;
3. se não chega ao shunt, medir curto no shunt / entrada da linha principal antes de culpar MOSFET;
4. se houver curto, classificar como circuito de entrada / alimentação principal em curto;
5. se não houver curto no shunt, medir continuidade dos MOSFETs de entrada;
6. se MOSFETs estiverem ok, avançar para 3V/5V always-on.

Após injeção de tensão:

- se o usuário marcou que fez injeção e houve aquecimento, abrir campo para informar o componente aquecendo;
- exemplo de entrada: `PQ302`, `PR14`, `PU301`, `PC123`;
- ao receber o componente, buscar no PDF trechos próximos daquela referência;
- antes de chamar API, montar dossiê local com nome/part number, circuito provável, pinout extraído e pinos prováveis de alimentação/GND/sense;
- localizar a folha/bloco do componente localmente, usando título de folha como `PWR +CPU_CORE/+VGFX_CORE`;
- expandir o contexto para o bloco funcional do circuito, como VCORE, charger, 3V/5V always ou backlight;
- extrair rails/nets, controladores, MOSFETs, indutores e passivos de sense/feedback do bloco;
- enviar para API somente o componente, estado do fluxo, dossiê local, bloco funcional e trechos filtrados do esquema;
- pedir análise de setor, função provável, pinos/linhas de alimentação quando existirem no contexto e próximos testes;
- nunca inventar pino ou tensão ausente no PDF/boardview.

Exemplo validado:

- na LA-6901P, `PU12` é extraído como `ISL95831CRZ-T_TQFN48_6X6`;
- o bloco local é `PWR +CPU_CORE/+VGFX_CORE`;
- rails esperados no pacote incluem `CPU_CORE`, `VGFX_CORE`, `VIN`, `VDD`, `VDDP`, `BOOT`, `PHASE`;
- MOSFETs do bloco aparecem como `PQ49`, `PQ50`, `PQ51`, `PQ52`, `PQ53`, `PQ54`, `PQ55`, `PQ56`, `PQ57`, `PQ58`.

Identificação de shunt:

- o shunt pode não aparecer no PDF com a palavra `shunt`;
- reconhecer resistores `PR/R` de baixíssima resistência, como `0.02`, `0R02`, `20mR`, `2512`, `1%`, próximos ao bloco `DCIN`, `VIN`, `B+`, `PWR DCIN`, `ACN/ACP` ou charger;
- exemplo validado: na Compal LA-6901P, `PR14 0.02_2512_1%` é o resistor shunt/sense da linha principal de entrada.

Ramo `liga sem vídeo`:

1. testar vídeo externo;
2. verificar backlight/tela;
3. se houver vídeo externo, focar tela, flat, conector e backlight;
4. se não houver vídeo externo, focar RAM, BIOS, tensões always/on e sequência de start.

Uma IA futura deve expandir isso com cuidado, sem:

- pular passos lógicos;
- exibir etapas não ativadas;
- supor sintoma que o usuário não informou.

---

## Busca de esquema

Hoje o lookup de esquema ocorre principalmente no frontend, em `ChatPanel.jsx`, com:

- heurística fuzzy;
- extração de código de placa;
- normalização de pequenas variações;
- confirmação antes de abrir.

A IA futura deve preservar a regra:

```text
palavra generica nao deve virar busca de esquema
```

Exemplo:

- `analisar` não pode acionar busca;
- `placa la-6901p` pode;
- `acer a515` pode;
- `positivo`, `positv`, `sasung` podem entrar em fuzzy controlado.

---

## Memória automática

Hoje o sistema já tenta aprender a partir de:

- comandos manuais;
- frases naturais com `salve`, `guarde`, `registre`;
- interações bem-sucedidas da API Groq quando consideradas reaproveitáveis.

Uma IA futura deve respeitar o filtro:

- nem toda resposta da API vira aprendizado;
- salvar apenas o que tiver valor futuro;
- evitar poluir banco com conversa vazia.

---

## Debug e rastreabilidade

O projeto já possui janela separada de debug.

Ela é importante porque torna visível:

- startup;
- rota local/API;
- tempo de resposta;
- tentativa local antes da API;
- tokens de entrada/saída;
- motivo de fallback.

Ao alterar fluxo IA, preserve logs legíveis.

---

## MOSFETs

O Volt já tem trilha local dedicada para MOSFET.

Arquivos importantes:

- `documentacao/MOSFETS.md`
- `backend/base/mosfets.md`
- `backend/data/mosfets.json`
- `backend/services/mosfetService.js`

Regra importante:

- não inventar parâmetro ausente;
- não tratar MOSFETs diferentes como equivalentes automáticos;
- distinguir discreto simples, dual e DrMOS.

---

## Mudanças futuras recomendadas

1. criar camada de repositório para separar SQL dos serviços;
2. melhorar FTS/recuperação local;
3. ampliar fluxo guiado para 3V/5V, vídeo, charger e sequência de power;
4. ligar botões do fluxo guiado ao histórico do chat;
5. separar melhor componentes e circuitos do mapa técnico;
6. reforçar aprendizado reutilizável a partir de casos validados.

---

## Checklist mental para uma futura IA

Antes de mexer:

1. entender se a mudança afeta local/API;
2. entender se afeta memória;
3. entender se afeta fluxo guiado;
4. entender se afeta lookup de esquema;
5. atualizar documentação junto.

Se a mudança for em modelo, fluxo ou persistência, atualizar também:

- `README.md`
- `VISAO_GERAL.md`
- `ESTRUTURA_ARQUIVOS.md`
- `COMO_EXPANDIR.md`
- `resources/ollama/LEIA-ME.txt`
