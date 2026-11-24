const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  Engine,
  Narrator,
  NeuralVoice,
  VoiceGate,
  commentary,
  speakable,
  songIdentity,
  migrateProfile,
  settingsOf,
  intentOf,
  affinityPool
} = require('../poor-mans-dj.js');

const artist = (id, name) => ({ uri: 'spotify:artist:' + String(id).padStart(22, '0'), name });
const track = (id, name = 'Song ' + id, a = artist(1, 'Omar Courtz')) => ({
  uri: 'spotify:track:' + String(id).padStart(22, '0'),
  uid: 'u' + id,
  name,
  artists: [a],
  duration: 200000,
  affinity: true,
  familiar: true,
  playlist: true,
  source: 'contexto'
});

function engineFixture(poolSize = 20) {
  let q = [];
  let serial = 0;
  let skips = 0;
  const pool = Array.from({ length: poolSize }, (_, i) => track(i + 2, 'Track ' + (i + 2), artist((i % 5) + 1, 'Artist ' + ((i % 5) + 1))));
  const io = {
    queue: () => ({ priority: q.slice(), all: q.slice() }),
    save: () => {},
    skip: () => {
      skips++;
    },
    play: async () => {},
    candidates: async (_seed, _settings, _all, opts) => (opts?.widen ? pool.concat([track(900, 'Widened', artist(9, 'Extra'))]) : pool),
    add: async ts => {
      const rows = ts.map(t => ({ ...t, uid: 'dj' + serial++ }));
      q.push(...rows);
      return rows;
    },
    remove: async ts => {
      q = q.filter(t => !ts.some(m => m.uid === t.uid));
    }
  };
  const e = new Engine(io);
  e.trackChanged(track(1, 'Start Track'));
  return {
    e,
    io,
    q: () => q,
    setQ: rows => {
      q = rows;
    },
    skips: () => skips
  };
}

test('(a) skip storm of 10 consecutive context tracks keeps DJ active', async () => {
  const f = engineFixture();
  await f.e.start();
  assert.equal(f.e.active, true);
  for (let i = 100; i < 110; i++) {
    f.e.trackChanged(track(i, 'Context ' + i, artist(7, 'Context Artist')));
    if (f.e.flight) await f.e.flight;
    assert.equal(f.e.active, true, 'DJ should remain active on skip ' + i);
  }
});

test('(b) manual queue addition removes DJ tracks, pauses refills until manual queue drains, then refills', async () => {
  const f = engineFixture();
  await f.e.start();
  assert.equal(f.e.managed.length, 3);
  const manual = track(90, 'Manual Choice', artist(8, 'Manual'));
  f.setQ([...f.q(), manual]);
  await f.e.reconcileManual();
  assert.equal(f.e.active, true);
  assert.equal(f.e.managed.length, 0);
  assert.deepEqual(f.q().map(t => t.uri), [manual.uri]);

  await f.e.fill(false);
  assert.equal(f.e.managed.length, 0);
  assert.match(f.e.status, /Tus canciones en cola van primero/);

  f.setQ([]);
  f.e.trackChanged(manual);
  if (f.e.flight) await f.e.flight;
  assert.equal(f.e.active, true);
  assert.equal(f.e.managed.length, 3);
});

test('(c) songIdentity blocks duplicate versions and lastPlayed < 2h is blocked unless relaxed', async () => {
  const a = track(10, 'Soy Lo Peor (feat. X) - Remastered 2020', artist(1, 'Depresión Sonora'));
  const b = track(11, 'Soy Lo Peor', artist(1, 'Depresión Sonora'));
  const remix = track(12, 'Soy Lo Peor (Remix)', artist(1, 'Depresión Sonora'));
  assert.equal(songIdentity(a), songIdentity(b));
  assert.notEqual(songIdentity(remix), songIdentity(b));

  const f = engineFixture();
  await f.e.start();
  f.e.trackChanged(a);
  if (f.e.flight) await f.e.flight;

  const picks1 = f.e.select([b, remix], [], 5);
  assert.deepEqual(picks1.map(t => t.uri), [remix.uri]);

  const recentPlayed = track(30, 'Too Recent', artist(6, 'Other'));
  f.e.memory[recentPlayed.uri] = { plays: 1, heard: 1, vote: 0, lastPlayed: Date.now() - 30 * 60000 };
  assert.equal(f.e.select([recentPlayed], [], 1).length, 0);
  assert.equal(f.e.select([recentPlayed], [], 1, { relaxed: true }).length, 1);
});

test('(d) trackChanged during an in-flight refill triggers a follow-up fill', async () => {
  const f = engineFixture();
  await f.e.start();
  // Drop one track so a top-up fill(false) is needed (2 -> 3)
  const firstTrack = f.q()[0];
  f.setQ(f.q().slice(1));
  f.e.trackChanged(firstTrack);
  if (f.e.flight) await f.e.flight;
  assert.equal(f.e.managed.length, 3);

  // Now stall the next top-up refill while user skips again
  const secondTrack = f.q()[0];
  f.setQ(f.q().slice(1));
  f.e.sync();
  let releaseTopUp;
  let calls = 0;
  const baseCand = f.io.candidates;
  f.io.candidates = async (...args) => {
    calls++;
    if (calls === 1) {
      await new Promise(r => {
        releaseTopUp = r;
      });
    }
    return baseCand(...args);
  };
  f.e.pool = null;
  const topUp = f.e.fill(false);
  while (!releaseTopUp) await Promise.resolve();

  const thirdTrack = f.q()[0];
  f.setQ(f.q().slice(1));
  f.e.trackChanged(thirdTrack);
  assert.equal(f.e.refillAfter, true);

  f.e.pool = null;
  releaseTopUp();
  await topUp;
  // Prevent the cached pool from masking the follow-up call count
  f.e.pool = null;
  await new Promise(r => setTimeout(r, 40));
  if (f.e.flight) await f.e.flight;
  assert.equal(f.e.managed.length, 3);
});

test('(e) follow mode updates anchor on userPlay + trackChanged while keeping DJ active', async () => {
  const f = engineFixture();
  await f.e.start();
  const nextPick = track(88, 'Clicked Song', artist(9, 'Clicked Artist'));
  assert.equal(f.e.userPlay(), null);
  f.e.trackChanged(nextPick);
  await new Promise(r => setTimeout(r, 20));
  if (f.e.flight) await f.e.flight;
  assert.equal(f.e.active, true);
  assert.equal(f.e.anchor.uri, nextPick.uri);

  f.e.updateSettings({ onManual: 'pause' }, false);
  const pausePromise = f.e.userPlay();
  assert.ok(pausePromise);
  await pausePromise;
  assert.equal(f.e.active, false);
});

test('(f) pool exhaustion widens candidates and selects tracks with relaxed rules', async () => {
  const f = engineFixture(1);
  const old = track(55, 'Played Recently', artist(4, 'Artist 4'));
  f.e.memory[old.uri] = { plays: 2, heard: 2, vote: 0, lastPlayed: Date.now() - 30 * 60000 };
  f.io.candidates = async (_s, _st, _all, opts) => (opts?.widen ? [old] : []);
  await f.e.start();
  assert.equal(f.e.active, true);
  assert.deepEqual(f.q().map(t => t.uri), [old.uri]);
});

test('(g) fallthrough guard auto-skips repeated context tracks at most 3 times in a row', async () => {
  const f = engineFixture();
  await f.e.start();
  for (let i = 0; i < 4; i++) {
    f.e.trackChanged(track(101 + i, 'Start Track'));
  }
  assert.equal(f.skips(), 3);
  assert.equal(f.e.played, 1);
});

test('(h) schema 3 to schema 4 migration updates discovery default, intent and clamps artist taste', () => {
  const v3 = {
    schema: 3,
    settings: { discovery: 0, queueSize: 1, diversity: 25 },
    intent: { known: true },
    memory: {},
    taste: {
      artists: {
        'spotify:artist:0000000000000000000001': { name: 'A', uri: 'spotify:artist:0000000000000000000001', score: 99, plays: 5, skips: 1, last: 1000 }
      }
    }
  };
  const m = migrateProfile(v3);
  assert.equal(m.schema, 4);
  assert.equal(m.settings.discovery, 35);
  assert.equal(m.settings.queueSize, 3);
  assert.equal(m.intent.known, false);
  assert.equal(m.taste.artists['spotify:artist:0000000000000000000001'].score, 15);
  const s = settingsOf(m.settings);
  assert.equal(s.onManual, 'follow');
  assert.equal(s.voiceMode, 'duck');
  assert.equal(s.duckLevel, 30);
  assert.equal(s.lyricsProvider, 'auto');
  assert.equal(settingsOf({ lyricsProvider: 'builtin' }).lyricsProvider, 'builtin');
  assert.equal(settingsOf({ lyricsProvider: 'invalid' }).lyricsProvider, 'auto');
});

test('trusted group in affinityPool admits Spotify radio tracks without artist filter', () => {
  const seed = track(1, 'Seed', artist(1, 'A'));
  const radioTrack = { ...track(99, 'Radio Pick', artist(99, 'Unrelated')), radioRank: 0 };
  const pool = affinityPool(seed, [], [{ tracks: [radioTrack], source: 'radio', trusted: true }], intentOf({ known: false }));
  assert.equal(pool.length, 1);
  assert.equal(pool[0].source, 'radio');
  assert.equal(pool[0].radioRank, 0);
});

test('speakable cleans titles, feat., ampersands, spaced letters and uppercase words', () => {
  assert.equal(
    speakable('Ahora suena SIN UN PLAN (feat. X) - Remastered 2020, de Omar & Isma 🔥.'),
    'Ahora suena SIN UN Plan, de Omar y Isma.'
  );
  assert.equal(speakable('Esto es L A K E N O S H I ft. Y'), 'Esto es Lakenoshi con Y');
});

test('commentary supports new v4 events, stays <=30 words and omits bpm numbers', () => {
  const seed = {
    name: 'Yoko',
    artists: [{ name: 'Omar Courtz' }],
    daysSince: 45,
    minutes: 60,
    artistsCount: 12,
    audio: { bpm: 128, key: 0, mode: 1, loudness: -6 }
  };
  for (const ev of ['start', 'next', 'direction', 'follow', 'discovery', 'return', 'milestone', 'end']) {
    for (let i = 0; i < 12; i++) {
      const line = commentary(ev, seed, intentOf({ known: false }), i);
      assert.ok(line.length > 0);
      assert.ok(line.split(/\s+/).length <= 30, `${ev}: ${line}`);
      assert.doesNotMatch(line, /\bbpm\b/i);
    }
  }
});

test('VoiceGate duck mode waits for playable audio before ducking and never ducks on load failure', async () => {
  let volume = 0.8;
  const volWrites = [];
  let loadShouldSucceed = true;
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.listeners = new Map();
      queueMicrotask(() => {
        const type = loadShouldSucceed ? 'canplaythrough' : 'error';
        (this.listeners.get(type) || []).forEach(fn => fn());
      });
    }
    addEventListener(type, fn) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
    }
    removeEventListener(type, fn) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== fn));
    }
    play() {
      setTimeout(() => {
        (this.listeners.get('ended') || []).forEach(fn => fn());
      }, 20);
      return Promise.resolve();
    }
    pause() {}
  }

  const host = {
    Audio: FakeAudio,
    speechSynthesis: { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {} }
  };
  const neural = new NeuralVoice('http://127.0.0.1:47811', {
    Audio: FakeAudio,
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true, default: 'piper:es_MX-claude-high', voices: [{ id: 'piper:es_MX-claude-high', label: 'Claude', lang: 'es-MX' }] })
    })
  });
  await neural.health(true);
  const n = new Narrator(host, () => {}, { neural });
  n.detect(true);
  assert.equal(n.voice.neural, true);

  const gate = new VoiceGate(n, {
    playing: () => true,
    uri: () => 'u1',
    device: () => 'local',
    mode: () => 'duck',
    duckLevel: () => 25,
    getVolume: () => volume,
    setVolume: v => {
      volume = v;
      volWrites.push(v);
    },
    saveRecovery: () => {}
  });

  // Load failure must not touch volume
  loadShouldSucceed = false;
  const failRes = await gate.run('next', track(1), intentOf());
  assert.equal(failRes.spoken, false);
  assert.equal(volWrites.length, 0);
  assert.equal(volume, 0.8);

  // Load success ducks after load and restores volume afterwards
  loadShouldSucceed = true;
  const okRes = await gate.run('next', track(2), intentOf());
  assert.equal(okRes.spoken, true);
  assert.ok(volWrites.length > 0);
  assert.ok(Math.abs(volume - 0.8) < 0.01, 'Volume should restore to 0.8, got ' + volume);

  // Overlapping duck replacement keeps true original volume (0.8)
  const first = gate.run('next', track(3), intentOf());
  await new Promise(r => setTimeout(r, 150));
  const second = gate.run('direction', track(4), intentOf());
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.cancelled, true);
  assert.equal(r2.spoken, true);
  assert.ok(Math.abs(volume - 0.8) < 0.01, 'Replaced duck should restore to 0.8, got ' + volume);
  n.dispose();
});
