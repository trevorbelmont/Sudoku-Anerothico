# ==========================================================================
# Instalação em Lote — Extensões Consolidadas do Perfil Global Unificado
# Fonte: avaliação-F.md + configsSICAT (linters)
# Uso: copie e cole o conteúdo abaixo diretamente no PowerShell.
#     Cada linha é um comando independente — pode colar tudo de uma vez.
# Extensões de linguagem (Python, Java, Vue) ficam dormentes e só são
# ativadas na memória quando você abre um arquivo da respectiva extensão
# (.py, .java, .vue). Elas não pesam na inicialização de projetos simples.
# ==========================================================================

# 1. Core / Global — presente em qualquer perfil
code --install-extension PKief.material-icon-theme
code --install-extension eamodio.gitlens
code --install-extension github.vscode-github-actions
code --install-extension yzane.markdown-pdf
code --install-extension ms-azuretools.vscode-docker

# 2. Web / SICAT (PBH)
code --install-extension vscjava.vscode-java-pack
code --install-extension esbenp.prettier-vscode
code --install-extension Vue.volar
code --install-extension hollowtree.vue-snippets
code --install-extension bruno-api-client.bruno
code --install-extension gitlab.gitlab-workflow

# 3. Linters & Qualidade (Frontend)
code --install-extension dbaeumer.vscode-eslint
code --install-extension EditorConfig.EditorConfig
code --install-extension oxc.oxc-vscode
code --install-extension vitest.explorer

# 4. Python / Scripts (AutoTri / Pessoal)
code --install-extension ms-python.python
code --install-extension ms-python.vscode-pylance
code --install-extension ms-python.black-formatter
code --install-extension ms-python.debugpy
code --install-extension ms-toolsai.jupyter
