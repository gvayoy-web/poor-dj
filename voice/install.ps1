param(
  [switch]$Autostart,
  [switch]$Kokoro
)

$ErrorActionPreference = 'Stop'
$VoiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $VoiceDir '.venv'
$VoicesDir = Join-Path $VoiceDir 'voices'
$Python = Join-Path $VenvDir 'Scripts\python.exe'
$PythonW = Join-Path $VenvDir 'Scripts\pythonw.exe'
$Server = Join-Path $VoiceDir 'server.py'
$ReqFile = Join-Path $VoiceDir 'requirements.txt'

New-Item -ItemType Directory -Force -Path $VoicesDir | Out-Null

if (-not (Test-Path $Python)) {
  Write-Output 'Creando entorno virtual en voice\.venv...'
  python -m venv $VenvDir
}

Write-Output 'Actualizando pip e instalando dependencias base (piper-tts, numpy)...'
& $Python -m pip install --upgrade pip
& $Python -m pip install -r $ReqFile

$helpText = (& $Python -m piper.download_voices --help 2>&1 | Out-String)
$dirFlag = if ($helpText -match '--download-dir') { '--download-dir' } elseif ($helpText -match '--data-dir') { '--data-dir' } elseif ($helpText -match '--output-dir') { '--output-dir' } else { '--data-dir' }

$piperVoices = @(
  @{ id = 'es_MX-claude-high'; path = 'es/es_MX/claude/high/es_MX-claude-high' },
  @{ id = 'es_MX-ald-medium'; path = 'es/es_MX/ald/medium/es_MX-ald-medium' },
  @{ id = 'es_AR-daniela-high'; path = 'es/es_AR/daniela/high/es_AR-daniela-high' },
  @{ id = 'es_ES-davefx-medium'; path = 'es/es_ES/davefx/medium/es_ES-davefx-medium' }
)

foreach ($v in $piperVoices) {
  $onnx = Join-Path $VoicesDir ($v.id + '.onnx')
  $json = Join-Path $VoicesDir ($v.id + '.onnx.json')
  if ((Test-Path $onnx) -and (Test-Path $json) -and ((Get-Item $onnx).Length -gt 1000000)) {
    Write-Output "Voz ya descargada: $($v.id)"
    continue
  }
  Write-Output "Descargando voz Piper: $($v.id)..."
  $downloaded = $false
  try {
    & $Python -m piper.download_voices $dirFlag $VoicesDir $v.id
    if ((Test-Path $onnx) -and (Test-Path $json)) {
      $downloaded = $true
    }
  } catch {
    Write-Warning "download_voices falló para $($v.id): $_"
  }
  if (-not $downloaded) {
    $baseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/$($v.path)"
    Write-Output "Descarga directa desde Hugging Face para $($v.id)..."
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl.onnx?download=true" -OutFile $onnx
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl.onnx.json?download=true" -OutFile $json
  }
}

if ($Kokoro) {
  Write-Output 'Instalando soporte opcional Kokoro ONNX...'
  try {
    & $Python -m pip install kokoro-onnx soundfile
    $kokoroDir = Join-Path $VoicesDir 'kokoro'
    New-Item -ItemType Directory -Force -Path $kokoroDir | Out-Null
    $modelFile = Join-Path $kokoroDir 'kokoro-v1.0.int8.onnx'
    $voicesFile = Join-Path $kokoroDir 'voices-v1.0.bin'
    if (-not (Test-Path $modelFile) -or (Get-Item $modelFile).Length -lt 10000000) {
      Write-Output 'Descargando modelo kokoro-v1.0.int8.onnx...'
      Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx' -OutFile $modelFile
    }
    if (-not (Test-Path $voicesFile) -or (Get-Item $voicesFile).Length -lt 1000000) {
      Write-Output 'Descargando voces Kokoro (voices-v1.0.bin)...'
      Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin' -OutFile $voicesFile
    }
    Write-Output 'Kokoro instalado correctamente.'
  } catch {
    Write-Warning "No se pudo completar la instalación opcional de Kokoro: $_. Piper seguirá funcionando."
  }
}

if ($Autostart) {
  $startupDir = [Environment]::GetFolderPath('Startup')
  $lnkPath = Join-Path $startupDir 'POOR DJ Voz.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath = if (Test-Path $PythonW) { $PythonW } else { $Python }
  $shortcut.Arguments = "`"$Server`""
  $shortcut.WorkingDirectory = $VoiceDir
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Servidor local de voz neuronal para POOR DJ'
  $shortcut.Save()
  Write-Output "Acceso directo de inicio automático creado: $lnkPath"
}

$alreadyUp = $false
try {
  $res = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47811/health' -TimeoutSec 2
  if ($res.StatusCode -eq 200) { $alreadyUp = $true }
} catch {}

if ($alreadyUp) {
  Write-Output 'El servidor de voz ya estaba respondiendo en http://127.0.0.1:47811.'
} else {
  $Exe = if (Test-Path $PythonW) { $PythonW } else { $Python }
  Write-Output 'Iniciando servidor de voz neuronal...'
  Start-Process -FilePath $Exe -ArgumentList "`"$Server`"" -WorkingDirectory $VoiceDir -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $res = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47811/health' -TimeoutSec 2
      if ($res.StatusCode -eq 200) {
        Write-Output 'Servidor de voz neuronal activo en http://127.0.0.1:47811.'
        break
      }
    } catch {}
  }
}
