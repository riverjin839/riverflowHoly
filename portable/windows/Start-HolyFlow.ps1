param(
  [string]$Root = $PSScriptRoot,
  [int]$Port = 4173
)

$ErrorActionPreference = "Stop"

$rootPath = (Resolve-Path -Path $Root).Path.TrimEnd('\')
$listenUrl = "http://localhost:$Port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($listenUrl)
$listener.Start()

$contentTypes = @{
  ".css"          = "text/css; charset=utf-8"
  ".html"         = "text/html; charset=utf-8"
  ".ico"          = "image/x-icon"
  ".js"           = "application/javascript; charset=utf-8"
  ".json"         = "application/json; charset=utf-8"
  ".manifest"     = "application/manifest+json; charset=utf-8"
  ".png"          = "image/png"
  ".svg"          = "image/svg+xml"
  ".txt"          = "text/plain; charset=utf-8"
  ".webmanifest"  = "application/manifest+json; charset=utf-8"
}

function Write-ResponseBytes {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [byte[]]$Bytes
  )

  $Response.ContentLength64 = $Bytes.LongLength
  $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
}

function Send-FileResponse {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [string]$FilePath
  )

  $extension = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
  $Response.ContentType = $contentTypes[$extension]
  if (-not $Response.ContentType) {
    $Response.ContentType = "application/octet-stream"
  }

  $bytes = [System.IO.File]::ReadAllBytes($FilePath)
  Write-ResponseBytes -Response $Response -Bytes $bytes
}

Write-Host "Holy Flow portable server is running at $listenUrl"
Write-Host "Press Ctrl+C to stop."
Start-Process $listenUrl | Out-Null

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response

    try {
      $relativePath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
      }

      $targetPath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))
      if (-not $targetPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $response.StatusCode = 403
        $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
        Write-ResponseBytes -Response $response -Bytes $body
        continue
      }

      if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
        if (-not [System.IO.Path]::GetExtension($relativePath)) {
          $targetPath = Join-Path $rootPath "index.html"
        }
      }

      if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
        $response.StatusCode = 200
        Send-FileResponse -Response $response -FilePath $targetPath
      } else {
        $response.StatusCode = 404
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
        Write-ResponseBytes -Response $response -Bytes $body
      }
    } catch {
      $response.StatusCode = 500
      $body = [System.Text.Encoding]::UTF8.GetBytes("Internal Server Error")
      Write-ResponseBytes -Response $response -Bytes $body
    } finally {
      $response.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
