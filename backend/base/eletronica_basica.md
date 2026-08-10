# Eletronica Basica

## Lei de Ohm

V = R x I (tensao = resistencia x corrente).

I = V / R (corrente = tensao / resistencia).

R = V / I (resistencia = tensao / corrente).

Potencia:

```text
P = V x I
P = I2 x R
P = V2 / R
```

## Componentes Passivos

Resistor limita corrente e divide tensao. Deve ser medido com multimetro no modo ohms, com o circuito desligado.

Capacitor armazena carga, bloqueia DC e passa AC. Falhas comuns: capacitancia baixa, ESR alto, fuga, curto ou mau contato.

Indutor ou bobina armazena energia em campo magnetico. Em fontes chaveadas aparece em filtros e conversores.

## Diodos

Diodo retificador conduz em um sentido. Teste no modo diodo: geralmente 0.5 V a 0.7 V direto e OL no inverso.

Zener regula tensao em condução reversa. A tensao depende do componente, por exemplo 5V1 para 5.1 V.

LED e um diodo emissor de luz. Testa parecido com diodo comum e pode acender no modo diodo.

Diodo Schottky tem queda baixa, geralmente perto de 0.2 V a 0.4 V, muito usado em fontes chaveadas.

## Transistores

BJT NPN conduz quando a base esta positiva em relacao ao emissor. BJT PNP conduz quando a base esta negativa em relacao ao emissor.

Teste BJT no modo diodo: base-emissor e base-coletor devem mostrar queda aproximada de 0.6 V; coletor-emissor deve ficar OL em um componente saudavel fora do circuito.

MOSFET N-channel conduz quando VGS passa do threshold. MOSFET P-channel conduz com VGS negativo em relacao ao source.

Teste rapido de MOSFET: gate flutuante tende a deixar drain-source aberto; ao carregar gate, o canal pode conduzir. Sempre considerar circuito ao redor.

## Reguladores de Tensao

Regulador linear como 7805, 7812 e LM317 precisa de entrada maior que saida e dissipa excesso em calor.

7805 tem saida fixa de 5 V. Pinos comuns: entrada, GND e saida.

LM317 e ajustavel:

```text
Vout = 1.25 x (1 + R2/R1)
```

Teste basico: medir entrada e saida com multimetro. Saida deve ser estavel conforme especificacao.

## Capacitores Eletroliticos

Sinais de falha:

- topo estufado;
- vazamento;
- ESR elevado;
- capacitancia baixa;
- aquecimento anormal.

ESR elevado causa instabilidade em fontes, ripple na saida e reinicializacoes aleatorias.

Medir com ESR meter ou capacimetro com funcao ESR.

## Fontes Chaveadas

Principio: PWM chaveia transistor ou MOSFET em alta frequencia, passa energia por transformador ou indutor, retifica e filtra a saida.

Pontos de teste comuns:

- entrada AC: deve ter tensao da rede;
- apos retificacao: perto de 160 V em rede 110 V AC ou 310 V em rede 220 V AC;
- TL431 ou referencia shunt: geralmente 2.5 V;
- saida principal: conforme especificacao, como 5 V, 12 V ou 19 V;
- standby: geralmente 5 V em fonte ATX, presente mesmo sem ligar.

Defeitos comuns:

- nao liga: verificar fusivel, varistor, transistor de potencia e CI PWM;
- saida baixa: verificar capacitores de filtro e diodos de saida;
- curto na saida: medir resistencia entre GND e trilhas de alimentacao.

## Multimetro

Tensao DC: medir em paralelo com o circuito energizado. Ponta preta no GND e vermelha no ponto medido.

Tensao AC: medir em paralelo; polaridade nao importa.

Resistencia: medir com circuito desligado.

Continuidade: bipe confirma trilha, fusivel ou cabo sem ruptura, mas nao substitui analise de baixa resistencia.

Modo diodo: testa diodos, juncoes de transistores e quedas em semicondutores.

Corrente DC: multimetro em serie com a carga. Usar borne correto de A ou mA.

## Identificacao de Curtos

Com multimetro em continuidade ou ohms:

- medir entre VCC e GND;
- 0 ohm ou bipe forte indica curto;
- abaixo de 10 ohms pode ser suspeito, dependendo da linha;
- linhas de CPU/GPU podem ter baixa resistencia normal.

Com fonte de bancada:

- usar tensao baixa, como 1 V a 2 V;
- limitar corrente, por exemplo 0.5 A no inicio;
- localizar aquecimento com dedo, alcool isopropilico, camera termica ou fluxo.

Quando um componente aquece durante injecao:

- registrar a referencia do componente, por exemplo PQ302, PR14, PU301 ou PC123;
- localizar no esquema qual setor ele pertence;
- identificar, se o esquema permitir, pinos de alimentacao, GND, gate/source/drain ou VCC;
- medir resistencia da linha de alimentacao desse componente para GND;
- se for capacitor em curto, remover e verificar se a linha deixa de aquecer;
- se for MOSFET aquecendo, verificar se ele esta em curto entre drain/source/gate antes de remover;
- apos remover, conferir se o curto permaneceu na linha ou estava no componente.

Regra importante:

- nao afirmar pino ou tensao se o esquema nao trouxe essa informacao;
- para analise de componente aquecendo, usar trecho filtrado do esquema e analise avancada via API quando disponivel.

## Resistor Shunt / Sense em Notebook

No circuito de entrada de notebook, o resistor shunt costuma ser um resistor fisicamente maior e de baixissima resistencia, por exemplo 0.005 ohm, 0.01 ohm, 0.02 ohm ou 0.05 ohm.

Ele normalmente fica na linha principal entre a entrada protegida pelos MOSFETs de entrada e o restante do barramento B+/VIN, antes ou proximo do circuito de charger/comutacao da bateria.

Funcoes comuns:

- medir corrente de entrada;
- alimentar sinais de sense do charger, como ACN/ACP;
- separar diagnostico entre entrada bloqueada e linha principal em curto.

Regra de diagnostico:

- se tem 19 V no DC jack, mas nao chega no shunt, verificar bloqueio/curto antes ou nos MOSFETs de entrada;
- se a tensao chega no shunt, mas existe baixa resistencia para GND apos ele, tratar como curto na alimentacao principal;
- se nao ha curto no shunt/linha principal, medir continuidade dos MOSFETs de entrada e seguir para fontes 3V/5V always-on.

Exemplo conhecido:

- Compal LA-6901P: PR14 aparece como 0.02 ohm 2512 1% e deve ser tratado como resistor shunt/sense da linha principal de entrada.
