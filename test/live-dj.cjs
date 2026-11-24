// Live developer regression against Spotify desktop on localhost:9222.
// Does not create playlists; tests version, diagnose, skip storm, no repeats, neural voice + ducking restore, and /PoorDJ UI.
const assert = require('node:assert/strict');
const { connect } = require('./cdp.cjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const c = await connect();
  const exceptions = [];
  try {
    await c.send('Runtime.enable');
    // Note: cdp.cjs resolves requests by id; we also check window.onerror inside the page.
    const init = await c.evaluate(`(async () => {
      window.__poorErrors = [];
      window.addEventListener('error', e => window.__poorErrors.push(e.message || String(e)));
      window.addEventListener('unhandledrejection', e => window.__poorErrors.push(String(e.reason?.message || e.reason || e)));

      const D = window.PoorDJ;
      if (!D) throw Error('PoorDJ not loaded');
      if (!Spicetify.Player.data?.item?.uri) {
        await Spicetify.Player.play?.();
        await new Promise(r => setTimeout(r, 1500));
      }
      await D.narrator.neural.health(true);
      if (D.engine.settings.voiceName && !D.engine.settings.voiceName.startsWith('neural:')) {
        D.engine.updateSettings({ voiceName: '' }, false);
        D.narrator.prefer('');
      }
      D.narrator.detect(true);
      const diag = await D.diagnose();
      D.open();
      await new Promise(r => setTimeout(r, 400));
      const pageEl = document.querySelector('#PoorDJPage');
      const rect = pageEl ? pageEl.getBoundingClientRect() : null;
      const playBtn = document.querySelector('#PoorDJ_PlaybarButton');
      const uiOk = !!(pageEl && rect && rect.width > 200 && rect.height > 200 && playBtn);
      Spicetify.Platform.History.goBack();
      return {
        version: D.version,
        diagProblems: diag.problems,
        diagRows: diag.rows,
        neuralOk: D.narrator.neural.ok,
        neuralErr: D.narrator.neural.lastError || null,
        neuralVoice: D.narrator.voice?.id || D.narrator.voice?.name || null,
        isNeural: !!D.narrator.voice?.neural,
        uiOk,
        currentUri: Spicetify.Player.data?.item?.uri || null
      };
    })()`);

    assert.equal(init.version, '4.0.0');
    assert.equal(init.uiOk, true, 'Full-page /PoorDJ booth or playbar button failed to render');
    assert.equal(init.isNeural, true, 'Expected active neural voice, got ' + JSON.stringify(init));

    // Start DJ and wait for >= 2 managed tracks
    const started = await c.evaluate(`(async () => {
      const D = window.PoorDJ;
      await D.engine.start();
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && D.engine.managed.length < 2) {
        await new Promise(r => setTimeout(r, 300));
      }
      return {
        active: D.engine.active,
        managed: D.engine.managed.length,
        status: D.engine.status,
        currentUri: D.engine.current?.uri || null,
        currentName: D.engine.current?.name || '',
        currentArtist: D.engine.current?.artists?.[0]?.name || ''
      };
    })()`);
    assert.equal(started.active, true, 'Engine failed to stay active on start: ' + started.status);
    assert.ok(started.managed >= 2, 'Expected >=2 managed queue tracks, got ' + started.managed + ' (' + started.status + ')');

    // Skip storm: 8 skips every 2.5s
    const seenUris = [started.currentUri];
    const seenNames = [`${started.currentName}|${started.currentArtist}`];
    for (let i = 0; i < 8; i++) {
      await sleep(2500);
      const step = await c.evaluate(`(async () => {
        await Spicetify.Player.next();
        await new Promise(r => setTimeout(r, 1200));
        const D = window.PoorDJ;
        const waitEnd = Date.now() + 4000;
        while (D.engine.autoSkipping && Date.now() < waitEnd) {
          await new Promise(r => setTimeout(r, 200));
        }
        return {
          active: D.engine.active,
          managed: D.engine.managed.length,
          uri: D.engine.current?.uri || null,
          name: D.engine.current?.name || '',
          artist: D.engine.current?.artists?.[0]?.name || '',
          status: D.engine.status,
          autoSkips: D.engine.autoSkips
        };
      })()`);
      assert.equal(step.active, true, `DJ deactivated on skip #${i + 1}: ${step.status}`);
      assert.ok(step.uri, `Missing current track URI on skip #${i + 1}`);
      assert.ok(!seenUris.includes(step.uri), `Repeated track URI on skip #${i + 1}: ${step.uri}`);
      const id = `${step.name}|${step.artist}`;
      assert.ok(!seenNames.includes(id), `Repeated song name|artist on skip #${i + 1}: ${id}`);
      seenUris.push(step.uri);
      seenNames.push(id);
    }

    // Neural voice + volume ducking check (wait for any in-flight storm narration to settle first)
    const voiceRes = await c.evaluate(`(async () => {
      const D = window.PoorDJ;
      D.voiceGate.cancel();
      await new Promise(r => setTimeout(r, 250));
      const volBefore = Spicetify.Player.getVolume();
      const res = await D.voiceGate.run('next', D.engine.current, D.engine.intent, { local: true });
      await new Promise(r => setTimeout(r, 250));
      const volAfter = Spicetify.Player.getVolume();
      await D.engine.stop();
      const errs = window.__poorErrors || [];
      return { res, volBefore, volAfter, activeAfterStop: D.engine.active, errs };
    })()`);

    assert.equal(voiceRes.res.spoken, true, 'Expected neural voiceGate.run to resolve {spoken:true}, got ' + JSON.stringify(voiceRes.res));
    assert.ok(Math.abs(voiceRes.volBefore - voiceRes.volAfter) < 0.02, `Volume did not restore: before=${voiceRes.volBefore}, after=${voiceRes.volAfter}`);
    assert.equal(voiceRes.activeAfterStop, false);
    assert.deepEqual(voiceRes.errs.filter(e => /POOR/i.test(e)), []);

    console.log(JSON.stringify({ ok: true, version: init.version, neuralVoice: init.neuralVoice, skipStormCount: seenUris.length, voiceRes }));
  } finally {
    c.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
