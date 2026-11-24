# Validación de POOR DJ 4.0.0

Fecha: 2026-11-23. Cliente comprobado: Spotify 1.3.4.258 con Spicetify 2.45.3 en Windows.

## Pruebas automatizadas y en vivo

- **Pruebas unitarias (`node --test --test-isolation=none test/*.test.cjs`):** 135/135 aprobadas (`affinity`, `artist-mix`, `cache`, `engine`, `fixes`, `lyrics`, `search-library`, `v3`, `v4`). Cubren tormenta de 10 saltos sin desactivación, prioridad de cola manual, deduplicación por `songIdentity` (`Remastered`/`Live`/`feat.` vs `Remix`), bloqueo de `lastPlayed < 2 h`, reencolado encadenado (`refillAfter`), modo seguir (`onManual: 'follow'`), ampliación de candidatos al agotarse el pool, tope de 3 auto-saltos en contexto, migración de perfil esquema 3→4, `speakable()`, comentarios sin BPM ≤30 palabras y atenuación de volumen solo tras verificar audio reproducible.
- **Prueba de interfaz (`node test/ui.smoke.cjs`):** aprobada en Microsoft Edge sobre la cabina completa `/PoorDJ` en `#main-view` (modos *Mis favoritas* / *Mezcla* / *Descubrir*, selector de canciones conocidas, cola *A continuación* con fijar/descartar, búsqueda de canciones y menú de artista, pestaña *Letras* y detección/alternancia de proveedor externo *Spicy Lyrics*, *Ajustes*, píldora flotante, toast del DJ, atajo `Ctrl+D` / `Esc`, anchos `1280px` / `860px` / `390px`, movimiento reducido y limpieza total de listeners y temporizadores).
- **Empaquetado (`node release.cjs`):** `poor-mans-dj.js` de 261.148 bytes (límite 320 KB), ZIP y `.sha256` generados sin errores.
- **Voz neuronal local (`voice/server.py --selftest`):** las 7 voces en español (4 de Piper: `es_MX-claude-high`, `es_MX-ald-medium`, `es_AR-daniela-high`, `es_ES-davefx-medium`; 3 de Kokoro ONNX: `em_alex`, `em_santa`, `ef_dora`) sintetizaron muestras WAV en CPU entre 1,25 s y 4,22 s por frase.
- **Verificación en vivo sobre Spotify real (`node test/live-dj.cjs`):**
  - Diagnóstico de compatibilidad: 8/8 controles en verde (0 problemas), detección activa de *Spicy Lyrics* y renderizado de `/PoorDJ` y botón en barra de reproducción.
  - Tormenta de 8 saltos seguidos cada 2,5 s (`9` pistas únicas escuchadas en total): el DJ permaneció activo en todos los saltos y sin repetir URI ni canción.
  - Voz neuronal local (`piper:es_MX-claude-high`): `voiceGate.run` resolvió `{ spoken: true }` con restauración íntegra del volumen (`1` → atenuación → `1`) y cierre limpio (`engine.stop()`), sin errores capturados.

## Repetir las comprobaciones

```sh
node build.cjs
node --check poor-mans-dj.js
node --test --test-isolation=none test/*.test.cjs
node test/ui.smoke.cjs
node release.cjs
```

Para la comprobación en vivo (`node test/live-dj.cjs`), inicia temporalmente Spotify con `--remote-debugging-port=9222` y el servidor de voz local (`voice\start.ps1`), y al terminar reinicia Spotify normalmente sin puerto de depuración. Nunca publiques perfiles personales, tokens ni registros de sesión.
