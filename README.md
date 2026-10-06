# POOR DJ

**Tu música. Tu mando.** Un DJ local para Spotify con Spicetify. Sigue lo que escuchas, busca canciones y artistas, y propone una mezcla que puedes dirigir por texto.

![Panel POOR DJ — captura ilustrativa](preview.png)

- **Conocidas:** tarjetas de tus playlists, Me gusta y escuchas registradas, con su procedencia.
- **Artistas:** Aleatorio combina mucho de ese artista con música afín; Artista usa únicamente su catálogo y colaboraciones. Guarda una playlist privada.
- **Tú decides:** tu elección manual pausa el DJ; terminar devuelve la cola suspendida. Puedes descartar propuestas y cambiar la dirección.
- **Voz local y subtítulos:** comentarios breves en español. La música espera mientras habla; si el cliente no ofrece voz, continúa normalmente.
- **A tu gusto:** acentos, panel compacto y continuidad musical con transiciones nativas de Spotify.

Sin cuentas extra, claves, hosting ni modelos de IA. Las órdenes usan reglas locales; las búsquedas y los datos musicales vienen de tu sesión de Spotify. No lee tus estadísticas completas ni garantiza género/BPM cuando faltan datos.

## Instalar

En Marketplace, busca POOR DJ cuando el repositorio público esté indexado. La publicación está pendiente; el paquete local ya está disponible.

Para instalar manualmente, copia `poor-mans-dj.js` a la carpeta `Extensions` de Spicetify y ejecuta:

```sh
spicetify config extensions poor-mans-dj.js
spicetify apply
```

Abre POOR DJ desde el reproductor. Busca un título o artista, elige una tarjeta, o pulsa **Seguir esta canción**. Ejemplos: `solo conocidas y más variedad`, `sigue esta canción`, `termina el DJ`. Las instrucciones incompletas se explican antes de aplicar cambios.

## Desarrollar

Node.js 24 o posterior. Sin dependencias de ejecución ni compilación:

```sh
node build.cjs
node --check poor-mans-dj.js
node --test --test-isolation=none test/*.test.cjs
node release.cjs
```

La prueba opcional de interfaz requiere Playwright y Microsoft Edge: `node test/ui.smoke.cjs`. Ver [validación](VALIDATION.md), [contribución](CONTRIBUTING.md) y [publicación](PUBLISHING.md).

MIT. Proyecto independiente, sin afiliación con Spotify o Spicetify.
