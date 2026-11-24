$ErrorActionPreference = 'SilentlyContinue'
$VoiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$procs = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match 'pythonw?\.exe' -and $_.CommandLine -like '*voice\server.py*'
}
if (-not $procs) {
  $procs = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'pythonw?\.exe' -and $_.CommandLine -like '*server.py*' -and $_.CommandLine -like "*$VoiceDir*"
  }
}
if ($procs) {
  foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force
  }
  Write-Output "Servidor de voz detenido ($($procs.Count) proceso(s))."
} else {
  Write-Output 'No hay ningún servidor de voz activo.'
}
