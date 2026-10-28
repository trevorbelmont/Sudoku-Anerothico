$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$port = 8765
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)

function Get-ContentType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8'; break }
        '.css'  { 'text/css; charset=utf-8'; break }
        '.js'   { 'text/javascript; charset=utf-8'; break }
        '.json' { 'application/json; charset=utf-8'; break }
        '.svg'  { 'image/svg+xml'; break }
        '.png'  { 'image/png'; break }
        '.jpg'  { 'image/jpeg'; break }
        '.jpeg' { 'image/jpeg'; break }
        '.ico'  { 'image/x-icon'; break }
        '.woff' { 'font/woff'; break }
        '.woff2'{ 'font/woff2'; break }
        default { 'application/octet-stream' }
    }
}

try {
    $listener.Start()
    $url = "http://127.0.0.1:$port/"
    Write-Host ''
    Write-Host 'Sudoku Anerothico PRO' -ForegroundColor Cyan
    Write-Host "Abrindo: $url" -ForegroundColor Green
    Write-Host 'Mantenha esta janela aberta enquanto estiver jogando.' -ForegroundColor Yellow
    Write-Host 'Para encerrar o servidor, feche esta janela ou pressione Ctrl+C.'
    Start-Process $url

    while ($listener.Server.IsBound) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 5000
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { $client.Close(); continue }
            $parts = $requestLine.Split(' ')
            $method = $parts[0]
            $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
            while (($header = $reader.ReadLine()) -ne $null -and $header -ne '') { }

            $status = '200 OK'
            $body = [byte[]]@()
            $contentType = 'text/plain; charset=utf-8'
            if ($method -ne 'GET' -and $method -ne 'HEAD') {
                $status = '405 Method Not Allowed'
                $body = [System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')
            } else {
                $relative = [System.Uri]::UnescapeDataString(($rawPath -split '\?', 2)[0]).TrimStart('/')
                if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
                $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
                if (-not $candidate.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $status = '403 Forbidden'
                    $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
                } elseif (-not [System.IO.File]::Exists($candidate)) {
                    $status = '404 Not Found'
                    $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
                } else {
                    $contentType = Get-ContentType $candidate
                    $body = [System.IO.File]::ReadAllBytes($candidate)
                }
            }

            $headerText = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -ne 'HEAD' -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch {
            # Fecha conexoes incompletas sem interromper o servidor.
        } finally {
            if ($reader) { $reader.Dispose(); $reader = $null }
            $client.Close()
        }
    }
} finally {
    if ($listener) { $listener.Stop() }
}
