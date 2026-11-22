# POOR DJ

**Hecho por KROMBYTE · 3.4.0 · MIT · local · sin dependencias adicionales**

**Tu música. Tu mando.** Un DJ local para Spotify con Spicetify. Sigue lo que escuchas, busca canciones y artistas, y propone una mezcla que puedes dirigir por texto.

![POOR DJ 3.4.0: selección de música conocida](preview.png)

Vista de la interfaz actual con datos de demostración. No es una captura de una cuenta de Spotify.

- **Conocidas:** tarjetas de tus playlists, Me gusta y escuchas registradas, con su procedencia.
- **Artistas:** Aleatorio combina mucho de ese artista con música afín; Artista usa únicamente su catálogo y colaboraciones. Guarda una playlist privada.
- **Tú decides:** tu elección manual pausa el DJ; terminar devuelve la cola suspendida. Puedes descartar propuestas y cambiar la dirección.
- **Voz local y subtítulos:** comentarios breves en español. La música espera mientras habla; si el cliente no ofrece voz, continúa normalmente.
- **Letras sincronizadas:** pestaña *Letras* estilo karaoke con la línea actual resaltada, toque para saltar a esa línea, ajuste de desfase, tres tamaños y pantalla completa.
- **A tu gusto:** pocos ajustes a la vista (voz, frecuencia del DJ, canciones pendientes y color); lo demás está en *Avanzado*.

## Qué puedes hacer

### Elegir cómo empieza la sesión

Pulsa **Solo música conocida** para elegir entre dos canciones y ver de dónde vienen. **Otra vez** muestra otras opciones; al agotar la selección puedes reiniciarla. Abrir el panel o explorar las tarjetas no inicia música. **Seguir esta canción** comienza desde lo que está sonando y mantiene esa referencia durante la sesión.

**Descubrir afines** permite ampliar la selección con candidatos relacionados con la referencia. El DJ considera afinidad, variedad de artistas, repetición reciente y, cuando están disponibles, datos de tempo, tonalidad y sonoridad. Si no hay candidatos compatibles, lo indica en lugar de completar la cola con canciones ajenas.

### Buscar canciones y mezclar artistas

Escribe un título o un artista en **¿Qué quieres escuchar?**. Cuando hay varias coincidencias, elige un resultado antes de cambiar la reproducción. Los resultados de artista abren dos opciones:

| Modo | Qué incluye |
| --- | --- |
| **Aleatorio** | El artista como protagonista, acompañado de canciones afines. |
| **Artista** | Solo canciones acreditadas al artista, incluidas colaboraciones. |

La mezcla se guarda como **playlist privada** y puedes abrir la última playlist guardada desde el panel.

![POOR DJ: modos Aleatorio y Artista](assets/artist-modes.png)

### Dirigir el DJ con instrucciones

Las órdenes se interpretan mediante reglas locales. Puedes combinar preferencias y revisar las etiquetas de instrucciones vigentes en el panel.

| Ejemplo | Resultado |
| --- | --- |
| `solo conocidas y más variedad` | Limita la selección a música conocida y aumenta la variedad de artistas. |
| `solo conocidas y sin Dillom` | Excluye ese artista de la selección de la sesión. |
| `sigue esta canción` | Inicia desde la canción actual. |
| `pon SIN UN PLAN (TEGOCALDERON) de Isma` | Busca la canción para reproducirla; una elección manual pausa el DJ. |
| `otra sugerencia` | Renueva las sugerencias. |
| `termina el DJ` | Termina la sesión y devuelve la cola suspendida. |
| `restaura mi cola` | Solicita recuperar la cola guardada. |

Los filtros de género, como `reggaetón y más variedad`, necesitan etiquetas musicales declaradas. Puedes etiquetar la playlist actual y la canción desde **Etiquetas musicales**. Una orden incompleta o contradictoria muestra una explicación antes de aplicar cambios.

### Ajustar las propuestas sin perder tu cola

Usa **Más como esta**, **No encaja**, **Este artista no, por hoy** o **Demasiado repetida**; **Deshacer** revierte el último voto. En **A continuación** puedes pedir otra sugerencia y fijar una propuesta. La referencia y las exclusiones pertenecen a la sesión.

Una reproducción elegida manualmente pausa el DJ y retira sus propuestas. Suspender tu cola manual al iniciar es una opción desactivada por defecto. Al terminar, el DJ intenta devolver la cola suspendida; si la restauración queda incompleta, puedes volver a intentarlo. No modifica tus playlists existentes.

### Voz, transiciones y personalización

- **Voz local en español:** comentarios breves con subtítulos. La música espera mientras habla; puedes silenciar la voz. Si no hay una voz local compatible o reproduces en un dispositivo remoto, conserva los subtítulos.
- **Continuidad musical:** tres niveles y solapamiento nativo de Spotify de 0, 2, 4 o 6 segundos. Puedes aplicar el ajuste y restaurar el anterior. Este cambio también afecta a Spotify fuera del DJ; la extensión no hace fades de volumen propios ni adelanta el final de las canciones.
- **Presentación:** verde Spotify, colores del tema, azul, violeta o rosa; control compacto y panel compacto.
- **Preferencias:** entre una y tres canciones pendientes, contenido explícito y aprendizaje de la escucha configurables.

### Letras

La pestaña **Letras** usa primero las letras que el cliente de Spotify ofrece a tu sesión (sincronizadas por línea cuando existen). Toca una línea para saltar a ese momento; si al desplazarte manualmente quieres volver, usa **Volver a la línea actual**. El ajuste ± mueve la sincronía en pasos de 0,25 s. **Aa** cambia el tamaño y ⛶ abre pantalla completa.

La búsqueda en **LRCLIB** está **apagada por defecto** (Ajustes → Letras y ambiente). Si la activas, cuando Spotify no tiene letra se envían título, artista, álbum y duración a lrclib.net. El texto de las letras no se guarda; solo se recuerdan, 24 h, las canciones sin letra.

**En el escritorio:** el botón **POOR DJ** de la barra de reproducción abre el panel; también puedes usar **Ctrl+D**. El botón *Letras · POOR DJ* (o «Abrir letras en la ventana» en el panel) abre la ruta `/PoorDJ`, con la letra grande; vuelve con *Cerrar letras*.

**Con Spicy Lyrics:** si está instalado, POOR DJ **cede las letras**: oculta su pestaña, su página y sus ajustes de letras, y el panel muestra un botón *Letras ↗* que abre Spicy Lyrics. Así cada extensión hace lo suyo: Spicy Lyrics las letras (palabra por palabra, fondos, romanización) y POOR DJ la sesión y la voz. Cuando el DJ habla con el panel cerrado, aparece su subtítulo sobre cualquier vista, incluida la de Spicy Lyrics. POOR DJ es MIT y Spicy Lyrics AGPL-3.0, por eso no comparten código ni su servicio.

### Voz del DJ

El DJ habla como una pista más: mientras comenta, la tarjeta de «Sonando ahora» pasa a **DJ POOR** y muestra lo que dice. El saludo inicial es «¡Hola! Soy DJ POOR…». Los comentarios son **inteligentes con datos reales, sin IA**: según el *ánimo* (melancólica, tranquila, animada o intensa, estimado solo con el tempo y el tono que mide Spotify), un **cambio de ambiente** respecto a la canción anterior («Cambiamos de ambiente: ahora algo más melancólico») y el **estilo que tú declaraste** en tus etiquetas (reggaetón, salsa, jazz…). Sin datos acústicos o sin etiquetas, no inventa ni ánimo ni género. Además de la orientación inicial, cada 3 o 5 canciones (a tu elección) presenta la que suena: título, artista y de dónde viene en tu música («Viene de tu playlist»). La música espera mientras habla.

En **Ajustes → Voz del DJ** eliges entre *Automática*, *Sin voz (solo subtítulos)* y las voces en español de tu cliente, ordenadas por calidad probable; al elegir una, el DJ la prueba con una frase. *Automática* usa solo voces locales; las voces «en línea» (por ejemplo las *Natural* de Microsoft, cuando el cliente las ofrece) solo se usan si las eliges, y envían el texto del comentario a su proveedor. No hay claves ni servicios propios.

### Transiciones

El DJ ordena la cola como un set: puntúa tempo (también mitad y doble), tono y nivel, y penaliza los saltos bruscos de ritmo o de volumen y la repetición de artistas. Cada sugerencia explica su transición en claro («mantiene el pulso, encaja en tono, suena al mismo nivel»). Con **Avanzado → Transición automática**, el solapamiento nativo de Spotify se ajusta de 0 a 6 s según lo bien que encajen la canción actual y la siguiente, y se restaura al terminar la sesión. Sin datos acústicos, no cambia nada.

### Compatibilidad y sesión

**Avanzado → Comprobar compatibilidad** prueba qué responde en tu cliente (cola, reproducción, búsquedas, datos acústicos, playlists, voz y letras) y señala lo que Spotify pudo haber cambiado. **Guardar sesión como playlist** crea una playlist privada con las canciones únicas de la sesión (hasta 100). Los comentarios «Ahora suena…» usan solo tu historial local: veces escuchada y minutos de sesión.

### Otras mejoras de 3.4

Reproductor con anterior / pausa / siguiente y barra de progreso con salto, ambiente con el color de la portada, y **temporizador** para terminar el DJ a los 15, 30, 60 o 120 minutos.

### Biblioteca y datos locales

**Mi biblioteca y fuentes** permite actualizar Me gusta y playlists, y seleccionar una playlist para leer hasta 300 canciones. La familiaridad distingue playlist, escucha registrada y votos; Spotify no proporciona aquí todo tu historial ni estadísticas completas.

En **Mis datos** puedes exportar e importar el perfil, guardar la sesión como playlist privada, borrar el aprendizaje o vaciar la caché acústica. El perfil y la lógica del DJ permanecen en el cliente. Las búsquedas y consultas musicales usan tu sesión de Spotify.

## Requisitos y límites

Necesitas Spotify de escritorio con Spicetify instalado. La versión 3.3.0 se comprobó en Windows con Spotify 1.3.3.264 y Spicetify 2.45.3; consulta [VALIDATION.md](VALIDATION.md) para el alcance de las pruebas. La disponibilidad de voz, datos acústicos y ajustes nativos depende del cliente. No mide lo «comercial» de una canción ni inventa géneros o BPM ausentes.

Sin cuentas extra, claves, hosting ni modelos de IA. Las órdenes usan reglas locales; las búsquedas y los datos musicales vienen de tu sesión de Spotify. No lee tus estadísticas completas ni garantiza género/BPM cuando faltan datos.

## Instalar

En Marketplace, busca **POOR DJ** cuando el repositorio público esté indexado. También puedes descargar el ZIP y su SHA-256 desde [Releases](https://github.com/gvayoy-web/poor-dj/releases).

Para instalar manualmente, copia `poor-mans-dj.js` a la carpeta `Extensions` de Spicetify y ejecuta:

```sh
spicetify config extensions poor-mans-dj.js
spicetify apply
```

Abre POOR DJ desde el botón **POOR DJ** en la barra del reproductor o con **Ctrl+D**. Busca un título o artista, elige una tarjeta, o pulsa **Seguir esta canción**. Ejemplos: `solo conocidas y más variedad`, `sigue esta canción`, `termina el DJ`. Las instrucciones incompletas se explican antes de aplicar cambios.

## Desarrollar

Node.js 24 o posterior. Sin dependencias de ejecución ni compilación:

```sh
node build.cjs
node --check poor-mans-dj.js
node --test --test-isolation=none test/*.test.cjs
node release.cjs
```

La prueba opcional de interfaz requiere Playwright y Microsoft Edge: `node test/ui.smoke.cjs`. Ver [validación](VALIDATION.md), [contribución](CONTRIBUTING.md), [código de conducta](CODE_OF_CONDUCT.md) y [publicación y releases](PUBLISHING.md).

MIT. Proyecto independiente, sin afiliación con Spotify o Spicetify.
