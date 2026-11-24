const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch(
    process.env.KROMBYTE_CHROME
      ? { headless: true, executablePath: process.env.KROMBYTE_CHROME, args: ['--no-sandbox'] }
      : { headless: true, channel: 'msedge' }
  );
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(pathToFileURL(path.join(__dirname, 'fixture.html')).href);
    await page.waitForSelector('#PoorDJPage');
    assert.match(await page.locator('#PoorDJPage h1').innerText(), /4\.0\.0/);
    assert.equal(await page.evaluate(() => demo.intervals()), 0);
    assert.equal(await page.evaluate(() => PoorDJ.engine.settings.takeover), false);
    assert.equal(await page.locator('#PoorDJ_PlaybarButton').isVisible(), true);

    // Vibe selection: Mis favoritas (0), Mezcla (35), Descubrir (75)
    await page.locator('[data-vibe="0"]').click();
    assert.equal(await page.evaluate(() => PoorDJ.engine.intent.known), true);
    await page.locator('[data-vibe="75"]').click();
    assert.equal(await page.evaluate(() => PoorDJ.engine.settings.discovery), 75);
    await page.locator('[data-vibe="35"]').click();
    assert.equal(await page.evaluate(() => PoorDJ.engine.settings.discovery), 35);

    // Known song picker without starting playback
    const beforeUri = await page.evaluate(() => Spicetify.Player.data.item.uri);
    await page.locator('[data-openpicker]').click();
    assert.equal(await page.locator('[data-choice]').count(), 2);
    const firstPair = await page.locator('[data-choice]').evaluateAll(ns => ns.map(n => n.dataset.choice));
    await page.locator('[data-again]').click();
    const secondPair = await page.locator('[data-choice]').evaluateAll(ns => ns.map(n => n.dataset.choice));
    assert.ok(secondPair.every(u => !firstPair.includes(u)));
    assert.equal(await page.evaluate(() => Spicetify.Player.data.item.uri), beforeUri);
    await page.locator('[data-closepicker]').click();

    // Start DJ -> up-next list populates with 3 songs
    await page.locator('[data-toggle]').click();
    await page.waitForFunction(() => PoorDJ.engine.active && !PoorDJ.engine.busy && PoorDJ.engine.preview.length === 3);
    assert.equal(await page.locator('.pd-next').count(), 3);
    assert.equal(await page.evaluate(() => demo.intervals()), 1);

    // Pin first up-next song
    await page.locator('[data-pin]').first().click();
    assert.equal(await page.evaluate(() => !!PoorDJ.engine.pinned), true);

    // Command box: filter & reject invalid command
    await page.locator('#pd-command').fill('solo conocidas y menos comercial');
    await page.locator('[data-command] button[type="submit"]').click();
    await page.waitForFunction(() => PoorDJ.engine.error);

    await page.locator('#pd-command').fill('permite descubrir y sin Dillom y más variedad');
    await page.locator('[data-command] button[type="submit"]').click();
    await page.waitForFunction(() => PoorDJ.engine.intent.variety === 80 && !PoorDJ.engine.busy);
    assert.ok((await page.locator('[data-intent]').innerText()).includes('dillom'));

    // Search & Artist menu
    await page.locator('#pd-command').fill('Yoko');
    await page.locator('#pd-command').press('Enter');
    await page.waitForFunction(() => PoorDJ.engine.commandChoices.length > 0);
    assert.ok((await page.locator('[data-match]').count()) > 0);
    await page.locator('[data-closesearch]').click();

    await page.locator('#pd-command').fill('Artist 1');
    await page.locator('#pd-command').press('Enter');
    await page.waitForFunction(() => PoorDJ.engine.commandArtists.length > 0 || PoorDJ.engine.commandChoices.length > 0);
    if ((await page.locator('[data-mixartist]').count()) > 0) {
      await page.locator('[data-mixartist]').first().click();
      await page.waitForSelector('[data-artistmenu]:not([hidden])');
      assert.equal(await page.locator('[data-artistmode="mix"]').count(), 1);
      assert.equal(await page.locator('[data-artistmode="only"]').count(), 1);
      await page.locator('[data-closeartist]').click();
      await page.locator('[data-closesearch]').click();
    }

    // Lyrics tab
    await page.getByRole('tab', { name: 'Letras' }).click();
    await page.waitForSelector('.pd-lyrics-stage .pd-line');
    assert.equal(await page.locator('.pd-lyrics-rail').isVisible(), true);
    assert.equal(await page.locator('.pd-line').count(), 4);
    await page.waitForFunction(() => document.querySelector('.pd-now')?.textContent === 'Segunda línea');
    assert.equal(await page.locator('.pd-now').getAttribute('data-state'), 'now');
    const lpVal = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pd-now')).getPropertyValue('--lp')));
    assert.ok(Number.isFinite(lpVal) && lpVal >= 0);
    await page.locator('.pd-line').nth(2).click();
    assert.equal(await page.evaluate(() => demo.seeked), 12000);
    await page.waitForFunction(() => document.querySelector('.pd-now')?.textContent === 'Tercera línea');
    await page.getByRole('button', { name: 'Adelantar letra' }).click();
    assert.equal(await page.evaluate(() => PoorDJ.engine.settings.lyricsOffset), 250);
    await page.getByRole('button', { name: 'Cambiar tamaño de letra' }).click();
    assert.equal(await page.locator('#PoorDJPage').getAttribute('data-lsize'), 'l');

    // Settings tab
    await page.getByRole('tab', { name: 'Ajustes' }).click();
    await page.locator('[data-diagnose]').click();
    await page.waitForFunction(() => /Cola de reproducción/.test(document.querySelector('[data-diagresult]').textContent));
    assert.equal(await page.locator('[data-voicepick]').isVisible(), true);

    // Off-page mini pill and DJ toast + Ctrl+D toggle
    await page.keyboard.press('Control+KeyD');
    await page.waitForFunction(() => !document.querySelector('#PoorDJPage'));
    assert.equal(await page.locator('.pd-mini').isVisible(), true);
    await page.evaluate(() => {
      PoorDJ.narrator.speaking = true;
      PoorDJ.narrator.text = 'Ahora suena Demo.';
      PoorDJ.engine.onUpdate();
    });
    assert.equal(await page.locator('.pd-toastdj').isVisible(), true);
    await page.evaluate(() => {
      PoorDJ.narrator.speaking = false;
      PoorDJ.narrator.text = '';
      PoorDJ.engine.onUpdate();
    });

    // Reopen with Playbar button, test X close fallback when goBack is a no-op / index 0, then reopen for Esc close
    await page.locator('#PoorDJ_PlaybarButton').click();
    await page.waitForSelector('#PoorDJPage');
    assert.equal(await page.locator('.pd-mini').isHidden(), true);
    await page.evaluate(() => {
      demo.origGoBack = Spicetify.Platform.History.goBack;
      Spicetify.Platform.History.index = 0;
      Spicetify.Platform.History.goBack = () => {};
    });
    await page.locator('[data-closepage]').click();
    await page.waitForFunction(() => !document.querySelector('#PoorDJPage'));
    assert.equal(await page.evaluate(() => Spicetify.Platform.History.location.pathname), '/');
    await page.evaluate(() => {
      Spicetify.Platform.History.goBack = demo.origGoBack;
      delete Spicetify.Platform.History.index;
    });
    await page.locator('#PoorDJ_PlaybarButton').click();
    await page.waitForSelector('#PoorDJPage');

    // Responsive width checks (860px and 390px)
    await page.setViewportSize({ width: 860, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // Stop DJ and dispose cleanly
    await page.evaluate(() => PoorDJ.engine.stop());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#PoorDJPage'));
    await page.evaluate(() => PoorDJ.dispose());
    assert.equal(await page.evaluate(() => demo.listeners()), 0);
    assert.equal(await page.evaluate(() => demo.intervals()), 0);
    assert.equal(await page.locator('#PoorDJPage').count(), 0);
    assert.equal(await page.evaluate(() => Spicetify.Platform.PlayerAPI.play === demo.originalPlay), true);

    // Spicy Lyrics: auto mode hides Letras tab & shows Spicy Lyrics ↗; builtin mode restores Letras tab + shortcut
    const sp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await sp.addInitScript(() => {
      window.SpicyLyrics = {};
    });
    await sp.goto(pathToFileURL(path.join(__dirname, 'fixture.html')).href + '?fresh');
    await sp.waitForSelector('#PoorDJPage');
    assert.equal(await sp.locator('[data-tab="lyrics"]').isHidden(), true);
    assert.equal(await sp.locator('[data-openspicy]').isVisible(), true);
    assert.match(await sp.locator('[data-openspicy]').innerText(), /Spicy Lyrics/);
    await sp.locator('[data-openspicy]').click();
    assert.equal(await sp.evaluate(() => Spicetify.Platform.History.location.pathname), '/SpicyLyrics');
    await sp.evaluate(() => PoorDJ.open());
    await sp.waitForSelector('#PoorDJPage');
    await sp.getByRole('tab', { name: 'Ajustes' }).click();
    await sp.locator('[data-select="lyricsProvider"]').selectOption('builtin');
    assert.equal(await sp.locator('[data-tab="lyrics"]').isVisible(), true);
    await sp.getByRole('tab', { name: 'Letras' }).click();
    assert.equal(await sp.locator('[data-openextlyrics]').isVisible(), true);
    assert.match(await sp.locator('[data-openextlyrics]').innerText(), /Abrir en Spicy Lyrics/);
    await sp.close();

    assert.deepEqual(errors, []);
    console.log('UI smoke test passed (v4 full-page booth, vibes, search, lyrics, settings, mini, toast, responsive, Spicy Lyrics, cleanup).');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
