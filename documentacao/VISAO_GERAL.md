# Visão Geral do Projeto — Volt

Este documento descreve o estado conceitual atual do Volt.

O Volt é um assistente desktop para bancada de eletrônica. Ele combina:

- interface React;
- empacotamento com Electron;
- backend local em Express;
- modelo local via Ollama;
- uso híbrido de Groq quando necessário;
- memória persistente em SQLite.

---

## Ideia central

O Volt não deve responder assim:

```text
pergunta -> modelo -> resposta generica
```

O Volt deve responder assim:

```text
pergunta
  -> detectar intencao
  -> identificar placa/modelo/sintoma
  -> buscar memoria local
  -> localizar esquema ou boardview
  -> montar contexto enxuto
  -> responder localmente ou usar API se fizer sentido
```

Esse princípio é mais importante do que qualquer detalhe de implementação.

---

## Papel de cada IA

### Llama local via Ollama

Modelo padrão:

```text
llama3.2:3b
```

Uso esperado:

- saudações;
- comandos;
- perguntas simples;
- triagem curta;
- respostas instantâneas;
- apoio ao fluxo guiado;
- fallback local quando não vale gastar API.

### Groq Llama 3.1 8B

Modelo padrão:

```text
llama-3.1-8b-instant
```

Uso esperado:

- análise técnica mais longa;
- síntese baseada em vários contextos locais;
- respostas onde a base local e o Llama local não bastam;
- casos em que o modo avançado força uso da API.

---

## Decisão de produto sobre contexto

O Volt deve sempre tentar reduzir o problema antes de chamar a API.

Exemplo correto:

```text
Usuario: "A fonte desarma"
  -> identificar que isso aponta para entrada/curto
  -> procurar placa citada
  -> localizar termos como DCIN, VIN, B+, shunt, MOSFET, charger
  -> incluir notas/casos/trechos relevantes
  -> somente depois chamar a Groq
```

Exemplo errado:

```text
Usuario: "A fonte desarma"
  -> mandar a frase crua para a API
```

---

## Memória local

O banco ativo fica em:

```text
backend/data/volt.db
```

O Volt hoje usa SQLite para consolidar:

- placas;
- defeitos;
- notas;
- pontos de tensão;
- casos de reparo;
- checklists;
- conhecimento geral;
- sessões e mensagens de chat;
- indexação da base Markdown.

Os JSONs ainda existentes em `backend/data/` são legado/importação inicial.

---

## Entidades principais

### Placa

Representa um hardware específico.

Exemplos:

- `LA-6901P`
- `LA-E891P`
- `Acer A515 LAH782P`

Guarda:

- marca;
- modelo;
- caminho de esquema;
- defeitos conhecidos;
- notas;
- pontos de tensão.

### Caso de reparo

Representa um atendimento real da bancada.

Campos típicos:

- sintoma;
- medições;
- análise;
- causa;
- solução;
- resultado.

### Conhecimento geral

Representa regra técnica reutilizável.

Exemplo:

```text
REGN ausente em charger BQ pode indicar VCC ausente, ACDET invalido ou CI defeituoso.
```

### Checklist

Representa uma sequência de passos por problema.

### Sessão de chat

Representa uma conversa completa com o usuário.

Hoje isso é importante porque o Volt:

- salva histórico;
- pode reaproveitar mensagens recentes como contexto;
- pode evoluir para busca histórica futura.

---

## Fluxo de interface

Hoje o centro da aplicação pode assumir três papeis:

1. checklist visual com fluxo `Sim/Não` integrado;
2. esquema/boardview;
3. mapa técnico.

Decisão importante:

- checklist e fluxo guiado não devem virar abas separadas;
- o checklist abre com painel esquerdo de etapas e painel direito de perguntas;
- as primeiras perguntas são `Liga?` e `Liga sem vídeo?`;
- para casos `não liga`, a abertura padrão deve priorizar o checklist integrado;
- o mapa técnico é uma ferramenta manual, não a primeira tela obrigatória.

---

## Fluxo guiado

O fluxo guiado existe para transformar conversa em diagnóstico interativo dentro do próprio checklist.

Hoje ele já começa a separar:

- `Liga?` sim/não;
- `Liga sem vídeo?` sim/não.

No ramo `não liga`, ele aprofunda por decisões como:

- tem tensão no DC jack?
- chega ao shunt?
- há curto no shunt ou entrada da linha principal?
- há curto após o shunt?
- houve inspeção visual?
- houve injeção de 1V?

Regra técnica importante:

- se existe tensão na entrada, mas não chega ao shunt, medir curto no shunt/linha principal antes de partir para MOSFETs;
- se houver curto, tratar como alimentação principal em curto;
- se não houver curto, medir continuidade dos MOSFETs de entrada;
- se MOSFETs estiverem íntegros, avançar para fontes 3V/5V always-on.

No ramo `liga sem vídeo`, ele já começa a separar:

- há vídeo externo?
- há backlight/tela acesa?

Esse sistema deve crescer, não ser removido.

---

## Janela de debug

O app Electron abre uma segunda janela:

```text
Volt Debug
```

Ela serve para:

- acompanhar startup;
- ver se a resposta veio do local, da API ou de atalho instantâneo;
- visualizar tempo de resposta;
- observar consumo de tokens quando houver Groq;
- conferir reuso de backend/Ollama.

Essa janela é parte funcional do produto atual.

---

## Startup do app

O processo atual é:

```text
1. Ollama
2. Backend
3. Aquecimento do modelo
4. Abrir interface
```

Detalhes relevantes:

- o Electron tenta reutilizar backend atual quando ele responde ao protocolo esperado;
- o Electron usa `resources/ollama/ollama.exe` quando disponível;
- o app centraliza runtime do Ollama em pasta local do projeto/app;
- o modelo local é aquecido antes da interface final.

---

## Busca de esquema e boardview

O Volt faz busca local/fuzzy em arquivos na pasta `Schematic`.

Comportamento esperado:

- detectar código de placa mesmo com pequena variação;
- sugerir o resultado mais próximo;
- listar alternativas;
- perguntar se deve abrir o esquema;
- não confundir palavras genéricas como `analisar` com nome de placa.

Quando houver placa identificada sem sintoma, o sistema deve:

- mostrar que a placa foi reconhecida;
- indicar se há esquema/boardview;
- pedir o sintoma principal antes de presumir o fluxo.

---

## Consultas de MOSFET

O Volt possui uma trilha local separada para MOSFETs.

Ela deve responder:

- comparação;
- sugestão de candidatos;
- classificações como compatível, compatível com ressalva, incompatível, dados insuficientes.

Essa trilha deve priorizar:

- `mosfetService`;
- `backend/data/mosfets.json`;
- `backend/base/mosfets.md`;
- `documentacao/MOSFETS.md`.

---

## Regra de ouro para futuras mudanças

Ao mexer no Volt, preservar:

1. prioridade do contexto local;
2. separação entre tipos de memória;
3. uso econômico da API;
4. execução local/offline como base;
5. Electron com preload seguro;
6. documentação atualizada junto com a mudança.

---

## Resultado desejado

O Volt deve evoluir para ser:

```text
uma memoria tecnica viva da oficina
com triagem local rapida
com historico consultavel
com esquema local
com fluxo guiado
e com API apenas como acelerador, nao como muleta
```
