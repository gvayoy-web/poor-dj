# Voz neuronal local para POOR DJ

Este módulo ejecuta un servidor local de síntesis de voz en español (`127.0.0.1:47811`) para que **POOR DJ** hable con voces neuronales naturales directamente en tu equipo, sin enviar tu historial ni tus comentarios a servidores externos.

## Instalación

Desde PowerShell en la carpeta del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File voice\install.ps1 -Autostart
```

Opciones:
- `-Autostart`: crea un acceso directo en el inicio de Windows (`POOR DJ Voz`) para que el servidor arranque automáticamente en segundo plano al iniciar sesión.
- `-Kokoro`: instala opcionalmente `kokoro-onnx` junto con las voces neuronales en español (`em_alex`, `em_santa`, `ef_dora`).

## Uso manual

- Iniciar en segundo plano: `powershell -ExecutionPolicy Bypass -File voice\start.ps1`
- Detener: `powershell -ExecutionPolicy Bypass -File voice\stop.ps1`
- Probar todas las voces y generar muestras WAV: `voice\.venv\Scripts\python.exe voice\server.py --selftest`

## Privacidad y red

- El servidor escucha únicamente en `127.0.0.1:47811` (solo accesible desde tu PC).
- Todo el procesamiento de audio ocurre en CPU de forma local.
- Si el servidor no está activo, POOR DJ usa automáticamente la voz local del sistema o muestra los subtítulos en pantalla.
