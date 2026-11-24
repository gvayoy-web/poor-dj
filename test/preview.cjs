// Current UI screenshots with demo data; no Spotify account or remote artwork.
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
    await page.goto(pathToFileURL(path.join(__dirname, 'fixture.html')).href + '?fresh');
    await page.waitForSelector('#PoorDJPage');

    // Generate clean local SVG data-URL album artwork so screenshots look realistic offline
    await page.evaluate(() => {
      const makeArt = (c1, c2, label) =>
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="200" r="110" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/><text x="200" y="214" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-weight="800" font-size="38">${label}</text></svg>`
        );
      window._demoArt = [
        makeArt('#1db954', '#0b2b18', 'SESIÓN'),
        makeArt('#7c3aed', '#1e1b4b', 'AFÍN'),
        makeArt('#db2777', '#3b0764', 'RADIO'),
        makeArt('#0284c7', '#0f172a', 'PULSO')
      ];
      const e = PoorDJ.engine;
      e.current = {
        uri: 'spotify:track:0000000000000000000001',
        name: 'Noches de Cabina',
        artists: [{ name: 'Artista de Demostración', uri: 'spotify:artist:0000000000000000000001' }],
        image: window._demoArt[0],
        duration: 214000,
        playlist: true,
        evidence: ['megusta']
      };
      e.anchor = e.current;
      e.onUpdate();
      document.querySelector('#pd-command')?.blur();
    });

    // Active DJ session screenshot -> preview.png
    await page.evaluate(async () => {
      const e = PoorDJ.engine;
      const art = window._demoArt;
      e.io.candidates = async () => [
        {
          uri: 'spotify:track:0000000000000000000002',
          name: 'Pulso Nocturno',
          artists: [{ name: 'Luz Urbana', uri: 'spotify:artist:0000000000000000000002' }],
          image: art[1],
          duration: 198000,
          affinity: true,
          familiar: true,
          evidence: ['playlist'],
          source: 'tu colección',
          audio: { bpm: 122, key: 0, mode: 1, loudness: -7 }
        },
        {
          uri: 'spotify:track:0000000000000000000003',
          name: 'Frecuencia Sur',
          artists: [{ name: 'Costa Norte', uri: 'spotify:artist:0000000000000000000003' }],
          image: art[2],
          duration: 205000,
          affinity: true,
          source: 'radio',
          radioRank: 2,
          audio: { bpm: 120, key: 7, mode: 1, loudness: -8 }
        },
        {
          uri: 'spotify:track:0000000000000000000004',
          name: 'Eco de Vinilo',
          artists: [{ name: 'Estudio 4', uri: 'spotify:artist:0000000000000000000004' }],
          image: art[3],
          duration: 221000,
          affinity: true,
          source: 'artista relacionado',
          audio: { bpm: 118, key: 0, mode: 1, loudness: -8 }
        }
      ];
      e.current.audio = { bpm: 120, key: 0, mode: 1, loudness: -7.5 };
      await e.start(e.current, true);
      e.played = 6;
      e.sessionHeardMs = 18 * 60000;
      e.discoveries = 2;
      e.preview = e.preview.map((t, i) => ({ ...t, image: art[(i + 1) % art.length] }));
      e.onUpdate();
    });

    await page.waitForSelector('.pd-next');
    await page.screenshot({ path: path.join(__dirname, '../preview.png'), animations: 'disabled' });

    // Concert Lyrics Stage screenshot -> assets/lyrics-stage.png
    await page.evaluate(() => {
      const origGet = Spicetify.CosmosAsync.get;
      Spicetify.CosmosAsync.get = async url => {
        if (String(url).includes('color-lyrics')) {
          return {
            lyrics: {
              syncType: 'LINE_SYNCED',
              language: 'es',
              providerDisplayName: 'Demo Concert',
              lines: [
                { startTimeMs: '0', words: 'Luces bajas sobre el estudio' },
                { startTimeMs: '6000', words: 'Gira el vinilo en silencio' },
                { startTimeMs: '12000', words: 'Suben los graves en la habitación' },
                { startTimeMs: '18000', words: 'Cada verso marca el pulso de la noche' },
                { startTimeMs: '24000', words: 'Cambia el ritmo sin soltar el control' },
                { startTimeMs: '30000', words: 'Y la mezcla sigue viva hasta el amanecer' },
                { startTimeMs: '36000', words: '♪' },
                { startTimeMs: '42000', words: 'Tu música. Tu mando.' }
              ]
            }
          };
        }
        return origGet(url);
      };
      PoorDJ.engine.current = {
        ...PoorDJ.engine.current,
        uri: 'spotify:track:0000000000000000000099',
        name: 'Noches de Cabina',
        artists: [{ name: 'Artista de Demostración', uri: 'spotify:artist:0000000000000000000001' }],
        image: window._demoArt[1],
        duration: 214000
      };
      Spicetify.Player.seek(20200);
      PoorDJ.engine.onUpdate();
    });
    await page.getByRole('tab', { name: 'Letras' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.pd-line').length >= 7);
    await page.waitForFunction(() => document.querySelector('.pd-now')?.textContent?.includes('pulso'));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(__dirname, '../assets/lyrics-stage.png'), animations: 'disabled' });

    // Responsive 860px smoke verify
    await page.setViewportSize({ width: 860, height: 900 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'poor-dj-active-860.png'), animations: 'disabled' });

    // Artist modes screenshot -> assets/artist-modes.png
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('tab', { name: 'Sesión' }).click();
    await page.evaluate(async () => {
      const e = PoorDJ.engine;
      await e.stop();
      e.artistMenu = { name: 'Artista de Demostración', uri: 'spotify:artist:0000000000000000000001' };
      document.querySelector('#pd-command').value = 'Artista de Demostración';
      e.onUpdate();
    });
    await page.locator('[data-artistmenu]:not([hidden])').waitFor({ state: 'visible' });
    await page.locator('[data-artistmenu]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(__dirname, '../assets/artist-modes.png'), animations: 'disabled' });

    console.log('All POOR DJ 4.0 screenshots saved (preview.png, lyrics-stage.png, artist-modes.png).');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
