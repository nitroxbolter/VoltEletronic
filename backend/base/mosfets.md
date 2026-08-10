# VOLT --- Base de MOSFETs de Notebook

> Base inicial montada a partir dos esquemas elétricos usados na
> bancada, priorizando **entrada/DC-IN, charger e VCORE/VRM**.
>
> **Importante:** a base serve para sugerir candidatos. Compatibilidade
> final depende da função no circuito, polaridade, tensão suportada,
> corrente útil, RDS(on), acionamento de gate, encapsulamento e pinagem.

## Status da base local

Já cadastrados e disponíveis para comparação:

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

Pendentes de cadastro técnico completo:

- AON6366E
- AON7506

Esses dois modelos já aparecem no analisador visual do Volt. Enquanto a
ficha local não for validada, o sistema não deve inventar parâmetros
nem confirmar substituição automática para eles.

## Regra de compatibilidade do Volt

### Obrigatório

-   **N-Channel → N-Channel**
-   **P-Channel → P-Channel**
-   Mesma função/topologia compatível.
-   Pinagem e footprint compatíveis.

### Tensão VDS

-   Preferir **igual ou maior** que o original.
-   Um valor apenas "próximo" pode entrar como candidato, mas não deve
    ser aprovado se ficar sem margem para a tensão real da linha.
-   Em entrada de notebook de \~19--20 V, MOSFETs de **30 V** são
    comuns; não reduzir automaticamente para 20/25 V.

### Corrente ID

-   Pode ser próxima.
-   Preferir **igual ou maior**.
-   Aceitar como candidato a partir de aproximadamente **80% do ID do
    original**, desde que a corrente real do circuito tenha margem
    suficiente.
-   Não usar o número de amperes do datasheet isoladamente para decidir
    equivalência.

### RDS(on)

-   Preferir igual ou **menor** que o original.
-   Até \~20% maior pode ser listado como candidato com ressalva.
-   Comparar sempre na **mesma tensão VGS**.

### Gate / chaveamento

-   VGS de acionamento deve ser compatível.
-   Em VCORE, GPU, DDR e outros conversores rápidos, comparar também
    **Qg / gate charge** e comportamento de chaveamento.

### Classificação

-   🟢 **COMPATÍVEL** --- parâmetros críticos atendem.
-   🟡 **COMPATÍVEL COM RESSALVA** --- pode funcionar, mas há diferença
    relevante.
-   🔴 **INCOMPATÍVEL** --- polaridade, VDS, pinagem, gate ou outro
    parâmetro crítico não atende.
-   ⚪ **DADOS INSUFICIENTES** --- não afirmar compatibilidade.

------------------------------------------------------------------------

# 1. ENTRADA / DC-IN / CHARGER

## SiS412DN

-   Fabricante: Vishay
-   Tipo: **N-Channel**
-   VDS: **30 V**
-   Encapsulamento: PowerPAK 1212-8 / família DN
-   RDS(on): **até 30 mΩ @ VGS 4,5 V** conforme documentação/aplicação
    consultada
-   ID de referência: **12 A** na aplicação Vishay citada
-   Qg típico: **3,8 nC**
-   Uso encontrado nos esquemas:
    -   charger
    -   high-side de conversores
    -   estágios DC/DC
-   Encontrado em:
    -   Dell Inspiron 3442
    -   Acer/Compal LA-9535P
-   Observação: aparece repetidamente nos esquemas analisados e merece
    prioridade alta na base.

## SiS780DN

-   Fabricante: Vishay
-   Tipo: **N-Channel com Schottky integrado**
-   VDS: **30 V**
-   Encapsulamento: PowerPAK 1212-8
-   RDS(on) encontrado no esquema Dell:
    -   **14,5 mΩ típico / 17,5 mΩ máx @ VGS 4,5 V**
-   Uso encontrado:
    -   low-side de conversores DC/DC
    -   par com SiS412DN
-   Observação: não tratar automaticamente como equivalente ao SiS412DN
    só porque ambos são 30 V; a função high-side/low-side e
    características de chaveamento são diferentes.

## Si7121DN

-   Fabricante: Vishay
-   Tipo: **P-Channel**
-   VDS: **-30 V**
-   Uso encontrado:
    -   chaveamento/proteção de alimentação em circuitos de potência
-   Regra:
    -   **não substituir por N-Channel**.
-   Encontrado no Dell Inspiron 3442.

## AON7410

-   Fabricante: Alpha & Omega Semiconductor
-   Tipo: **N-Channel**
-   VDS: **30 V**
-   ID: **24 A @ VGS 10 V**
-   VGS máximo: **±20 V**
-   RDS(on):
    -   **\<20 mΩ @ 10 V**
    -   **\<26 mΩ @ 4,5 V**
-   Encapsulamento: **DFN 3x3 EP**
-   Uso típico:
    -   DC/DC
    -   load switch
    -   alimentação de notebook
-   Prioridade: alta para comparação de MOSFETs 30 V DFN 3x3.

## AON7408

-   Fabricante: Alpha & Omega Semiconductor
-   Tipo: **N-Channel**
-   VDS: **30 V**
-   ID: aproximadamente **18 A**
-   RDS(on):
    -   \~**20 mΩ @ 10 V**
    -   \~**32 mΩ @ 4,5 V**
-   Encapsulamento: **DFN 3x3**
-   Uso: chaveamento/DC-DC.
-   Atenção: **AON7408 ≠ AO7408**.

## AON7400A

-   Fabricante: Alpha & Omega Semiconductor
-   Tipo: **N-Channel**
-   VDS: **30 V**
-   ID: aproximadamente **40 A**
-   RDS(on):
    -   \~**7,5 mΩ @ 10 V**
    -   \~**10,5 mΩ @ 4,5 V**
-   Encapsulamento: **DFN 3x3**
-   Observação: forte candidato em aplicações de 30 V quando
    footprint/pinagem e chaveamento forem compatíveis.

------------------------------------------------------------------------

# 2. VCORE / CPU / GPU / VRM

## AON6428

-   Fabricante: Alpha & Omega Semiconductor
-   Tipo: **N-Channel**
-   VDS: **30 V**
-   ID @ 25 °C: **43 A**
-   VGS máximo: **±20 V**
-   RDS(on):
    -   **10 mΩ máx @ 10 V**
    -   **14,5 mΩ máx @ 4,5 V**
-   Qg @ 4,5 V: **7,1 nC**
-   Encapsulamento: **DFN 5x6-8L**
-   Situação do fabricante: obsoleto; AOS indica AONS18314 como
    substituto moderno.
-   Uso encontrado no esquema Compal LA-D641P:
    -   **High-Side do VCC_VCGI/VCORE**
    -   esquema informa \~11,3 mΩ típico / 14,5 mΩ máximo no projeto.
-   Perfil: MOSFET de high-side com gate charge relativamente baixo.

## AON6794

-   Fabricante: Alpha & Omega Semiconductor
-   Tipo: **N-Channel SRFET**
-   VDS: **30 V**
-   ID @ 25 °C: **85 A**
-   VGS máximo: **±12 V**
-   RDS(on):
    -   **2,8 mΩ máx @ 10 V**
    -   **3,5 mΩ máx @ 4,5 V**
-   Qg:
    -   **17 nC @ 4,5 V**
    -   **37,5 nC @ 10 V**
-   Encapsulamento: **DFN 5x6-8L**
-   Uso encontrado no Compal LA-D641P:
    -   **Low-Side do VCC_VCGI/VCORE**
    -   esquema informa \~2,8 mΩ típico / 3,5 mΩ máximo.
-   Perfil: baixa resistência e alta corrente, típico de low-side de
    VRM.

### AON6428 × AON6794

Apesar de ambos serem N-Channel 30 V e terem o mesmo tipo geral de
encapsulamento, **não devem ser considerados equivalentes automáticos**.

-   AON6428: favorece high-side / menor Qg.
-   AON6794: favorece low-side / RDS(on) extremamente baixo.
-   O Volt deve considerar a posição no VRM antes de sugerir troca.

## FDMS3664S

-   Fabricante atual: onsemi (linha Fairchild/PowerTrench)
-   Tipo: **Dual N-Channel assimétrico**
-   Função: power stage para buck síncrono
-   Encapsulamento: **PQFN8 Power56 5x6**
-   Q1 / High-Side:
    -   RDS(on) máx **8 mΩ @ 10 V**
    -   RDS(on) máx **11 mΩ @ 4,5 V**
-   Q2 / Low-Side:
    -   RDS(on) máx **2,6 mΩ @ 10 V**
    -   RDS(on) máx **3,2 mΩ @ 4,5 V**
-   Uso típico oficial: **Notebook VCORE**
-   Encontrado no esquema Dell Inspiron 3442 em estágio de potência.
-   Atenção: é um **MOSFET duplo integrado**, portanto não comparar como
    se fosse um MOSFET discreto simples.

## AOZ5049QI

-   Fabricante: Alpha & Omega Semiconductor
-   Tipo: **DrMOS / power stage integrado**
-   Não é um MOSFET discreto simples.
-   Contém:
    -   MOSFET High-Side
    -   MOSFET Low-Side
    -   driver
-   VIN: **4,5 a 25 V**
-   Corrente de saída: **até 35 A**
-   Frequência: **até 2 MHz**
-   Encapsulamento: **QFN 3,5 x 5 mm, 24 pinos**
-   Uso:
    -   VCORE
    -   VCCGT
    -   VRM de notebook
-   Encontrado no Acer Aspire E5-575 / Quanta ZAAA.
-   O fabricante indica **AOZ5048QI** como produto de substituição para
    novos projetos.
-   Regra: não sugerir MOSFET discreto como substituto direto de
    AOZ5049QI.

------------------------------------------------------------------------

# 3. MOSFETS DE 3 V / 5 V / DDR ENCONTRADOS NOS ESQUEMAS

## SiS412DN + SiS780DN

Esse par também aparece em conversores secundários.

Exemplo encontrado no Dell Inspiron 3442: - High-Side: **SiS412DN** -
Low-Side: **SiS780DN** - controlador RT8237 - linha de aproximadamente
1,05 V

Portanto, o Volt deve armazenar também a **função encontrada**, não
somente o part number.

## FDMS3664S

Também pode aparecer em reguladores de memória/rails de alta corrente
devido ao par assimétrico integrado.

------------------------------------------------------------------------

# 4. REGRA DE BUSCA POR EQUIVALÊNCIA

Quando o usuário perguntar:

> "Qual MOSFET posso colocar no lugar do AON6428?"

O Volt deve buscar nesta ordem:

1.  mesma polaridade;
2.  mesmo tipo: discreto simples / dual / DrMOS;
3.  mesmo footprint e pinagem;
4.  VDS igual ou superior, ou próximo com margem comprovada;
5.  ID próximo ou superior;
6.  RDS(on) próximo ou menor na mesma VGS;
7.  VGS compatível;
8.  Qg próximo quando for chaveamento de alta frequência;
9.  verificar se o original trabalha como:
    -   entrada/load switch;
    -   charger;
    -   high-side;
    -   low-side;
    -   VCORE;
    -   GPU;
    -   DDR;
    -   3V/5V.

------------------------------------------------------------------------

# 5. FORMATO DE RESPOSTA DO VOLT

## Original

-   Modelo:
-   Polaridade:
-   VDS:
-   ID:
-   RDS(on):
-   VGS:
-   Qg:
-   Encapsulamento:
-   Função na placa:

## Candidato

-   Modelo:
-   Polaridade:
-   VDS:
-   ID:
-   RDS(on):
-   VGS:
-   Qg:
-   Encapsulamento:
-   Função típica:

## Resultado

-   🟢 Compatível
-   🟡 Compatível com ressalva
-   🔴 Incompatível
-   ⚪ Dados insuficientes

## Motivo

Explicar em no máximo 3--5 linhas quais parâmetros tornam o componente
adequado ou inadequado.

------------------------------------------------------------------------

# 6. DADOS EXTRAÍDOS DOS ESQUEMAS --- REFERÊNCIA

### Compal LA-D641P

VCORE/VCC_VCGI: - High-Side: **AON6428** - Low-Side: **AON6794**

### Dell Inspiron 3442

Foram encontrados repetidamente: - **SiS412DN** - **SiS780DN** -
**Si7121DN** - **FDMS3664S**

O SiS412DN aparece inclusive em múltiplas posições de charger/DC-DC.

### Acer Aspire E1-530/E1-570 --- LA-9535P

No estágio de charger foram encontrados vários: - **SiS412DN**

### Acer Aspire E5-575 --- Quanta ZAAA

VCORE/VCCGT: - **AOZ5049QI** DrMOS integrado.

------------------------------------------------------------------------

# 7. NOTAS PARA EXPANSÃO DA BASE

A base deve crescer a partir dos próprios schematics.

Para cada novo MOSFET encontrado, registrar:

``` text
part_number
fabricante
polaridade
configuracao
vds
id
vgs_max
rds_10v
rds_4v5
qg
encapsulamento
pinagem
funcao_encontrada
placas_encontradas
high_side
low_side
charger
dcin
vcore
gpu
ddr
fonte_dados
```

Não preencher valor desconhecido por aproximação. Marcar como
`desconhecido` até existir datasheet ou informação confiável.
