# Publicación

El proyecto está preparado como extensión descargable. La publicación requiere un repositorio público y acceso autenticado a GitHub; no requiere hosting propio.

## Subir el repositorio

La carpeta pública es un repositorio Git independiente con rama `main`. En GitHub Desktop, usa **File → Add local repository**, elige esta carpeta y pulsa **Publish repository**. Puedes llamarlo `poor-dj`; desmarca **Keep this code private** para que Marketplace pueda descubrirlo.

También puedes crear un repositorio público vacío en GitHub, copiar su URL HTTPS y ejecutar desde esta carpeta:

```sh
git remote add origin URL_HTTPS_DEL_REPOSITORIO
git push -u origin main
```

La URL es un marcador: sustituir por la que muestre GitHub. No subir perfiles, copias de seguridad ni informes personales de pruebas; la copia pública ya los excluye.

## Crear una release

Ejecutar las pruebas del README y revisar `VALIDATION.md`. El workflow `release.yml` valida que el tag coincida con `package.json`, comprueba el código y crea un **borrador de release** con ZIP, SHA-256 y notas:

```sh
git tag v3.3.0
git push origin v3.3.0
```

En GitHub, abrir **Releases**, revisar el borrador y pulsar **Publish release**. GitHub Actions debe estar habilitado. La automatización se ha preparado localmente; su primera ejecución remota queda pendiente de subir el repositorio y el tag.

Alternativa manual: ejecutar `node build.cjs` y `node release.cjs`; crear una release `v3.3.0` desde GitHub y adjuntar los archivos `dist/poor-dj-3.3.0.zip` y `.zip.sha256`. Utilizar las notas de `RELEASE_NOTES.md`.

## Aparecer en Spicetify Marketplace

1. En la página del repo público, abrir el engranaje de **About** y añadir el topic exacto `spicetify-extensions`.
2. Mantener la rama predeterminada en `main`, con `manifest.json`, `poor-mans-dj.js`, `README.md` y `preview.png` en la raíz. Los campos del manifiesto apuntan a esos archivos.
3. Abrir Marketplace en Spotify, actualizar y buscar **POOR DJ** cuando se haya indexado. La guía no establece un plazo garantizado de aparición.
4. Verificar una instalación limpia y una actualización desde la versión anterior. Si no aparece, comprobar visibilidad pública, topic, rama y rutas antes de reportarlo a Marketplace.

La release sirve para descargar una versión concreta; Marketplace descubre la extensión a partir del repo y su manifiesto. No requiere hosting propio ni subir el ZIP a un formulario de Marketplace.

El manifiesto deja que Marketplace identifique al propietario del repositorio como autor. No se ha inventado un propietario ni una URL de publicación.

Formato verificado en la [guía oficial de publicación de Marketplace](https://github.com/spicetify/marketplace/wiki/Publishing-to-Marketplace).
