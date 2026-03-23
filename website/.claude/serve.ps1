# Minimal static file server for the bimaxim portfolio site
param([int]$Port = 8080)
Add-Type -AssemblyName System.Web

$root = Split-Path -Parent $PSScriptRoot
$prefix = "http://localhost:$Port/"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css'
  '.js'   = 'application/javascript'
  '.json' = 'application/json'
  '.svg'  = 'image/svg+xml'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png'  = 'image/png'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.mp4'  = 'video/mp4'
  '.woff2'= 'font/woff2'
  '.woff' = 'font/woff'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host ""
Write-Host "  bimaxim dev server" -ForegroundColor DarkYellow
Write-Host "  Listening on $prefix" -ForegroundColor Cyan
Write-Host "  Root: $root" -ForegroundColor DarkGray
Write-Host "  Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

while ($listener.IsListening) {
  try {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response

    # Decode UTF-8 percent-encoding, then normalize to NFD so filenames
    # created on macOS (NFD) match what Windows Test-Path/ReadAllBytes expect.
    $rawPath  = $req.RawUrl.Split('?')[0]
    $urlPath  = [System.Web.HttpUtility]::UrlDecode($rawPath, [System.Text.Encoding]::UTF8)
    $urlPath  = $urlPath.Normalize([System.Text.NormalizationForm]::FormD)
    if ($urlPath -eq '/') { $urlPath = '/index.html' }

    $filePath = Join-Path $root ($urlPath.TrimStart('/').Replace('/', '\'))

    if (Test-Path $filePath -PathType Leaf) {
      $ext     = [System.IO.Path]::GetExtension($filePath).ToLower()
      $ct      = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes   = [System.IO.File]::ReadAllBytes($filePath)
      $resp.ContentType   = $ct
      $resp.ContentLength64 = $bytes.Length
      $resp.StatusCode    = 200
      $resp.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "  200  $urlPath" -ForegroundColor DarkGray
    } else {
      $body  = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
      $resp.ContentType   = 'text/plain'
      $resp.ContentLength64 = $body.Length
      $resp.StatusCode    = 404
      $resp.OutputStream.Write($body, 0, $body.Length)
      Write-Host "  404  $urlPath" -ForegroundColor DarkRed
    }

    $resp.OutputStream.Close()
  } catch {
    if ($listener.IsListening) { Write-Host "  ERR: $_" -ForegroundColor Red }
  }
}
