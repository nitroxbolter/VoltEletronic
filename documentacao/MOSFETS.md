# Base de MOSFETs — Volt

Este documento descreve a lógica usada pelo Volt para consultas e comparação de MOSFETs.

Referências locais relacionadas:

- `backend/data/mosfets.json`
- `backend/base/mosfets.md`
- `backend/services/mosfetService.js`

---

## Objetivo

Dar suporte local para perguntas como:

- `qual MOSFET posso usar no lugar do AON7410?`
- `posso usar AON7408 no lugar do AON7410?`
- `tenho AON6428, o que serve como candidato?`

O Volt deve responder preferencialmente sem API nesses casos.

---

## Regra principal

Nunca declarar substituição apenas porque tensão e corrente parecem parecidas.

Antes de sugerir compatibilidade, verificar:

1. polaridade;
2. VDS;
3. encapsulamento;
4. pinagem;
5. RDS(on);
6. gate drive / VGS;
7. corrente útil;
8. dissipação;
9. Qg, quando relevante;
10. função do MOSFET no circuito.

---

## Classificação usada pelo Volt

### `COMPATÍVEL`

Todos os parâmetros críticos atendem sem ressalva importante.

### `COMPATÍVEL COM RESSALVA`

Pode servir, mas há diferença relevante que exige leitura do circuito.

### `INCOMPATÍVEL`

Existe parâmetro crítico incompatível.

### `DADOS INSUFICIENTES`

Não há base suficiente para afirmar.

---

## Regras objetivas de comparação

### Polaridade

Obrigatória.

```text
N-Channel -> somente N-Channel
P-Channel -> somente P-Channel
```

### VDS

- preferir igual ou maior;
- não reduzir VDS sem margem técnica clara;
- em entrada de notebook, 30 V é comum e deve ser tratado com cautela.

### Corrente

- preferir igual ou maior;
- corrente menor pode entrar como candidato apenas com ressalva;
- não usar o valor de datasheet sozinho como verdade absoluta da aplicação.

### RDS(on)

- preferir igual ou menor;
- comparar sempre na mesma condição de VGS;
- diferença pequena pode virar ressalva, não compatibilidade direta.

### VGS / acionamento

Deve ser coerente com o driver do circuito.

### Qg

Importante em:

- VCORE;
- GPU;
- DDR;
- conversores rápidos;
- high-side/low-side de fontes chaveadas.

### Encapsulamento e pinagem

Mesmo tamanho físico não basta.

O Volt deve evitar mostrar pinagem desnecessária em respostas curtas ao usuário final, mas precisa usar isso internamente como critério.

---

## Formato de resposta recomendado

Para o usuário final, o Volt deve responder com algo filtrado e legível.

Exemplo:

```text
Original: AON7410
30 V
24 A
RDS(on) 20 mOhm @10 V / 26 mOhm @4.5 V

Candidato: AON7408
30 V
18 A
RDS(on) 20 mOhm @10 V / 32 mOhm @4.5 V

Resultado: nao recomendado
Motivo: mesma familia e mesma tensao, mas corrente menor e RDS(on) pior em 4.5 V.
```

Para o chat comum:

- mostrar voltagem e amperagem;
- mostrar RDS(on) quando relevante;
- evitar despejar pinagem longa sem necessidade;
- evitar Qg quando não for o ponto central da pergunta.

---

## Modelos já considerados na base local

Entre os principais já documentados:

- AON7410
- AON7408
- AON7400A
- SiS412DN
- SiS780DN
- Si7121DN
- AON6428
- AON6794
- FDMS3664S
- AOZ5049QI

Modelos presentes no analisador, mas que exigem ficha técnica validada antes de respostas fortes:

- AON6366E
- AON7506

---

## Casos especiais

### Dual MOSFET

Exemplo:

- `FDMS3664S`

Não comparar como se fosse MOSFET discreto simples.

### DrMOS / power stage integrado

Exemplo:

- `AOZ5049QI`

Não sugerir MOSFET discreto como substituto direto sem uma análise muito mais profunda.

---

## Filosofia do Volt para equivalência

```text
Parametro proximo -> candidato para comparacao
Parametro adequado ao circuito -> compatibilidade
```

Ou seja:

- busca pode ser mais ampla;
- confirmação precisa ser conservadora.

---

## O que uma futura IA deve preservar

1. não inventar dados ausentes;
2. não simplificar demais consulta de substituição;
3. não responder com certeza quando só há semelhança parcial;
4. priorizar a função no circuito;
5. manter respostas de bancada enxutas.

---

## Expansão recomendada da base

Ao adicionar um novo MOSFET, registrar se possível:

```text
modelo
fabricante
tipo
configuracao
VDS
ID
VGS max
RDS(on) @10 V
RDS(on) @4.5 V
Qg
encapsulamento
pinagem
funcao no circuito
placas encontradas
fonte de dados
```

Se algum item não existir, manter ausente ou marcar como desconhecido. Não adivinhar.
