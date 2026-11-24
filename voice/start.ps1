$ErrorActionPreference = 'Stop'
$VoiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonW = Join-Path $VoiceDir '.venv\Scripts\pythonw.exe'
$Python = Join-Path $VoiceDir '.venv\Scripts\python.exe'
$Server = Join-Path $VoiceDir 'server.py'

if (-not (Test-Path $Python)) {
  Write-Error "No existe el entorno virtual en $VoiceDir\.venv. Ejecuta install.ps1 primero."
  exit 1
}

try {
  $res = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47811/health' -TimeoutSec 2
  if ($res.StatusCode -eq 200) {
    Write-Output 'El servidor de voz neuronal ya está activo en http://127.0.0.1:47811.'
    exit 0
  }
} catch {}

$Exe = if (Test-Path $PythonW) { $PythonW } else { $Python }
Start-Process -FilePath $Exe -ArgumentList "`"$Server`"" -WorkingDirectory $VoiceDir -WindowStyle Hidden
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47811/health' -TimeoutSec 2
    if ($res.StatusCode -eq 200) {
      Write-Output 'Servidor de voz neuronal iniciado en http://127.0.0.1:47811.'
      exit 0
    }
  } catch {}
}
Write-Warning 'El servidor se lanzó pero aún está cargando o no respondió a tiempo.'
