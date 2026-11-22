# POOR DJ 3.4.0 · Tu música. Tu mando.

Novedades: pestaña Letras sincronizadas (Spotify, con respaldo LRCLIB opcional), diseño con color de portada, transporte con progreso y temporizador. Detalles en CHANGELOG.md.

- El menú de artista conserva el panel abierto y el foco del teclado.
- Interfaz compacta con identidad propia, resultados en filas y ajustes agrupados.
- DJ local con búsqueda de canciones y artistas, tarjetas conocidas, órdenes por texto y prioridad para tus elecciones manuales.
- Mezclas de artista guardadas como playlists privadas y comentarios con voz local cuando Spotify la ofrece.

Descarga el ZIP y copia `poor-mans-dj.js` a la carpeta `Extensions` de Spicetify. Actívalo con `spicetify config extensions poor-mans-dj.js` y `spicetify apply`. El archivo `.sha256` permite verificar el ZIP.

102 pruebas del motor aprobadas, interfaz probada y menú verificado en Spotify real. Sin dependencias adicionales; bundle de unos 125 KB. Ver `VALIDATION.md` para el alcance y las limitaciones: no se completó la sesión de 60 minutos y la voz depende del cliente.

Cada instalación nueva aprende desde cero. El paquete no incluye perfiles personales; una actualización conserva el aprendizaje local previo.
