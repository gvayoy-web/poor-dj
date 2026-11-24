# POOR DJ 4.0.0 · Tu música. Tu mando.

Novedades principales:
- **Cabina a pantalla completa (`/PoorDJ`):** nueva interfaz glass oscura con fondo de portada, vinilo animado, pestañas *Sesión · Letras · Ajustes*, estadísticas en vivo, atajo `Ctrl+D`, botón en la barra de reproducción y elección entre proveedor externo de letras (*Spicy Lyrics*, *Lyrics Plus*, *Beautiful Lyrics*) o pestaña integrada.
- **Sin desconexiones ni repeticiones:** tolera saltos rápidos, mantiene búfer de 2–5 canciones, espera si agregas canciones manuales, evita temas o versiones duplicadas (`songIdentity`) y sigue tu rumbo si eliges otra canción.
- **Mejor gusto musical:** mezcla tu biblioteca con la radio interna de Spotify (`inspiredby-mix` / `radio-apollo`), aprende afinidad por artista y usa semillas dinámicas.
- **Voz neuronal local en español:** servidor local opcional en `voice/` (`127.0.0.1:47811`) con Piper y Kokoro ONNX, atenuación suave del volumen (*ducking*) sin pausar la música y respaldo automático del sistema.

Detalles completos en `CHANGELOG.md` y alcance de pruebas en `VALIDATION.md`.
