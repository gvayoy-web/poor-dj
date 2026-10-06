# Publicación

El proyecto está preparado como extensión descargable. La publicación requiere un repositorio público y acceso autenticado a GitHub; no requiere hosting propio.

1. Ejecutar `npm run build`, `npm run check`, `npm test` y las comprobaciones de interfaz y Spotify real descritas en `VALIDATION.md`.
2. Subir este proyecto a un repositorio público, excluyendo `dist/`, archivos de perfiles, copias de seguridad e informes personales de pruebas. El archivo generado, `manifest.json`, `README.md` y `preview.png` deben estar en la raíz.
3. Añadir el topic `spicetify-extensions` al repositorio. Marketplace utiliza ese topic y el manifiesto para descubrir extensiones; la indexación puede tardar.
4. Ejecutar `npm run release` y adjuntar el ZIP y su SHA-256 a la versión `v3.3.0` del repositorio. Comprobar después una instalación desde Marketplace y la actualización desde 2.2.

El manifiesto deja que Marketplace identifique al propietario del repositorio como autor. No se ha inventado un propietario ni una URL de publicación.

Formato verificado en la [guía oficial de publicación de Marketplace](https://github.com/spicetify/marketplace/wiki/Publishing-to-Marketplace).
