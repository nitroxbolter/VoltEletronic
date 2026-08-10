# Defeitos Comuns

## Nao Liga

Sintoma: equipamento sem sinal de vida.

Possiveis causas:

- fusivel aberto;
- curto na alimentacao principal;
- fonte sem tensao de saida;
- EC/SIO ou controlador de energia com falha;
- botao power com defeito;
- circuito de power sem sinal logico.

Testes:

1. Medir fusivel em continuidade.
2. Medir tensao de entrada.
3. Medir saidas principais da fonte: 5 V, 12 V, 19 V ou conforme equipamento.
4. Verificar sinal de power no CI de controle.
5. Medir resistencia entre GND e VCC.

Observacao: curto abaixo de 5 ohms em uma linha principal costuma indicar componente em curto, mas linhas de baixa impedancia devem ser avaliadas pelo esquema.

## Sem Imagem

Sintoma: equipamento liga, mas tela fica apagada.

Possiveis causas:

- backlight ou inverter com defeito;
- driver de display com falha;
- cabo flat rompido ou mal encaixado;
- GPU/PCH com falha;
- regulador da tela sem tensao.

Testes:

1. Testar monitor externo.
2. Verificar tensao de backlight, geralmente 12 V a 24 V.
3. Verificar cabo flat e conector.
4. Medir tensoes do painel.
5. Confirmar se ha imagem fraca com lanterna.

## Reinicia Sozinho

Possiveis causas:

- capacitores com ESR elevado;
- superaquecimento;
- cooler parado;
- pasta termica seca;
- tensao instavel;
- ripple excessivo;
- problema em memoria RAM.

Testes:

1. Medir temperaturas durante uso.
2. Medir ripple com osciloscopio.
3. Testar memorias separadamente.
4. Medir ESR de capacitores principais.
5. Verificar fonte sob carga.

## Curto Na Alimentacao

Sintomas:

- fonte nao arma;
- fonte assimetrica limita corrente;
- fusivel queima;
- componente esquenta imediatamente.

Testes:

1. Medir resistencia GND-VCC sem ligar.
2. Separar setores do circuito se possivel.
3. Injetar tensao baixa com limite de corrente.
4. Procurar aquecimento em MOSFET, diodo, capacitor ceramico, capacitor eletrolitico e CI.

Componentes suspeitos:

- MOSFET de potencia;
- diodo retificador;
- capacitor em curto;
- CI alimentado pela linha afetada.

## Componente Quente Sem Causa Aparente

Possiveis causas:

- componente operando fora da especificacao;
- curto parcial na carga;
- fuga interna;
- tensao incorreta no pino;
- oscilacao indevida.

Testes:

1. Medir corrente do trecho.
2. Verificar tensao nos pinos.
3. Comparar com datasheet ou placa boa.
4. Remover carga quando possivel.
5. Substituir por componente equivalente para comparar temperatura.

## Problemas Com USB

Possiveis causas:

- fusivel SMD aberto na linha 5 V USB;
- diodo TVS/ESD em curto;
- conector danificado;
- CI controlador USB com falha;
- trilha rompida.

Testes:

1. Medir 5 V no VBUS do conector.
2. Testar fusivel SMD em continuidade.
3. Verificar diodo TVS nos dados e VBUS.
4. Inspecionar conector.
5. Testar continuidade das linhas.

## Problemas Em Fonte ATX

Pinagem importante do conector 24 pinos:

- pino 9: 5 V standby, presente sem ligar;
- pino 16: PS_ON, aterrar para ligar;
- pino 8: Power Good, deve subir quando a fonte esta OK.

Testes basicos:

1. Medir 5 V standby no pino 9.
2. Aterrar PS_ON para forcar partida.
3. Medir +3.3 V, +5 V, +12 V e -12 V.
4. Verificar se as saidas ficam dentro de aproximadamente 5% da nominal.
5. Medir ripple em carga.
