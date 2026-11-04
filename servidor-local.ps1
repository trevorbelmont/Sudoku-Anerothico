$ErrorActionPreference = 'Stop'
$script:root = [System.IO.Path]::GetFullPath($PSScriptRoot)
# Valores padrão; sobrescritos pela leitura de js/core/config.js (Single Source of Truth).
$script:port = 8765
$script:portMax = 8785
$script:version = 'v6.8'
$configPath = [System.IO.Path]::Combine($script:root, 'js', 'core', 'config.js')
if ([System.IO.File]::Exists($configPath)) {
    $configContent = [System.IO.File]::ReadAllText($configPath)
    if ($configContent -match "APP_VERSION:\s*'([^']+)'") { $script:version = $matches[1] }
    if ($configContent -match "SERVER_PORT:\s*(\d+)") { $script:port = [int]$matches[1] }
    if ($configContent -match "SERVER_PORT_MAX:\s*(\d+)") { $script:portMax = [int]$matches[1] }
}
$preferredPort = $script:port
$script:listener = $null
$script:running = $true
$script:commandBuffer = [System.Text.StringBuilder]::new()

function Write-Rule {
    Write-Host '  ─────────────────────────────────────────────────────────────────────' -ForegroundColor DarkCyan
}

function Write-Banner {
    Clear-Host
    Write-Host ''
    Write-Host ' ███████╗██╗   ██╗██████╗  ██████╗ ██╗  ██╗██╗   ██╗' -ForegroundColor Cyan
    Write-Host ' ██╔════╝██║   ██║██╔══██╗██╔═══██╗██║ ██╔╝██║   ██║' -ForegroundColor Cyan
    Write-Host ' ███████╗██║   ██║██║  ██║██║   ██║█████╔╝ ██║   ██║' -ForegroundColor Blue
    Write-Host ' ╚════██║██║   ██║██║  ██║██║   ██║██╔═██╗ ██║   ██║' -ForegroundColor Blue
    Write-Host ' ███████║╚██████╔╝██████╔╝╚██████╔╝██║  ██╗╚██████╔╝' -ForegroundColor Magenta
    Write-Host ' ╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ' -ForegroundColor Magenta
    Write-Host ''
    Write-Host '    █████╗ ███╗   ██╗███████╗██████╗  ██████╗ ████████╗██╗  ██╗██╗ ██████╗ ██████╗' -ForegroundColor Yellow
    Write-Host '   ██╔══██╗████╗  ██║██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝██║  ██║██║██╔════╝██╔═══██╗' -ForegroundColor Yellow
    Write-Host '   ███████║██╔██╗ ██║█████╗  ██████╔╝██║   ██║   ██║   ███████║██║██║     ██║   ██║' -ForegroundColor DarkYellow
    Write-Host '   ██╔══██║██║╚██╗██║██╔══╝  ██╔══██╗██║   ██║   ██║   ██╔══██║██║██║     ██║   ██║' -ForegroundColor DarkYellow
    Write-Host '   ██║  ██║██║ ╚████║███████╗██║  ██║╚██████╔╝   ██║   ██║  ██║██║╚██████╗╚██████╔╝' -ForegroundColor Red
    Write-Host '   ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═════╝ ' -ForegroundColor Red
    Write-Host ''
    Write-Host '   PRÓ EDITION' -ForegroundColor White
    Write-Host "   $script:version  |  SERVIDOR LOCAL" -ForegroundColor Green
    Write-Rule
    Write-Host '   GitHub:   https://github.com/trevorbelmont' -ForegroundColor Gray
    Write-Host '   LinkedIn: https://www.linkedin.com/in/marcos-dias-4b545127b' -ForegroundColor Gray
    Write-Host ''
}
function Get-ContentType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.css'  { return 'text/css; charset=utf-8' }
        '.js'   { return 'text/javascript; charset=utf-8' }
        '.mjs'  { return 'text/javascript; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.map'  { return 'application/json; charset=utf-8' }
        '.txt'  { return 'text/plain; charset=utf-8' }
        '.xml'  { return 'application/xml; charset=utf-8' }
        '.svg'  { return 'image/svg+xml' }
        '.png'  { return 'image/png' }
        '.jpg'  { return 'image/jpeg' }
        '.jpeg' { return 'image/jpeg' }
        '.gif'  { return 'image/gif' }
        '.webp' { return 'image/webp' }
        '.avif' { return 'image/avif' }
        '.ico'  { return 'image/x-icon' }
        '.woff' { return 'font/woff' }
        '.woff2'{ return 'font/woff2' }
        '.wasm' { return 'application/wasm' }
        default { return 'application/octet-stream' }
    }
}

function Write-Help {
    Write-Host ''
    Write-Host '  ENDEREÇOS DO JOGO' -ForegroundColor Cyan
    Write-Host "  http://127.0.0.1:$script:port/" -ForegroundColor Green
    Write-Host "  http://localhost:$script:port/" -ForegroundColor Green
    Write-Host '  Copie um dos endereços e cole-o no navegador desejado.' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  COMANDOS DE DESENVOLVIMENTO' -ForegroundColor Cyan
    Write-Host '  install             — instala as dependências de teste (npm install) na pasta tests/' -ForegroundColor Gray
    Write-Host '  test                — roda todos os testes (npm run test:all) em nova janela' -ForegroundColor Gray
    Write-Host '  test unit           — roda apenas os testes unitários (npm run test:unit)' -ForegroundColor Gray
    Write-Host '  test integration    — roda apenas os testes de integração (npm run test:integration)' -ForegroundColor Gray
    Write-Host '  test syntax         — roda verificação de sintaxe nos arquivos .JS (node --check) na mesma janela' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  REDIRECIONAMENTO DE SAIDA (>arquivo)' -ForegroundColor Cyan
    Write-Host '  Adicione >caminho/arquivo apos qualquer comando de teste para' -ForegroundColor Gray
    Write-Host '  gravar os resultados no arquivo (sobrescreve). Exemplos:' -ForegroundColor Gray
    Write-Host '  test >log-testes.tx          — grava tudo em log-testes.tx na raiz' -ForegroundColor DarkGray
    Write-Host '  test unit >misc/log-unit.tx  — grava testes unitarios em misc/log-unit.tx' -ForegroundColor DarkGray
    Write-Host '  test syntax >sintaxe.txt     — grava a verificacao de sintaxe em sintaxe.txt' -ForegroundColor DarkGray
    Write-Host '  Diretorios pai sao criados automaticamente quando necessario.' -ForegroundColor DarkGray

    Write-Host '  clean  /  limpar    — apaga node_modules e caches dos testes (pede confirmação)' -ForegroundColor Gray
    Write-Host '  reset storage       — limpa o localStorage do jogo via rota fantasma (pede confirmação)' -ForegroundColor Gray
    Write-Host '  Requer Node.js LTS (inclui npm e npx); install prepara o Jest em tests/.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  ENCERRAMENTO' -ForegroundColor Cyan
    Write-Host '  Pressione X para solicitar o encerramento.' -ForegroundColor Gray
    Write-Host '  Ou digite exit e pressione Enter. Depois confirme com Y/yes ou N/no.' -ForegroundColor Gray
    Write-Host '  Ctrl+C também solicita o encerramento.' -ForegroundColor Gray
    Write-Host ''
}

function Confirm-Shutdown {
    while ($true) {
        Write-Host ''
        Write-Host '  Deseja encerrar o servidor local do Sudoku?' -ForegroundColor Yellow
        Write-Host '  [Y] Sim, desligar   [N] Não, continuar jogando' -ForegroundColor Gray
        $answer = (Read-Host '  Responda Y/N ou yes/no').Trim().ToLowerInvariant()
        if ($answer -in @('y', 'yes', 's', 'sim')) { return $true }
        if ($answer -in @('n', 'no', 'nao', 'não')) { return $false }
        Write-Host '  Resposta não reconhecida. Digite Y/yes para sair ou N/no para continuar.' -ForegroundColor Red
    }
}

function Confirm-YesNo {
    param([string]$Prompt)
    while ($true) {
        Write-Host ''
        Write-Host "  $Prompt" -ForegroundColor Yellow
        Write-Host '  [Y] Sim   [N] Não' -ForegroundColor Gray
        $answer = (Read-Host '  Responda Y/N ou yes/no').Trim().ToLowerInvariant()
        if ($answer -in @('y', 'yes', 's', 'sim')) { return $true }
        if ($answer -in @('n', 'no', 'nao', 'não')) { return $false }
        Write-Host '  Resposta não reconhecida. Digite Y/yes para confirmar ou N/no para cancelar.' -ForegroundColor Red
    }
}

function Get-NpmCommand {
    # No Windows, npm.cmd é o shim apropriado para processos iniciados pelo cmd.exe.
    # Evita depender de npm.ps1, que é específico do PowerShell.
    return Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
}

function Start-TestCommandWindow {
    param(
        [Parameter(Mandatory = $true)][string]$TestsRoot,
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [string]$LogFile = $null
    )

    $commandProcessor = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($commandProcessor)) { $commandProcessor = 'cmd.exe' }

    if ($LogFile) {
        # ── Modo redirecionamento: cria um .bat temporário que captura a saída ──
        # O .bat deleta a si mesmo no final (del "%~f0") para não deixar lixo.
        $batContent = @"
@echo off
chcp 65001 >nul 2>&1
cd /d "$TestsRoot"
echo Executando: $CommandLine
echo.
echo Saida sendo gravada em: $LogFile
echo.
$CommandLine > "$LogFile" 2>&1
echo.
echo ========================================
echo Resultados salvos em: $LogFile
echo ========================================
del "%~f0"
"@
        $batFile = [System.IO.Path]::Combine($env:TEMP, "sudoku_test_redirect_$([System.Guid]::NewGuid().ToString('N').Substring(0,8)).bat")
        [System.IO.File]::WriteAllText($batFile, $batContent, [System.Text.Encoding]::Default)

        # /k mantem a janela aberta para o usuario ler a mensagem de conclusao.
        Start-Process -FilePath $commandProcessor `
            -ArgumentList @('/d', '/k', "`"$batFile`"") `
            -WorkingDirectory $TestsRoot `
            -ErrorAction Stop | Out-Null
    } else {
        # /k mantém a janela aberta depois do comando para que o usuário possa ler
        # o resultado e eventuais mensagens de erro do npm/Jest.
        Start-Process -FilePath $commandProcessor `
            -ArgumentList @('/d', '/k', $CommandLine) `
            -WorkingDirectory $TestsRoot `
            -ErrorAction Stop | Out-Null
    }
}

function Install-NodeRuntime {
    $wingetCommand = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
    if (-not $wingetCommand) {
        Write-Host '  O winget não foi encontrado. Instale o Node.js LTS em https://nodejs.org/ e reabra o servidor.' -ForegroundColor Yellow
        return
    }

    Write-Host '  Iniciando instalação do Node.js via winget...' -ForegroundColor Cyan
    Write-Host '  O npm e o npx são instalados junto com o Node.js.' -ForegroundColor Gray
    try {
        $process = Start-Process -FilePath $wingetCommand.Source `
            -ArgumentList @('install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--accept-package-agreements', '--accept-source-agreements') `
            -Wait -PassThru -ErrorAction Stop

        if ($process.ExitCode -ne 0) {
            Write-Host "  A instalação do Node.js terminou com código $($process.ExitCode)." -ForegroundColor Red
            Write-Host '  Confira a mensagem do winget ou instale manualmente em https://nodejs.org/.' -ForegroundColor Gray
            return
        }

        Write-Host '  Instalação do Node.js concluída.' -ForegroundColor Green
        Write-Host '  Feche este servidor (digite X) e abra-o novamente para atualizar o PATH.' -ForegroundColor Yellow
    } catch {
        Write-Host "  Não foi possível instalar o Node.js: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host '  Baixe o instalador em: https://nodejs.org/' -ForegroundColor Gray
    }
}

function Invoke-TestInstall {
    $testsRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($script:root, 'tests'))
    if (-not [System.IO.Directory]::Exists($testsRoot)) {
        Write-Host "  Pasta de testes não encontrada: $testsRoot" -ForegroundColor Red
        return
    }

    if (-not (Get-NpmCommand)) {
        Write-Host '  npm (incluído no Node.js) não foi encontrado no PATH.' -ForegroundColor Yellow
        if (Confirm-YesNo 'Deseja instalar o Node.js automaticamente agora (via winget)?') {
            Install-NodeRuntime
        } else {
            Write-Host '  Comando cancelado. Instale o Node.js LTS em: https://nodejs.org/' -ForegroundColor Gray
        }
        return
    }

    Write-Host "  Executando 'npm install' na pasta tests/ em uma nova janela..." -ForegroundColor Green
    try {
        Start-TestCommandWindow -TestsRoot $testsRoot -CommandLine 'npm install --no-audit --no-fund --loglevel=error'
        Write-Host '  Janela de instalação aberta. Acompanhe o npm install nessa janela.' -ForegroundColor Gray
    } catch {
        Write-Host "  Não foi possível abrir a janela de instalação: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Invoke-TestRun {
    param([string]$ScriptName, [string]$LogFile = $null)

    # Garantimos que a sintaxe dos .JS está perfeita antes de rodar o Jest.
    $syntaxOk = Invoke-SyntaxCheck
    if (-not $syntaxOk) {
        Write-Host "  Abortando a suíte de testes do Jest devido a erros de sintaxe." -ForegroundColor Yellow
        return
    }

    # Se a sintaxe tá boa, rodamos os testes reais.
    $testsRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($script:root, 'tests'))
    if (-not [System.IO.Directory]::Exists($testsRoot)) {
        Write-Host "  Pasta de testes não encontrada: $testsRoot" -ForegroundColor Red
        return
    }

    # Aceita somente os scripts definidos em tests/package.json.
    $allowedScripts = @('test:all', 'test:unit', 'test:integration')
    if ($ScriptName -notin $allowedScripts) {
        Write-Host "  Script de teste não permitido: $ScriptName" -ForegroundColor Red
        return
    }

    if (-not (Get-NpmCommand)) {
        Write-Host '  npm não foi encontrado no PATH. Instale o Node.js e reabra o servidor.' -ForegroundColor Red
        Write-Host '  Rode aqui o comando install ou baixe o Node.js LTS em: https://nodejs.org/' -ForegroundColor Gray
        return
    }

    $jestEntryPoint = [System.IO.Path]::Combine($testsRoot, 'node_modules', 'jest', 'bin', 'jest.js')
    if (-not [System.IO.File]::Exists($jestEntryPoint)) {
        Write-Host '  As dependências de teste ainda não estão instaladas.' -ForegroundColor Yellow
        Write-Host "  Digite 'install' e aguarde o npm install terminar antes de executar '$ScriptName'." -ForegroundColor Gray
        return
    }

    if ($LogFile) {
        Write-Host "  Iniciando 'npm run $ScriptName' com saída redirecionada para:" -ForegroundColor Green
        Write-Host "  $LogFile" -ForegroundColor DarkGray
    } else {
        Write-Host "  Iniciando 'npm run $ScriptName' em uma nova janela..." -ForegroundColor Green
    }
    try {
        Start-TestCommandWindow -TestsRoot $testsRoot -CommandLine "npm run $ScriptName" -LogFile $LogFile
        if ($LogFile) {
            Write-Host '  Janela de testes aberta. O resultado será gravado no arquivo especificado.' -ForegroundColor Gray
        } else {
            Write-Host '  Janela de testes aberta. O resultado ficará visível nessa janela.' -ForegroundColor Gray
        }
    } catch {
        Write-Host "  Não foi possível abrir a janela de testes: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Invoke-TestClean {
    $testsRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($script:root, 'tests'))
    $targets = @(
        [System.IO.Path]::Combine($testsRoot, 'node_modules'),
        [System.IO.Path]::Combine($testsRoot, 'coverage'),
        [System.IO.Path]::Combine($testsRoot, '.nyc_output')
    )
    foreach ($target in $targets) {
        if ([System.IO.Directory]::Exists($target)) {
            try {
                Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
                Write-Host "  Removido: $target" -ForegroundColor Green
            } catch {
                Write-Host "  Falha ao remover $target : $($_.Exception.Message)" -ForegroundColor Red
            }
        } else {
            Write-Host "  Ignorado (não existe): $target" -ForegroundColor DarkGray
        }
    }
    Write-Host '  Limpeza concluída.' -ForegroundColor Green
}

function Invoke-SyntaxCheck {
    param([string]$LogFile = $null)

    # -Recurse: após a refatoração da árvore /js em subdiretórios (core, ui, network, services),
    # é obrigatório buscar recursivamente para não pular nenhum arquivo.
    $jsFiles = Get-ChildItem -Path (Join-Path $script:root 'js') -Filter *.js -Recurse
    $errorCount = 0

    if ($LogFile) {
        # ── Modo redirecionamento: coleta resultados e grava no arquivo ──
        $output = [System.Collections.ArrayList]::new()
        [void]$output.Add('========================================')
        [void]$output.Add('  VERIFICACAO DE SINTAXE (Node.js)')
        [void]$output.Add("  Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
        [void]$output.Add("  Arquivos encontrados: $($jsFiles.Count)")
        [void]$output.Add('========================================')
        [void]$output.Add('')

        foreach ($file in $jsFiles) {
            $result = & node --check $file.FullName 2>&1
            if ($LASTEXITCODE -ne 0) {
                [void]$output.Add("[ERRO] $($file.FullName)")
                [void]$output.Add($result)
                [void]$output.Add('')
                $errorCount++
            } else {
                [void]$output.Add("[OK] $($file.FullName.Replace($script:root + '\', ''))")
            }
        }

        [void]$output.Add('')
        if ($errorCount -eq 0) {
            [void]$output.Add('Todos os arquivos passaram na verificacao de sintaxe!')
        } else {
            [void]$output.Add("Total de arquivos com erro: $errorCount")
        }

        [System.IO.File]::WriteAllText($LogFile, ($output -join "`r`n") + "`r`n", [System.Text.Encoding]::UTF8)

        if ($errorCount -eq 0) {
            Write-Host "  Verificacao de sintaxe concluida. Resultados em: $LogFile" -ForegroundColor Green
        } else {
            Write-Host "  Verificacao de sintaxe encontrou $errorCount erro(s). Resultados em: $LogFile" -ForegroundColor Red
        }
        return ($errorCount -eq 0)
    }

    # ── Modo normal: saida diretamente no console ──
    Write-Host ''
    Write-Host '  VERIFICACAO DE SINTAXE (Node.js)' -ForegroundColor Cyan
    Write-Host "  Lendo todos os arquivos em js/ (recursivo)..." -ForegroundColor Gray

    foreach ($file in $jsFiles) {
        # O operador '&' roda o node nativamente, jogando o erro real na tela do PowerShell
        & node --check $file.FullName

        # O $LASTEXITCODE captura se o comando anterior falhou
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERRO] A sintaxe quebrou em: $($file.Name)`n" -ForegroundColor Red
            $errorCount++
        }
    }

    if ($errorCount -eq 0) {
        Write-Host '  Todos os arquivos passaram na verificacao de sintaxe! OK' -ForegroundColor Green
        return $true
    } else {
        Write-Host "  Total de arquivos quebrados: $errorCount. Corrija-os antes de prosseguir." -ForegroundColor Red
        return $false
    }
}

function Send-HttpResponse($client, [string]$status, [string]$contentType, [byte[]]$body, [bool]$isHead) {
    $stream = $client.GetStream()
    $headerText = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if (-not $isHead -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}

function Handle-HttpClient($client) {
    $reader = $null
    try {
        $stream = $client.GetStream()
        $stream.ReadTimeout = 2500
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
        $requestLine = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($requestLine)) { return }
        $parts = $requestLine.Split(' ')
        $method = $parts[0]
        $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
        while (($header = $reader.ReadLine()) -ne $null -and $header -ne '') { }

        $isHead = $method -eq 'HEAD'
        if ($method -ne 'GET' -and -not $isHead) {
            $body = [System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')
            Send-HttpResponse $client '405 Method Not Allowed' 'text/plain; charset=utf-8' $body $false
            return
        }

        $relative = [System.Uri]::UnescapeDataString(($rawPath -split '\?', 2)[0]).TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }

        # Rota fantasma de desenvolvimento: limpa o localStorage do navegador.
        # Não corresponde a nenhum arquivo do projeto; devolve uma página minúscula.
        if ($relative -ieq 'dev-clean-storage') {
            $cleanHtml = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Limpeza de Armazenamento</title></head><body><script>localStorage.clear(); alert("Armazenamento Local Limpo com Sucesso!"); window.location.href="/";</script></body></html>'
            $cleanBody = [System.Text.Encoding]::UTF8.GetBytes($cleanHtml)
            Send-HttpResponse $client '200 OK' 'text/html; charset=utf-8' $cleanBody $isHead
            return
        }

        $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($script:root, $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
        $rootPrefix = $script:root
        if (-not $rootPrefix.EndsWith([string][System.IO.Path]::DirectorySeparatorChar)) { $rootPrefix += [System.IO.Path]::DirectorySeparatorChar }

        if (-not ($candidate.Equals($script:root, [System.StringComparison]::OrdinalIgnoreCase) -or $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
            $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
            Send-HttpResponse $client '403 Forbidden' 'text/plain; charset=utf-8' $body $isHead
            return
        }
        if (-not [System.IO.File]::Exists($candidate)) {
            $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
            Send-HttpResponse $client '404 Not Found' 'text/plain; charset=utf-8' $body $isHead
            return
        }

        $contentType = Get-ContentType $candidate
        $body = [System.IO.File]::ReadAllBytes($candidate)
        Send-HttpResponse $client '200 OK' $contentType $body $isHead
    } catch {
        # Conexões incompletas ou fechadas pelo navegador não derrubam o servidor.
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($client) { $client.Close() }
    }
}

function Process-ConsoleCommand([string]$command) {
    # ── Detectar redirecionamento de saida (>arquivo) para comandos de teste ──
    # Sintaxe: "test >arquivo.tx" ou "test unit >misc/log.tx"
    # O caminho do arquivo e resolvido relativo a raiz do projeto.
    # Diretorios pai sao criados automaticamente se necessario.
    $logFile = $null
    $baseCommand = $command.Trim()
    if ($command -match '^(.+?)\s*>\s*(\S.+)$') {
        $candidateBase = $matches[1].Trim()
        $candidateNorm = $candidateBase.ToLowerInvariant()
        # O redirecionamento se aplica apenas a comandos de teste
        if ($candidateNorm.StartsWith('test') -or $candidateNorm -eq 'syntax') {
            $baseCommand = $candidateBase
            $logFilePath = $matches[2].Trim()
            $logFile = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($script:root, $logFilePath))
            # Criar diretorio pai se necessario
            $parentDir = [System.IO.Path]::GetDirectoryName($logFile)
            if ($parentDir -and -not [System.IO.Directory]::Exists($parentDir)) {
                try {
                    [System.IO.Directory]::CreateDirectory($parentDir) | Out-Null
                    Write-Host "  Diretorio criado: $parentDir" -ForegroundColor DarkGray
                } catch {
                    Write-Host "  Nao foi possivel criar o diretorio: $parentDir" -ForegroundColor Red
                    Write-Host "  Erro: $($_.Exception.Message)" -ForegroundColor DarkRed
                    return
                }
            }
        }
    }

    $normalized = $baseCommand.ToLowerInvariant()
    if ($normalized -in @('exit', 'quit', 'q', 'sair', 'encerrar', 'x')) {
        if (Confirm-Shutdown) { $script:running = $false }
        else { Write-Host '  O servidor continua ativo. A partida pode continuar.' -ForegroundColor Green }
        return
    }
    if ($normalized -in @('help', 'ajuda', 'url', 'urls', '?')) {
        Write-Help
        return
    }
    if ($normalized -in @('install', 'npm install', 'instalar')) {
        Invoke-TestInstall
        return
    }
    if ($normalized -in @('test', 'test:all', 'test all')) {
        Invoke-TestRun 'test:all' -LogFile $logFile
        return
    }
    if ($normalized -in @('test unit', 'test:unit', 'testunit')) {
        Invoke-TestRun 'test:unit' -LogFile $logFile
        return
    }
    if ($normalized -in @('test integration', 'test:integration', 'testintegration')) {
        Invoke-TestRun 'test:integration' -LogFile $logFile
        return
    }
    if ($normalized -in @('clean', 'limpar')) {
        Write-Host ''
        Write-Host '  LIMPEZA DO AMBIENTE DE TESTES' -ForegroundColor Cyan
        Write-Host '  Serão removidos: tests/node_modules, tests/coverage e tests/.nyc_output.' -ForegroundColor Gray
        Write-Host '  Os testes precisarão reinstalar as dependências antes de rodar novamente.' -ForegroundColor Gray
        if (Confirm-YesNo 'Deseja apagar a pasta node_modules e os caches dos testes?') {
            Invoke-TestClean
        } else {
            Write-Host '  Limpeza cancelada. Nada foi removido.' -ForegroundColor Green
        }
        return
    }
    if ($normalized -eq 'reset storage') {
        Write-Host ''
        Write-Host '  RESET DE ARMAZENAMENTO LOCAL (localStorage)' -ForegroundColor Cyan
        Write-Host '  Será aberto o navegador em uma rota especial que limpa o localStorage do jogo.' -ForegroundColor Gray
        Write-Host '  Isso apaga partidas salvas, configurações e estados locais neste navegador.' -ForegroundColor Gray
        if (Confirm-YesNo 'Deseja abrir o navegador e limpar o Armazenamento Local?') {
            $cleanUrl = "http://localhost:$script:port/dev-clean-storage"
            Write-Host "  Abrindo: $cleanUrl" -ForegroundColor Green
            try { Start-Process $cleanUrl } catch { Write-Host "  Não foi possível abrir o navegador: $($_.Exception.Message)" -ForegroundColor Yellow }
        } else {
            Write-Host '  Reset cancelado. O navegador não foi aberto.' -ForegroundColor Green
        }
        return
    }

    if ($normalized -in @('test syntax', 'test:syntax', 'syntax')) {
        [void](Invoke-SyntaxCheck -LogFile $logFile)
        return
    }

    if ($normalized.Length -gt 0) {
        Write-Host "  Comando não reconhecido: '$command'. Digite help para ver os endereços e comandos." -ForegroundColor DarkYellow
    }
}

$originalTreatControlC = [Console]::TreatControlCAsInput

# A porta 8765 é a preferida. Se uma instância antiga ainda estiver ativa,
# tenta portas próximas para que a nova versão possa iniciar sem conflito.
$startupError = ''
for ($candidatePort = $preferredPort; $candidatePort -le $script:portMax; $candidatePort++) {
    $candidateListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidatePort)
    try {
        $candidateListener.Start()
        $script:listener = $candidateListener
        $script:port = $candidatePort
        break
    } catch {
        $startupError = $_.Exception.Message
        try { $candidateListener.Stop() } catch { }
    }
}

if (-not $script:listener) {
    Write-Banner
    Write-Host "  Não foi possível iniciar o servidor nas portas $preferredPort a $($script:portMax)." -ForegroundColor Red
    Write-Host '  Feche aplicações que possam estar usando essas portas e tente novamente.' -ForegroundColor Yellow
    Write-Host "  Detalhe: $startupError" -ForegroundColor DarkGray
    Write-Host ''
    [void](Read-Host '  Pressione Enter para fechar')
    return
}

[Console]::TreatControlCAsInput = $true
try {
    Write-Banner
    $url = "http://127.0.0.1:$script:port/"
    Write-Host '  STATUS: ATIVO' -ForegroundColor Green
    if ($script:port -ne $preferredPort) { Write-Host "  A porta padrão $preferredPort estava ocupada; usando a porta $script:port." -ForegroundColor DarkYellow }
    Write-Host "  Jogo:   $url" -ForegroundColor Green
    Write-Host "  Alternativa: http://localhost:$script:port/" -ForegroundColor Green
    Write-Host ''
    Write-Host '  O navegador padrão será aberto agora.' -ForegroundColor Gray
    Write-Host '  Para usar outro navegador, copie e cole um dos endereços acima.' -ForegroundColor Gray
    Write-Host '  O servidor aceita conexões somente deste computador (127.0.0.1).' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Para desligar: pressione X; ou digite exit e pressione Enter.' -ForegroundColor Yellow
    Write-Host '  Confirme com Y/yes. Para continuar, responda N/no. Ctrl+C também funciona.' -ForegroundColor Yellow
    Write-Rule
    Write-Host '  Comando (help para ajuda): ' -NoNewline -ForegroundColor Cyan

    try { Start-Process $url } catch { Write-Host "`n  Não foi possível abrir o navegador automaticamente. Copie o endereço acima." -ForegroundColor Yellow }

    while ($script:running) {
        # A entrada do console é consultada sem bloquear o atendimento HTTP.
        try {
            while ([Console]::KeyAvailable -and $script:running) {
                $keyInfo = [Console]::ReadKey($true)
                if ($keyInfo.Key -eq [ConsoleKey]::C -and (($keyInfo.Modifiers -band [ConsoleModifiers]::Control) -ne 0)) {
                    if (Confirm-Shutdown) { $script:running = $false }
                    else { Write-Host '  O servidor continua ativo.' -ForegroundColor Green; Write-Host '  Comando (help para ajuda): ' -NoNewline -ForegroundColor Cyan }
                } elseif ($keyInfo.Key -eq [ConsoleKey]::Enter) {
                    $command = $script:commandBuffer.ToString()
                    [void]$script:commandBuffer.Clear()
                    Write-Host ''
                    Process-ConsoleCommand $command
                    if ($script:running) { Write-Host '  Comando (help para ajuda): ' -NoNewline -ForegroundColor Cyan }
                } elseif ($keyInfo.Key -eq [ConsoleKey]::Backspace) {
                    if ($script:commandBuffer.Length -gt 0) {
                        [void]$script:commandBuffer.Remove($script:commandBuffer.Length - 1, 1)
                        Write-Host "`b `b" -NoNewline
                    }
                } elseif ($keyInfo.Key -eq [ConsoleKey]::Escape) {
                    if (Confirm-Shutdown) { $script:running = $false }
                    else { Write-Host '  O servidor continua ativo.' -ForegroundColor Green; Write-Host '  Comando (help para ajuda): ' -NoNewline -ForegroundColor Cyan }
                } elseif ($keyInfo.Key -eq [ConsoleKey]::X -and $script:commandBuffer.Length -eq 0) {
                    if (Confirm-Shutdown) { $script:running = $false }
                    else { Write-Host '  O servidor continua ativo.' -ForegroundColor Green; Write-Host '  Comando (help para ajuda): ' -NoNewline -ForegroundColor Cyan }
                } elseif (-not [char]::IsControl($keyInfo.KeyChar)) {
                    [void]$script:commandBuffer.Append($keyInfo.KeyChar)
                    Write-Host $keyInfo.KeyChar -NoNewline
                }
            }
        } catch {
            # Se a entrada estiver indisponível, o servidor ainda segue ativo e atende o navegador.
        }

        if (-not $script:running) { break }
        if ($script:listener.Pending()) {
            $client = $script:listener.AcceptTcpClient()
            Handle-HttpClient $client
        } else {
            Start-Sleep -Milliseconds 25
        }
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    # Ctrl+C ou cancelamento do host: o bloco finally encerra o listener.
} catch {
    Write-Host ''
    Write-Host "  O servidor encontrou um erro: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $script:running = $false
    if ($script:listener) {
        try { $script:listener.Stop() } catch { }
    }
    try { [Console]::TreatControlCAsInput = $originalTreatControlC } catch { }
    Write-Host ''
    Write-Rule
    Write-Host '  SERVIDOR ENCERRADO' -ForegroundColor Yellow
    Write-Host '  A aplicação local deixou de atender novas conexões.' -ForegroundColor Gray
    Write-Host '  Você pode fechar esta janela com segurança.' -ForegroundColor Gray
    Write-Host ''
    try { [void](Read-Host '  Pressione Enter para fechar esta janela') } catch { }
}
