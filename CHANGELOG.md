# Cambios

## 3.4.0

- Pestaña **Letras**: letras sincronizadas por línea desde Spotify, línea activa con desenfoque de las demás, salto al tocar una línea, seguimiento automático que se pausa al desplazarte, ajuste de desfase, tres tamaños y pantalla completa.
- Respaldo opcional con LRCLIB, apagado por defecto y explicado en Ajustes; el texto de las letras no se guarda.
- Diseño renovado: pestañas, tinte con el color de la portada, portada mayor, transporte (anterior / pausa / siguiente) y barra de progreso con salto.
- **Letras en el escritorio:** ruta propia `/PoorDJ` con portada, letra grande y los mismos controles; botón «Letras · POOR DJ» en la barra de reproducción y acceso desde el panel. Funciona sin abrir el panel del DJ.
- Si Spicy Lyrics está instalado, se ofrece un botón para abrirlo (`/SpicyLyrics`); no se comparte código ni su servicio: son extensiones independientes que conviven.
- **Ajustes simplificados:** a la vista solo voz, frecuencia del DJ, canciones pendientes, color y cuatro casillas; transiciones, temporizador, etiquetas, biblioteca y datos pasan a *Avanzado*. Se retiran el panel compacto, el selector de ambiente y la sección «Cómo funciona».
- **Voz:** selector de voz con ranking y prueba; el DJ aparece como pista («DJ POOR») mientras habla y presenta cada 3 o 5 canciones la que suena, con su procedencia.
- **Complemento con Spicy Lyrics:** si está instalado, PurDJ oculta sus letras y ofrece abrirlo; el subtítulo del DJ se ve aunque el panel esté cerrado.
- **Voz simplificada:** un solo selector (Automática / Sin voz / voces del cliente) que prueba la voz al elegirla; se elimina el botón de prueba.
- **Comprobar compatibilidad** en Avanzado; **guardar la sesión como playlist privada** (sustituye al JSON de sesión); comentarios con datos reales de tu historial local.
- **Interfaz más simple:** una tarjeta de inicio (origen de la música, botón principal y «Seguir esta canción»), después la sesión y la búsqueda. El botón principal pasa a «Terminar DJ» sin competir con otras acciones. Crédito «Hecho por KROMBYTE».
- **Comentarios inteligentes:** ánimo por tempo y tono medidos, aviso de cambio de ambiente, frases por estilo declarado, hora de la noche y saludo «Soy DJ POOR»; nunca inventa género ni ánimo sin datos.
- **Transiciones:** forma de set (penaliza saltos bruscos de ritmo y de nivel), etiquetas en lenguaje claro y **transición automática** opcional que ajusta el solapamiento de Spotify (0 a 6 s) por pareja de canciones y lo restaura al terminar.
- **Robustez:** el DJ ya no se reinicia la voz elegida al cambiar las voces del sistema; las letras tienen tiempo máximo de espera de 7 s; el bucle de progreso no se detiene por un error puntual; el control flotante se oculta con el panel abierto; los subtítulos del DJ también se ven si la voz está silenciada.
- **Compatibilidad:** salto en la reproducción con alternativas si el cliente no ofrece `Player.seek`, y aviso claro tras 60 s si Spicetify no ofrece las piezas necesarias.
- Temporizador para terminar la sesión del DJ.
- Nuevas pruebas de letras (110 unitarias) y flujo de interfaz de letras; el límite del paquete sube a 200 KB.

## 3.3.0

- Menú de artista estable: conserva el panel, los resultados y el foco del teclado.
- Identidad propia: Tu música. Tu mando., símbolo de disco y controles compactos.
- Resultados en filas, voz a mano y ajustes avanzados agrupados.
- Controles de sesión visibles solo cuando aportan; sin acciones duplicadas en el selector.
- Documentación breve, captura pública, CI y paquete de distribución.

## 3.2.0

- Búsqueda dedicada de artistas, con fotografía y menú Aleatorio / Artista.
- Aleatorio elige un inicio al azar y da al artista aproximadamente tres de cada cuatro canciones; Artista limita la sesión a sus créditos, incluidas colaboraciones.
- Playlists privadas de hasta 24 canciones guardadas en Spotify, recuperación de creaciones parciales y enlace a la última mezcla conservado al reiniciar.
- Catálogo ampliado mediante discografía y álbumes, no limitado a las mismas canciones populares.
- 210 combinaciones breves de comentarios por evento y exclusión de los últimos 20 comentarios repetidos.
- Continuidad musical por tempo, tono y nivel verificado; controles explícitos de crossfade nativo 2 / 4 / 6 segundos, verificación del ajuste y restauración.

## 3.1.0

- Mini buscador: títulos sueltos como Yoko o L A K E N O S H I muestran resultados reales para elegir e iniciar el DJ. Las coincidencias exactas se muestran antes que canciones cercanas; se pueden iniciar referencias por artista.
- Seguir la canción actual inicia la sesión sin reiniciarla. Una cola manual que bloqueaba propuestas se guarda y se devuelve al terminar.
- Lectura nativa de Me gusta y playlists, con caché, dos consultas concurrentes y un selector para consultar hasta 300 canciones de una playlist concreta.
- Las tarjetas conocidas requieren playlist, Me gusta o escucha registrada; los votos del DJ quedan como feedback adicional.
- Comentarios más breves, puntuación para la cadencia, velocidad ajustada y pronunciación continua de títulos escritos con letras separadas.

## 3.0.1

- La música espera mientras habla una voz local y continúa al terminar. Sin voz disponible, silenciada o fallida, la reproducción sigue. Las elecciones manuales cancelan la reanudación automática.
- Eliminados los ejemplos de interfaz que excluían un artista concreto.
- Las tarjetas conservan sus portadas después de reiniciar y recuperan las faltantes mediante resultados reales de Spotify.
- El selector mezcla las opciones y continúa su recorrido al volver a abrirlo, sin regresar siempre al mismo primer par.
- Indicadores de voz activa, cantidad de canciones conocidas y opciones restantes; las portadas se actualizan sin reiniciar el selector.

## 3.0.0

- Dos tarjetas para iniciar con música conocida; recorrido sin repeticiones ni cambios de cola hasta elegir.
- Intérprete local de órdenes combinables con validación completa y selección de ediciones ambiguas.
- Perfil esquema 3: escucha verificada, procedencias visibles y preferencias por contexto musical.
- Feedback específico con deshacer, exclusiones temporales y límites de repetición.
- Una propuesta por defecto, prioridad de reproducción manual y recuperación de cola tras fallos parciales.
- Narrador contextual con una voz local en español y subtítulos; funciona también sin voz.
- Panel adaptable a Spotify, acento personalizable, teclado y movimiento reducido.
- Transiciones nativas de Spotify; eliminado el motor de fades.
- Consultas autenticadas compatibles con Spotify 1.3.3, deduplicadas y limitadas a dos simultáneas.
