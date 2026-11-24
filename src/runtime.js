const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 0 7-7M7 15V9h3"/></svg>';
const esc = x =>
  String(x || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const imageURL = uri => (uri?.startsWith('spotify:image:') ? `https://i.scdn.co/image/${uri.split(':').pop()}` : uri);

let bootTries = 0;
async function boot() {
  const S = root.Spicetify;
  const needs = {
    Player: S?.Player?.data,
    CosmosAsync: S?.CosmosAsync,
    'Platform.LocalStorageAPI': S?.Platform?.LocalStorageAPI
  };
  const missing = Object.keys(needs).filter(k => !needs[k]);
  if (missing.length) {
    if (++bootTries === 120) {
      try {
        S?.showNotification?.(
          'POOR DJ no pudo iniciarse: tu Spicetify no ofrece ' +
            missing.join(', ') +
            '. Actualiza Spicetify y reinicia Spotify.',
          true
        );
      } catch (_) {}
    }
    if (bootTries <= 120) setTimeout(boot, 500);
    return;
  }
  if (root.PoorDJ?.version === VERSION) return;
  if (root.PoorMansDJ) {
    S.showNotification?.('POOR DJ: elimina la instalación duplicada y reinicia Spotify.', true);
    return;
  }

  const storage = S.Platform.LocalStorageAPI;
  const requests = new RequestCache();
  const library = new MusicLibrary(S.Platform, requests);
  let audioSaved = {};
  try {
    audioSaved = storage.getItem('poor-dj-audio-v2') || {};
  } catch (_) {}
  const audio = new AudioLibrary(
    S.getAudioData ? uri => S.getAudioData(uri) : null,
    audioSaved,
    data => storage.setItem('poor-dj-audio-v2', data)
  );

  const hashes = {
    queryArtistOverview: '9f8134ef565e78621f1e1793555bd6633c5ac144ae0f89604ed3ae3f80b3c8e6',
    searchTracks: 'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',
    searchArtists: '7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d',
    queryArtistDiscographyAll: '5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599',
    getAlbum: '6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361'
  };

  function query(name, variables) {
    return requests.get(name + JSON.stringify(variables), () => {
      if (typeof S.GraphQL?.Request !== 'function') throw Error('Spotify aún no ofrece consultas musicales');
      return S.GraphQL.Request(queryDefinition(S.GraphQL, name, hashes[name]), variables);
    });
  }

  function queue() {
    const q = S.Queue;
    if (!Array.isArray(q?.nextTracks)) return null;
    const result = { all: [], priority: [] };
    for (const t of q.nextTracks) {
      const track = normalize(t) || {
        uri: unwrap(t)?.uri,
        uid: unwrap(t)?.uid || t.uid,
        name: unwrap(t)?.metadata?.title || '',
        artists: [],
        source: 'contexto'
      };
      if (track.uri) {
        track.playlist = t.provider === 'context' && /^spotify:playlist:/.test(S.Player.data?.context?.uri || '');
        result.all.push(track);
        if (t.provider === 'queue') result.priority.push(track);
      }
    }
    return result;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function add(tracks) {
    if (!S.Player.origin?._queue?.addToQueue) throw new Error('El control de cola no está disponible');
    const before = queue();
    if (!before) throw new Error('Cola no disponible');
    let failure;
    try {
      await S.addToQueue(tracks.map(t => ({ uri: t.uri })));
    } catch (e) {
      failure = e;
    }
    let inserted = [];
    for (let i = 0; i < 40; i++) {
      const q = queue();
      inserted = (q?.priority || []).filter(t => t.uid && !before.priority.some(b => sameEntry(t, b)));
      const remaining = inserted.slice();
      const ordered = tracks.map(t => {
        const n = remaining.findIndex(x => x.uri === t.uri);
        return n >= 0 ? remaining.splice(n, 1)[0] : null;
      });
      if (ordered.every(Boolean)) return ordered;
      await sleep(150);
    }
    const partial = inserted.filter(t => tracks.some(x => x.uri === t.uri));
    if (partial.length) await remove(partial);
    throw failure || new Error('Spotify no confirmó la inserción completa');
  }

  async function remove(tracks) {
    if (tracks.some(t => !t.uid)) throw new Error('Entrada de cola sin identificador');
    let failure;
    try {
      await S.removeFromQueue(tracks.map(reference));
    } catch (e) {
      failure = e;
    }
    for (let i = 0; i < 40; i++) {
      const q = queue();
      if (q && tracks.every(t => !q.priority.some(x => sameEntry(t, x)))) return;
      await sleep(150);
    }
    throw failure || new Error('Spotify no confirmó la retirada');
  }

  const radioCache = new Map();
  async function radio(uri) {
    if (!valid(uri)) return { tracks: [], relatedArtists: [] };
    const cached = radioCache.get(uri);
    if (cached && Date.now() - cached.at < 1800000) return cached.data;

    let tracks = [];
    let relatedArtists = [];
    try {
      const mix = await S.CosmosAsync.get(
        `https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/${encodeURIComponent(uri)}?response-format=json`
      );
      const plUri = mix?.mediaItems?.[0]?.uri;
      if (plUri && S.Platform?.PlaylistAPI?.getContents) {
        const contents = await S.Platform.PlaylistAPI.getContents(plUri, { offset: 0, limit: 100 });
        const items = contents?.items || [];
        tracks = items
          .map((item, idx) => {
            const norm = normalize(item, 'radio');
            return norm && norm.uri !== uri ? { ...norm, radioRank: idx } : null;
          })
          .filter(Boolean);
      }
    } catch (_) {}

    if (!tracks.length) {
      try {
        const apollo = await S.CosmosAsync.get(
          `https://spclient.wg.spotify.com/radio-apollo/v3/stations/${encodeURIComponent(uri)}?count=50&autoplay=true`
        );
        tracks = (apollo?.tracks || [])
          .map((item, idx) => {
            const norm = normalize(item, 'radio');
            return norm && norm.uri !== uri ? { ...norm, radioRank: idx } : null;
          })
          .filter(Boolean);
        relatedArtists = (apollo?.related_artists || []).map(a => a?.uri).filter(Boolean);
      } catch (_) {}
    }

    const data = { tracks, relatedArtists };
    if (tracks.length) {
      radioCache.set(uri, { at: Date.now(), data });
      while (radioCache.size > 40) radioCache.delete(radioCache.keys().next().value);
    }
    return data;
  }

  async function candidates(seed, settings, all, { widen = false } = {}) {
    if (engine.intent.artist) seed = { ...seed, artists: [engine.intent.artist] };
    await library.load(S.Player.data?.context?.uri || '');
    if (!engine.active) return [];

    const local = engine.knownTracks();
    const groups = [{ tracks: local, source: 'tu colección', familiar: true, trusted: widen }];
    if (engine.intent.artist) {
      groups.push({ tracks: await artistTracks(engine.intent.artist), source: 'artista actual' });
    }

    const activeSeeds = [seed, ...engine.seeds.slice(-2)].filter(
      (s, idx, arr) => s?.uri && arr.findIndex(x => x.uri === s.uri) === idx
    );
    const radioResponses = await Promise.allSettled(
      (engine.intent.artistMode === 'only' ? [] : activeSeeds.slice(0, !engine.intent.known || widen ? 2 : 1)).map(s =>
        radio(s.uri)
      )
    );
    const radioTracks = [];
    const radioArtists = new Set();
    const radioRankByUri = new Map();
    for (const res of radioResponses) {
      if (res.status !== 'fulfilled' || !res.value) continue;
      for (const aUri of res.value.relatedArtists || []) radioArtists.add(aUri);
      for (const rt of res.value.tracks || []) {
        radioTracks.push(rt);
        if (!radioRankByUri.has(rt.uri)) radioRankByUri.set(rt.uri, rt.radioRank);
        for (const a of rt.artists || []) {
          const k = artistKey(a);
          if (k) radioArtists.add(k);
        }
      }
    }
    for (const t of local) {
      if (radioRankByUri.has(t.uri)) t.radioRank = radioRankByUri.get(t.uri);
    }

    let overview;
    const artist = seed.artists?.find(a => a.uri?.startsWith('spotify:artist:'));
    if (artist) {
      try {
        overview = await query('queryArtistOverview', { uri: artist.uri, locale: '', preReleaseV2: false });
        if (!engine.intent.known) groups.push({ tracks: collect(overview, 'artista actual'), source: 'artista actual' });
      } catch (_) {}
    }

    const related = new Map();
    const seen = new WeakSet();
    function find(x, inRelated = false) {
      if (!x || typeof x !== 'object' || seen.has(x)) return;
      seen.add(x);
      if (inRelated && x.uri?.startsWith('spotify:artist:') && x.uri !== artist?.uri) related.set(x.uri, x);
      for (const [k, v] of Object.entries(x)) {
        if (v && typeof v === 'object') find(v, inRelated || /related|similar/i.test(k));
      }
    }
    find(overview);
    const allowedArtists = [...new Set([...related.keys(), ...radioArtists])];

    if (!engine.intent.known) {
      if (radioTracks.length && engine.intent.artistMode !== 'only') {
        groups.push({ tracks: radioTracks, source: 'radio', trusted: true });
      }
      const chosen = engine.intent.artistMode !== 'only' ? [...related.keys()].slice(0, 2) : [];
      const responses = await Promise.allSettled(
        chosen.map(uri => query('queryArtistOverview', { uri, locale: '', preReleaseV2: false }))
      );
      responses.forEach(r => {
        if (r.status === 'fulfilled') groups.push({ tracks: collect(r.value, 'artista relacionado'), source: 'artista relacionado' });
      });
      const name = seed.artists?.[0]?.name || '';
      if (name) {
        try {
          groups.push({
            tracks: collect(
              await query('searchTracks', {
                searchTerm: name,
                offset: 0,
                limit: 40,
                numberOfTopResults: 5,
                includeAudiobooks: false,
                includePreReleases: false,
                includeAlbumPreReleases: false
              }),
              'artista actual'
            ),
            source: 'artista actual'
          });
        } catch (_) {}
      }
    }

    const unique = affinityPool(seed, allowedArtists, groups, engine.intent, engine.tags).slice(0, 300);
    if (!engine.active) return [];

    const current = engine.current;
    if (current && typeof S.getAudioData === 'function') {
      const data = await audio.get(current.uri);
      if (engine.active && engine.current === current) current.audio = data;
    }
    unique.sort((a, b) => engine.score(b, engine.recent) - engine.score(a, engine.recent));
    const excluded = new Set([
      engine.current?.uri,
      ...(queue()?.priority || []).map(t => t.uri),
      ...engine.recent.map(t => t.uri),
      ...engine.suspended.map(t => t.uri),
      ...engine.sessionPlayed
    ]);
    let analyzed = unique.filter(
      t =>
        !excluded.has(t.uri) &&
        (settings.explicit || !t.explicit) &&
        (engine.memory[t.uri]?.vote || 0) > -1.5 &&
        Date.now() - (engine.memory[t.uri]?.lastPlayed || 0) > 7200000
    );
    if (engine.intent.artistMode === 'mix') {
      analyzed = [
        ...analyzed.filter(t => hasArtist(t, engine.intent.artist)).slice(0, 6),
        ...analyzed.filter(t => !hasArtist(t, engine.intent.artist)).slice(0, 2)
      ];
    }
    if (typeof S.getAudioData === 'function') {
      await audio.enrich(analyzed, 8);
    }
    return unique;
  }

  let saved = {};
  try {
    saved = storage.getItem('poor-dj-v3') || storage.getItem('poor-dj-v2') || storage.getItem('poor-mans-dj-v1') || {};
    if (!storage.getItem('poor-dj-v3')) storage.setItem('poor-dj-before-v3', saved);
  } catch (_) {}

  const lyrics = new LyricsProvider({
    spotify: async (id, track) => {
      const img = track.image ? imageURL(track.image) : '';
      const base = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}`;
      const q = '?format=json&vocalRemoval=false&market=from_token';
      try {
        return await S.CosmosAsync.get(img ? `${base}/image/${encodeURIComponent(img)}${q}` : base + q);
      } catch (e) {
        if (img && !/404/.test(String(e?.status || e?.message))) return S.CosmosAsync.get(base + q);
        throw e;
      }
    },
    external: async track => {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 5000);
      try {
        const p = new URLSearchParams({
          track_name: track.name,
          artist_name: track.artists[0]?.name || '',
          album_name: track.album || '',
          duration: String(Math.round((track.duration || 0) / 1000))
        });
        const r = await fetch('https://lrclib.net/api/get?' + p, { signal: c.signal });
        if (r.status === 404) return null;
        if (!r.ok) throw Error('LRCLIB ' + r.status);
        return await r.json();
      } finally {
        clearTimeout(timer);
      }
    },
    saved: (() => {
      try {
        return storage.getItem('poor-dj-lyrics-misses') || {};
      } catch (_) {
        return {};
      }
    })(),
    persist: data => {
      try {
        storage.setItem('poor-dj-lyrics-misses', data);
      } catch (_) {}
    }
  });

  let view;
  let narrator;
  let voiceGate;
  let internalPlay = false;
  let stopped = false;
  let reconcile = null;
  let progressUI = 0;

  const api = () => (typeof S.Platform.PlayerAPI?.play === 'function' ? S.Platform.PlayerAPI : S.Player.origin);

  async function play(track) {
    if (typeof api()?.play !== 'function') throw Error('Reproducción directa no disponible');
    const manual = (queue()?.priority || []).filter(t => !engine.managed.some(m => sameEntry(m, t)));
    let request;
    internalPlay = true;
    try {
      request = api().play({ uri: track.uri }, {}, {});
    } finally {
      internalPlay = false;
    }
    await request;
    for (let i = 0; i < 40; i++) {
      if (normalize(S.Player.data?.item)?.uri === track.uri) {
        const remaining = queue()?.priority || [];
        const used = new Set();
        const missing = manual.filter(t => {
          const index = remaining.findIndex((r, idx) => !used.has(idx) && r.uri === t.uri);
          if (index < 0) return true;
          used.add(index);
          return false;
        });
        if (missing.length) await add(missing);
        return;
      }
      await sleep(150);
    }
    throw Error('Spotify no confirmó la canción elegida');
  }

  async function resolve(target) {
    const data = await query('searchTracks', {
      searchTerm: [songKey(target.title), target.artist].filter(Boolean).join(' '),
      offset: 0,
      limit: 20,
      numberOfTopResults: 5,
      includeAudiobooks: false,
      includePreReleases: false,
      includeAlbumPreReleases: false
    });
    return collect(data, 'búsqueda')
      .filter(t => !target.artist || t.artists.some(a => words(a.name).includes(words(target.artist))))
      .slice(0, 6)
      .map(t => ({ ...t, evidence: library.tracks.get(t.uri)?.evidence || t.evidence }));
  }

  async function search(target) {
    const results = await Promise.allSettled([
      resolve(target),
      query('searchArtists', {
        searchTerm: target.title,
        offset: 0,
        limit: 6,
        numberOfTopResults: 5,
        includeAudiobooks: false
      })
    ]);
    return {
      tracks: results[0].status === 'fulfilled' ? results[0].value : [],
      artists: results[1].status === 'fulfilled' ? collectArtists(results[1].value) : []
    };
  }

  async function artistTracks(artist) {
    const overview = await query('queryArtistOverview', { uri: artist.uri, locale: '', preReleaseV2: false });
    const tracks = collect(overview, 'artista actual');
    try {
      const disc = await query('queryArtistDiscographyAll', { uri: artist.uri, offset: 0, limit: 12 });
      const albums = new Set();
      const seen = new WeakSet();
      let nodes = 0;
      const walk = (x, d = 0) => {
        if (!x || typeof x !== 'object' || d > 15 || seen.has(x) || nodes++ > 2000) return;
        seen.add(x);
        if (x.uri?.startsWith('spotify:album:')) albums.add(x.uri);
        for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, d + 1);
      };
      walk(disc);
      const choices = [...albums].filter((_, i) => i % 3 === 0).slice(0, 4);
      for (let i = 0; i < choices.length; i += 2) {
        const data = await Promise.allSettled(
          choices.slice(i, i + 2).map(uri => query('getAlbum', { uri, offset: 0, limit: 50, locale: '' }))
        );
        for (const r of data) {
          if (r.status === 'fulfilled') {
            const album = r.value.data?.albumUnion;
            tracks.push(
              ...collect(r.value, 'artista actual').map(t => ({
                ...t,
                image: t.image || album?.coverArt?.sources?.[0]?.url || '',
                album: t.album || album?.name || ''
              }))
            );
          }
        }
      }
    } catch (_) {}
    return [...new Map(tracks.filter(t => hasArtist(t, artist)).map(t => [t.uri, t])).values()].slice(0, 300);
  }

  async function createMix(artist, mode, tracks) {
    const P = S.Platform;
    if (!P.RootlistAPI?.createPlaylist || !P.PlaylistAPI?.add || !P.RootlistAPI?.setPublishedState) {
      throw Error('Este cliente no permite guardar una playlist privada.');
    }
    const name =
      mode === 'session'
        ? `POOR DJ · ${artist.name}`
        : `POOR DJ · ${artist.name} · ${mode === 'only' ? 'Artista' : 'Aleatorio'}`;
    const pending = storage.getItem('poor-dj-pending-mix');
    const key = artist.uri + ':' + mode;
    const uri = pending?.key === key ? pending.uri : await P.RootlistAPI.createPlaylist(name, { after: 'end' }, true);
    if (!uri?.startsWith('spotify:playlist:')) throw Error('Spotify no confirmó la creación de la playlist.');
    const planned = mixUris(pending, key, tracks, mode === 'session' ? 100 : 24);
    storage.setItem('poor-dj-pending-mix', { key, uri, name, tracks: planned });
    await P.RootlistAPI.setPublishedState(uri, false);
    const existing = await P.PlaylistAPI.getContents(uri, { offset: 0, limit: 100 });
    const present = new Set((existing.items || []).map(t => t.uri));
    const missing = planned.filter(u => !present.has(u));
    if (missing.length) await P.PlaylistAPI.add(uri, missing, { after: 'end' });
    const verify = await P.PlaylistAPI.getContents(uri, { offset: 0, limit: 100 });
    if (!planned.every(u => verify.items?.some(t => t.uri === u))) {
      throw Error('Spotify no confirmó todas las canciones de la mezcla.');
    }
    storage.setItem('poor-dj-pending-mix', null);
    return { uri, name, count: verify.items.length };
  }

  const cardDetails = async track => {
    if (!track.name || !track.artists.length) return null;
    const matches = await resolve({ title: track.name, artist: track.artists[0].name });
    const same = matches.find(t => t.uri === track.uri);
    if (same) return same;
    const exact = matches.filter(
      t =>
        songKey(t.name) === songKey(track.name) &&
        t.artists.some(a => words(a.name) === words(track.artists[0].name)) &&
        (!track.album || words(t.album) === words(track.album))
    );
    return exact.length === 1 ? exact[0] : null;
  };

  const localPlayback = () => {
    try {
      return (
        S.Platform.ConnectAPI?.getState()?.activeDevice?.isLocal === true ||
        S.Player.data?.isLocal === true ||
        S.Player.data?.device?.is_local === true
      );
    } catch (_) {
      return false;
    }
  };

  const engine = new Engine(
    {
      queue,
      candidates,
      add,
      remove,
      play,
      skip: () => S.Player.next?.(),
      resolve,
      search,
      artistTracks,
      createMix,
      cardDetails,
      known: () => library.snapshot(),
      loadKnown: (force, playlist) => library.load(S.Player.data?.context?.uri || '', force, playlist),
      beforeSessionPlay: async (track, intent) =>
        !(await voiceGate.run('start', track, intent, { resume: false, local: localPlayback() })).cancelled,
      cancelTransition: () => voiceGate?.cancel(),
      save: data => {
        try {
          storage.setItem('poor-dj-v3', data);
        } catch (_) {
          S.showNotification?.('No pude guardar tu perfil local de POOR DJ.', true);
        }
      }
    },
    saved
  );

  // Recover leftover ducked volume on boot if playback is local.
  try {
    const volRec = storage.getItem('poor-dj-volume-recovery');
    if (volRec && localPlayback() && typeof S.Player.setVolume === 'function') {
      S.Player.setVolume(clamp(volRec.volume, 0, 1));
      storage.setItem('poor-dj-volume-recovery', null);
    }
  } catch (_) {}

  const transitions = new NativeTransitions(S.Platform, storage, localPlayback);
  narrator = new Narrator(root, () => view?.update());
  narrator.enabled = engine.settings.voice;
  narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
  narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
  narrator.prefer(engine.settings.voiceName);

  const pauseMusic =
    typeof S.Platform.PlayerAPI?.pause === 'function'
      ? () => S.Platform.PlayerAPI.pause()
      : typeof S.Player.pause === 'function'
      ? () => S.Player.pause()
      : null;
  const resumeMusic =
    typeof S.Platform.PlayerAPI?.resume === 'function'
      ? () => S.Platform.PlayerAPI.resume()
      : typeof S.Player.play === 'function'
      ? () => S.Player.play()
      : null;

  voiceGate = new VoiceGate(narrator, {
    playing: () => S.Player.isPlaying(),
    uri: () => normalize(S.Player.data?.item)?.uri,
    device: () => S.Platform.ConnectAPI?.getState()?.activeDevice?.id,
    mode: () => engine.settings.voiceMode,
    duckLevel: () => engine.settings.duckLevel,
    getVolume: typeof S.Player.getVolume === 'function' ? () => S.Player.getVolume() : null,
    setVolume: typeof S.Player.setVolume === 'function' ? v => S.Player.setVolume(v) : null,
    saveRecovery: r => {
      try {
        storage.setItem('poor-dj-volume-recovery', r);
      } catch (_) {}
    },
    pause: pauseMusic
      ? async () => {
          await pauseMusic();
          for (let i = 0; i < 20 && S.Player.isPlaying(); i++) await sleep(50);
          if (S.Player.isPlaying()) throw Error('No se confirmó la pausa');
        }
      : null,
    resume: resumeMusic
  });

  const buildNarrationSeed = (track, extra = {}) => {
    if (!track) return engine.anchor || engine.current;
    const prev = engine.recent.at(-2);
    return {
      ...track,
      evidence: evidenceLabel(knownEvidence(track, engine.memory[track.uri])),
      plays: engine.memory[track.uri]?.plays || 0,
      minutes: Math.floor(engine.sessionHeardMs / 60000),
      artistsCount: engine.artistSet.size,
      styles: [...(track.styles || []), ...(engine.tags[track.uri] || [])],
      prevAudio: prev?.audio,
      prevArtist: prev?.artists?.[0]?.name || '',
      hour: new Date().getHours(),
      ...extra
    };
  };

  engine.onPrepare = (track, intent) => {
    if (!track) return;
    narrator.prepare('next', buildNarrationSeed(track), intent);
  };

  engine.onNarrate = (event, extra = {}) => {
    narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
    narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
    const c = engine.current;
    const seed =
      ['next', 'discovery', 'return', 'milestone', 'follow'].includes(event) && c
        ? buildNarrationSeed(c, extra)
        : buildNarrationSeed(engine.anchor || c, extra);
    return voiceGate.run(event, seed, engine.intent, { local: localPlayback() });
  };

  const playGuards = [...new Set([S.Platform.PlayerAPI, S.Player.origin].filter(Boolean))].map(player =>
    guardPlay(player, () => {
      if (internalPlay) return null;
      voiceGate.cancel();
      return engine.userPlay();
    })
  );

  const recovery = () => {
    try {
      return storage.getItem('poor-dj-volume-recovery');
    } catch (_) {
      return null;
    }
  };

  view = mountUI(S, engine, {
    diagnose: () => root.PoorDJ.diagnose(),
    lyrics,
    audio,
    queue,
    narrator,
    voiceGate,
    library,
    transitions,
    recovery,
    recoverVolume: () => {
      const r = recovery();
      const dev = S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
      if (r && localPlayback() && (!r.device || r.device === dev) && typeof S.Player.setVolume === 'function') {
        S.Player.setVolume(clamp(r.volume, 0, 1));
        storage.setItem('poor-dj-volume-recovery', null);
        engine.notify('Volumen anterior recuperado.');
      } else {
        engine.notify('Recupera el volumen en el dispositivo original.', true);
      }
    }
  });

  engine.save();

  const sample = () => {
    if (stopped || engine.interrupted) return;
    try {
      if (!engine.current?.name || !engine.current?.artists.length || !engine.current?.image) observe();
      engine.sample(S.Player.getProgress(), S.Player.isPlaying());
      if (Date.now() - progressUI > 5000) {
        progressUI = Date.now();
        view.update();
      }
    } catch (_) {}
  };

  const observe = () => {
    if (stopped) return;
    const track = normalize(S.Player.data?.item);
    if (!track) {
      engine.interrupted = true;
      engine.lastPosition = null;
      engine.lastWall = null;
      voiceGate.cancel();
      if (engine.active) engine.notify('Spotify está reproduciendo contenido fuera del DJ. Esperaré a la música.');
      return;
    }
    const natural = engine.interrupted;
    engine.interrupted = false;
    engine.trackChanged(track, natural ? 'natural' : false);
  };

  const paused = () => {
    voiceGate.playbackChanged();
    engine.lastPosition = null;
    engine.lastWall = null;
    view.update();
  };

  S.Player.addEventListener('songchange', observe);
  S.Player.addEventListener('onprogress', sample);
  S.Player.addEventListener('onplaypause', paused);

  let device = S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
  const reconcileQueue = () => {
    if (stopped) return;
    const nextDevice = S.Platform.ConnectAPI?.getState()?.activeDevice?.id;
    if (nextDevice !== device) {
      device = nextDevice;
      voiceGate.cancel();
      engine.commandGeneration++;
    }
    if (engine.active && !engine.busy && !engine.interrupted) {
      const q = queue();
      if (q) {
        engine.sync(q);
        engine.reconcileManual(q);
        engine.fill(false, q);
      }
    }
    autoFade();
  };

  let fadeBusy = false;
  let fadeSeconds = null;
  let fadeWarned = false;
  async function autoFade() {
    if (fadeBusy) return;
    if (!engine.active || !engine.settings.autoFade) {
      if (fadeSeconds !== null) {
        fadeBusy = true;
        fadeSeconds = null;
        try {
          await transitions.restore();
        } catch (_) {
        } finally {
          fadeBusy = false;
        }
      }
      return;
    }
    const seconds = fadePlan(engine.current?.audio, engine.preview[0]?.audio);
    if (seconds === null || seconds === fadeSeconds) return;
    fadeBusy = true;
    try {
      await transitions.apply(seconds);
      fadeSeconds = seconds;
    } catch (e) {
      fadeSeconds = seconds;
      if (!fadeWarned) {
        fadeWarned = true;
        engine.notify('Transición automática no disponible: ' + e.message, true);
      }
    } finally {
      fadeBusy = false;
    }
  }

  engine.onUpdate = () => {
    if (engine.active && !reconcile) reconcile = setInterval(reconcileQueue, 1000);
    if (!engine.active && reconcile) {
      clearInterval(reconcile);
      reconcile = null;
    }
    autoFade();
    view.update();
  };

  observe();
  const unload = () => voiceGate.cancel();
  root.addEventListener('beforeunload', unload);

  const diagnose = async () => {
    const apiOk = {
      queue: Array.isArray(S.Queue?.nextTracks) && typeof S.addToQueue === 'function',
      play: typeof (S.Platform.PlayerAPI?.play || S.Player.origin?.play) === 'function',
      audio: typeof S.getAudioData === 'function',
      playlists: !!(S.Platform.RootlistAPI?.createPlaylist && S.Platform.PlaylistAPI?.add),
      voice: !!narrator.voice,
      lyrics: typeof S.CosmosAsync?.get === 'function',
      spicy:
        !!(
          root.SpicyLyrics ||
          document.querySelector('#SpicyLyrics_PageButton') ||
          root.LyricsPlus ||
          document.querySelector('a[href="/lyrics-plus"], [data-uri="spotify:app:lyrics-plus"]') ||
          root.BeautifulLyrics ||
          document.querySelector('.BeautifulLyrics, #BeautifulLyrics, [class*="BeautifulLyrics"]')
        ) && engine.settings.lyricsProvider !== 'builtin'
    };
    const [a, b] = await Promise.allSettled([
      query('searchTracks', {
        searchTerm: 'a',
        offset: 0,
        limit: 1,
        numberOfTopResults: 1,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAlbumPreReleases: false
      }),
      query('searchArtists', {
        searchTerm: 'a',
        offset: 0,
        limit: 1,
        numberOfTopResults: 1,
        includeAudiobooks: false
      })
    ]);
    return compatReport({ api: apiOk, probes: { search: a.status === 'fulfilled', artists: b.status === 'fulfilled' } });
  };

  root.PoorDJ = {
    engine,
    diagnose,
    open: view.open,
    version: VERSION,
    audio,
    narrator,
    voiceGate,
    transitions,
    command: text => engine.command(text),
    dispose: () => {
      stopped = true;
      engine.commandGeneration++;
      engine.active = false;
      engine.generation++;
      engine.cancelLookup?.();
      clearInterval(reconcile);
      playGuards.forEach(undo => undo());
      voiceGate.cancel();
      narrator.dispose();
      audio.dispose();
      requests.dispose();
      library.dispose();
      for (const [event, fn] of [
        ['songchange', observe],
        ['onprogress', sample],
        ['onplaypause', paused]
      ]) {
        S.Player.removeEventListener?.(event, fn);
      }
      root.removeEventListener('beforeunload', unload);
      view.dispose();
    }
  };
  root.PoorMansDJ = root.PoorDJ;
}
boot();
