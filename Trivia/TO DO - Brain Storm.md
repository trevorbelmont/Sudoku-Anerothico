Aqui está o resumo estruturado de todas as ideias e caminhos de design que levantamos durante o trajeto:

---

### 1. Métricas de Contribuição e Disputa

* **Métrica de porcentagem por jogador:** Calcular quanto cada um preencheu da grade (ex: 60% Jogador A vs. 40% Jogador B) a partir dos registros de autoria no log do Firebase.
* **Modo de exibição:**
* *Opção A:* Exibir em tempo real durante a partida (barra de progresso dividida ou placar dinâmico).
* *Opção B:* Revelar apenas no modal de vitória final como elemento surpresa.
* *Opção C:* Caixa de seleção na criação da sala permitindo ao host escolher se exibe ao vivo ou apenas ao término.



### 2. Autoria e Trava Anti-Roubo de Células

* **Problema:** Impedir que um jogador apague a jogada correta do adversário e digite o mesmo número para inflar sua porcentagem.
* **Soluções levantadas:**
* *Opção A (Bloqueio estrito):* Se uma célula já estiver preenchida corretamente por outro jogador, a tentativa de apagamento ou sobreposição por terceiros é ignorada.
* *Opção B (Fixação atômica):* Casas confirmadas tornam-se somente leitura para ambos os clientes, funcionando como pistas estáticas até o fim da partida.



### 3. Identidade Visual das Células Preenchidas

* **Diferenciação gráfica:** Além do preenchimento padrão, aplicar a cor única de cada jogador ao número inserido por ele.
* **Abordagens de estilo:**
* Contorno (*stroke*) colorido ao redor do número.
* Cor do texto (*fill*) diretamente na tonalidade do autor da jogada.
* Tabuleiro funcionando como um "mapa de calor" visual indicando os quadrantes dominados por cada um.



### 4. Sistema de Avatares Procedurais

* **Superação das iniciais simples:** Substituir círculos com a primeira letra por desenhos vetoriais dinâmicos de alta definição, preservando a ausência de fotos/login formal.
* **Vitrine de seleção (Grade de 15 a 25 opções):**
* Tela/modal exibindo uma matriz de avatares gerados no momento.
* Botão de "Regenerar" que sorteia novas opções caso o jogador queira outras combinações.


* **Organização por linhas de arquétipos:**
* *Linha 1:* Animais geométricos (lobo, raposa, coruja, etc.).
* *Linha 2:* Brasões e insígnias heráldicas.
* *Linha 3:* Mandalas e prismas radiantes.
* *Linha 4:* Silhuetas ou máscaras humanas.


* **Estética inspirada no baralho *Memento Mori*:**
* Visual *low-poly*, facetado e poligonal, baseado em triângulos, espelhos quebrados e gradientes vibrantes.
* Parâmetros ajustáveis pelo software: nível de curvatura (arestas afiadas vs. chanfradas) e paletas cromáticas (Memento Mori, Neon, Tons Pastéis).



### 5. Mecânica de Sementes (*Seeds*) e Portabilidade

* **Determinismo matemático:** A mesma semente combinada ao mesmo estilo sempre renderiza o idêntico desenho em qualquer máquina, trafegando menos de 30 bytes no Firebase.
* **Campo de semente personalizada:** Espaço vazio na vitrine onde o jogador pode colar uma semente manual para resgatar seu avatar preferido em outros computadores.
* **Sementes legíveis por humanos:** Em vez de sequências aleatórias brutas, o sistema pode usar palavras combinadas fáceis de memorizar (ex: `lobo-prisma-12`, `raposa-aurora-7`), convertidas internamente via função de dispersão (*hash*).
* **Persistência dupla:** Salvamento automático da última escolha no `localStorage` do navegador + botão de "Copiar Semente" para backup manual.

### 6. Infraestrutura, Hospedagem e Compatibilidade

* **Local-first no GitHub Pages:** O `localStorage` continuará isolado e persistente por domínio no navegador dos jogadores, mantendo histórico e configurações salvos mesmo sem contas criadas.
* **Prontidão para deploy web:** A lógica de rede do Firebase com WebSockets e chamadas cliente já opera em conformidade com HTTPS, não necessitando de alterações estruturais para migrar do ambiente local para o GitHub Pages.