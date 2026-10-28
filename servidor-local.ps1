$ErrorActionPreference = 'Stop'
$script:root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$script:port = 8765
$script:version = 'v5.7'
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
    $normalized = $command.Trim().ToLowerInvariant()
    if ($normalized -in @('exit', 'quit', 'q', 'sair', 'encerrar', 'x')) {
        if (Confirm-Shutdown) { $script:running = $false }
        else { Write-Host '  O servidor continua ativo. A partida pode continuar.' -ForegroundColor Green }
        return
    }
    if ($normalized -in @('help', 'ajuda', 'url', 'urls', '?')) {
        Write-Help
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
for ($candidatePort = 8765; $candidatePort -le 8785; $candidatePort++) {
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
    Write-Host '  Não foi possível iniciar o servidor nas portas 8765 a 8785.' -ForegroundColor Red
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
    if ($script:port -ne 8765) { Write-Host "  A porta padrão 8765 estava ocupada; usando a porta $script:port." -ForegroundColor DarkYellow }
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
