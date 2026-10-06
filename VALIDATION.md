# Validación de POOR DJ 3.3.0

Fecha: 2026-10-05. Cliente comprobado: Spotify 1.3.3.264 con Spicetify 2.45.3, Windows.

- 102 pruebas automatizadas del motor aprobadas: cola, recuperación parcial, solicitudes manuales, memoria, afinidad, artistas, intérprete, voz y cachés.
- Interfaz comprobada en Edge: teclado, movimiento reducido, tarjetas, búsqueda, menú estable de artista, conservación de búsqueda, apertura repetida y limpieza de listeners y temporizadores.
- Regresión de artista comprobada en Spotify real: clic, dos modos, foco y vuelta a resultados sin cerrar el panel. La prueba no inicia música ni crea playlists.
- En 3.2 se verificaron playlists privadas reales: modo Artista con 24/24 canciones del artista; Aleatorio con 18/24. No se modificó ese motor en 3.3.
- Voz local mexicana disponible en el cliente probado. En pruebas anteriores se verificaron pausa durante narración y continuidad al silenciar o faltar voz; otros clientes pueden ofrecer solo subtítulos.
- Transiciones nativas aplicadas y restauradas en Spotify. No se ejecutan fades de volumen propios.
- Selección local con 300 candidatos dentro del presupuesto de 50 ms. Bundle limitado por el empaquetador a 150.000 bytes. Sin dependencias adicionales.

La sesión continua de 60 minutos no se completó: el usuario pidió detener esa prueba tras aproximadamente 17 minutos. No se afirma validación prolongada ni compatibilidad universal. La instalación desde Marketplace y su indexación requieren publicar el repositorio; permanecen pendientes.

## Repetir las comprobaciones

Ejecutar los comandos del README y `node test/ui.smoke.cjs` con Playwright y Edge disponibles. La fixture usa datos ilustrativos y simula el cierre de modal por clic fuera del panel.

`node test/live-panel.cjs` es una comprobación opcional de desarrollo con Spotify abierto temporalmente en el puerto 9222 de localhost. Solo busca y abre el menú; no inicia la mezcla. Cerrar después la depuración y reiniciar Spotify normalmente. Nunca publicar perfiles, cookies, tokens ni capturas con información de la cuenta.
