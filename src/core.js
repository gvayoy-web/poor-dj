const VERSION = '4.0.0';
const clamp = (n, a = 0, b = 100) => Math.min(b, Math.max(a, Number(n) || 0));
const valid = uri => /^spotify:track:[A-Za-z0-9]{22}$/.test(uri || '');
const unwrap = x => x?.contextTrack || x?.track?.data || x?.track || x?.item?.data || x?.item || x;
const artistKey = a => a.uri || String(a.name || '').toLowerCase();

function normalize(input, source = 'contexto') {
  const x = unwrap(input);
  const m = x?.metadata || {};
  if (!valid(x?.uri) || x.is_playable === false || x.isPlayable === false || x.playability?.playable === false) {
    return null;
  }
  const items = x.artists?.items || x.artists || [];
  const artists = Array.isArray(items)
    ? items.map(a => ({ uri: a.uri, name: a.profile?.name || a.name || '' })).filter(a => a.name)
    : [];
  if (!artists.length && m.artist_name) {
    artists.push({ uri: m.artist_uri, name: m.artist_name });
    for (let i = 1; i < 12 && m['artist_name:' + i]; i++) {
      artists.push({ uri: m['artist_uri:' + i], name: m['artist_name:' + i] });
    }
  }
  const album = x.albumOfTrack || x.album || {};
  const albumImage =
    album.coverArt?.sources?.at(-1)?.url ||
    album.coverArt?.sources?.[0]?.url ||
    album.images?.find?.(i => i.label === 'large')?.url ||
    album.images?.[0]?.url ||
    '';
  return {
    uri: valid(m.requested_uri) ? m.requested_uri : x.uri,
    uid: x.uid || input?.uid,
    name: x.name || m.title || '',
    artists,
    image: x.image || albumImage || x.images?.[0]?.url || x.images?.sources?.[0]?.url || m.image_url || '',
    source,
    album: typeof album === 'string' ? album : album.name || m.album_title || '',
    duration:
      x.duration_ms ||
      x.duration?.totalMilliseconds ||
      x.duration?.milliseconds ||
      (typeof x.duration === 'number' ? x.duration : 0) ||
      Number(m.duration) ||
      0,
    styles: Array.isArray(x.styles) ? x.styles.filter(t => typeof t === 'string').slice(0, 5) : [],
    playlist: !!x.playlist,
    evidence: Array.isArray(x.evidence) ? x.evidence.slice(0, 3) : [],
    explicit:
      x.explicit === true ||
      x.isExplicit === true ||
      x.contentRating?.label === 'EXPLICIT' ||
      m.is_explicit === 'true'
  };
}

function collect(data, source) {
  const found = new Map();
  const visited = new WeakSet();
  let nodes = 0;
  function walk(x, depth) {
    if (!x || typeof x !== 'object' || depth > 16 || visited.has(x) || nodes >= 6000 || found.size >= 300) return;
    nodes++;
    visited.add(x);
    const t = normalize(x, source);
    if (t?.name && t.artists.length) {
      const previous = found.get(t.uri);
      found.set(
        t.uri,
        previous
          ? {
              ...t,
              image: t.image || previous.image,
              album: t.album || previous.album,
              duration: t.duration || previous.duration,
              artists: t.artists.length >= previous.artists.length ? t.artists : previous.artists
            }
          : t
      );
    }
    for (const v of Object.values(x)) {
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  }
  walk(data, 0);
  return [...found.values()];
}

const DEFAULTS = {
  discovery: 35,
  diversity: 25,
  takeover: false,
  queueSize: 3,
  accent: 'spotify',
  compact: false,
  mini: true,
  explicit: true,
  autoLearn: true,
  continuity: 65,
  flowStrength: 65,
  voice: true,
  voiceMode: 'duck',
  duckLevel: 30,
  voiceVolume: 90,
  voiceSpeed: 100,
  onManual: 'follow',
  skipRepeats: true,
  lyrics: true,
  lyricsExternal: false,
  lyricsProvider: 'auto',
  lyricsSize: 'm',
  lyricsOffset: 0,
  ambient: true,
  talk: 'few',
  voiceName: '',
  autoFade: false
};

function settingsOf(value = {}) {
  const s = Object.fromEntries(Object.entries(DEFAULTS).map(([key, def]) => [key, value[key] ?? def]));
  if (!['spotify', 'theme', 'blue', 'violet', 'rose'].includes(s.accent)) s.accent = 'spotify';
  for (const key of ['discovery', 'diversity', 'continuity', 'flowStrength']) s[key] = clamp(s[key]);
  s.queueSize = Math.round(clamp(s.queueSize, 2, 5));
  s.duckLevel = Math.round(clamp(s.duckLevel, 10, 80));
  s.voiceVolume = Math.round(clamp(s.voiceVolume, 0, 100));
  s.voiceSpeed = Math.round(clamp(s.voiceSpeed, 70, 140));
  if (!['follow', 'pause'].includes(s.onManual)) s.onManual = 'follow';
  if (!['duck', 'pause'].includes(s.voiceMode)) s.voiceMode = 'duck';
  if (!['auto', 'builtin'].includes(s.lyricsProvider)) s.lyricsProvider = 'auto';
  if (!['s', 'm', 'l'].includes(s.lyricsSize)) s.lyricsSize = 'm';
  if (!['start', 'few', 'often'].includes(s.talk)) s.talk = 'few';
  s.voiceName = typeof s.voiceName === 'string' ? s.voiceName.slice(0, 120) : '';
  s.lyricsOffset = Math.round(clamp(s.lyricsOffset, -3000, 3000) / 50) * 50;
  for (const key of [
    'takeover',
    'compact',
    'mini',
    'explicit',
    'autoLearn',
    'voice',
    'skipRepeats',
    'lyrics',
    'lyricsExternal',
    'ambient',
    'autoFade'
  ]) {
    if (typeof s[key] !== 'boolean') s[key] = DEFAULTS[key];
  }
  return s;
}

const reference = t => ({ uri: t.uri, uid: t.uid });
const sameEntry = (a, b) => !!a?.uid && !!b?.uid && a.uid === b.uid && a.uri === b.uri;

class Engine {
  constructor(io, saved = {}) {
    saved = migrateProfile(saved);
    this.io = io;
    this.settings = settingsOf(saved.settings);
    this.intent = intentOf(saved.intent);
    this.contexts = saved.contexts;
    this.tags = saved.tags;
    this.taste = saved.taste || { artists: {} };
    this.memory = saved.memory && typeof saved.memory === 'object' ? saved.memory : {};
    this.preferences = saved.preferences && typeof saved.preferences === 'object' ? saved.preferences : {};
    this.suspended = Array.isArray(saved.recovery?.suspended) ? saved.recovery.suspended.filter(t => t?.uri) : [];
    this.managed = Array.isArray(saved.recovery?.managed) ? saved.recovery.managed.filter(t => t?.uri && t?.uid) : [];
    this.captured = !!saved.recovery?.captured;
    this.restoreJournal = saved.recovery?.restoreJournal || null;
    this.mixPlaylist = saved.mixPlaylist;

    this.sessionExcluded = new Set();
    this.artistExcluded = new Set();
    this.sessionPlayed = new Set();
    this.sessionIds = new Set();
    this.deck = new ChoiceDeck();
    this.sessionPlaylist = [];
    this.lastWall = null;
    this.heardCommitted = false;
    this.onNarrate = () => {};
    this.onPrepare = () => {};
    this.onUpdate = () => {};
    this.commandChoices = [];
    this.commandGeneration = 0;

    this.active = false;
    this.busy = false;
    this.flight = null;
    this.poolRefreshFlight = null;
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.generation = 0;
    this.recent = [];
    this.current = null;
    this.anchor = null;
    this.preview = [];
    this.pinned = null;
    this.undoVote = null;
    this.sessionList = [];
    this.sessionHeardMs = 0;
    this.discoveries = 0;
    this.artistSet = new Set();
    this.libraryArtistCounts = new Map();
    this.pool = null;
    this.seeds = [];
    this.followNext = false;
    this.autoSkips = 0;
    this.autoSkipping = false;
    this.knownManual = [];
    this.manualFingerprint = '';
    this.manualFlight = null;
    this.queuePlan = [];
    this.initialManual = [];
    this.yieldFlight = null;
    this.observedMs = 0;
    this.lastPosition = null;
    this.feedbackGiven = false;
    this.lastAttempt = 0;
    this.failures = 0;
    this.played = 0;
    this.nextTalkAt = 0;
    this.lastTalkPlayed = -10;
    this.lastMilestone = 0;
    this.status =
      this.captured || this.managed.length
        ? 'Tienes una sesión anterior pendiente de restaurar.'
        : 'Reproduce una canción y activa el DJ.';
    this.error = false;
    this.commandArtists = [];
    this.artistMenu = null;
  }

  save() {
    const entries = Object.entries(this.memory);
    if (entries.length > 1000) {
      this.memory = Object.fromEntries(
        entries
          .sort(
            (a, b) =>
              Math.max(b[1]?.lastPlayed || 0, b[1]?.dismissedAt || 0, b[1]?.lastSuggested || 0) -
              Math.max(a[1]?.lastPlayed || 0, a[1]?.dismissedAt || 0, a[1]?.lastSuggested || 0)
          )
          .slice(0, 1000)
      );
    }
    while (Object.keys(this.tags).length > 1000) {
      delete this.tags[Object.keys(this.tags)[0]];
    }
    const artistEntries = Object.entries(this.taste?.artists || {});
    if (artistEntries.length > 800) {
      this.taste.artists = Object.fromEntries(
        artistEntries.sort((a, b) => (b[1]?.last || 0) - (a[1]?.last || 0)).slice(0, 800)
      );
    }
    this.io.save({
      schema: 4,
      settings: this.settings,
      intent: this.intent,
      memory: this.memory,
      preferences: this.preferences,
      contexts: this.contexts,
      tags: this.tags,
      taste: this.taste,
      mixPlaylist: this.mixPlaylist,
      recovery: {
        captured: this.captured,
        suspended: this.suspended,
        managed: this.managed,
        restoreJournal: this.restoreJournal
      }
    });
  }

  notify(text, error = false) {
    this.status = text;
    this.error = error;
    this.onUpdate();
  }

  nextTalkSpacing() {
    if (this.settings.talk === 'often') return this.played + 2 + Math.floor(Math.random() * 2);
    if (this.settings.talk === 'few') return this.played + 4 + Math.floor(Math.random() * 3);
    return Infinity;
  }

  poolKey() {
    const i = this.intent;
    return JSON.stringify([
      this.anchor?.uri || '',
      i.known,
      i.artist?.uri || '',
      i.artistMode || '',
      i.styles,
      i.excludedArtists,
      this.settings.discovery,
      this.seeds.map(s => s.uri)
    ]);
  }

  addSeed(track) {
    if (!track || !valid(track.uri)) return;
    this.seeds = [...this.seeds.filter(s => s.uri !== track.uri), reference(track)].slice(-5);
  }

  updateArtistTaste(track, delta, { play = false, skip = false } = {}) {
    if (!track?.artists?.length) return;
    this.taste ||= { artists: {} };
    this.taste.artists ||= {};
    const now = Date.now();
    for (const a of track.artists.slice(0, 3)) {
      const key = artistKey(a);
      if (!key) continue;
      const prev = this.taste.artists[key] || {
        name: a.name || '',
        uri: a.uri || '',
        score: 0,
        plays: 0,
        skips: 0,
        last: now
      };
      this.taste.artists[key] = {
        name: a.name || prev.name,
        uri: a.uri || prev.uri,
        score: clamp((prev.score || 0) + delta, -10, 15),
        plays: (prev.plays || 0) + (play ? 1 : 0),
        skips: (prev.skips || 0) + (skip ? 1 : 0),
        last: now
      };
    }
  }

  userPlay() {
    this.commandGeneration++;
    this.choosing = false;
    this.commandChoices = [];
    this.commandArtists = [];
    this.artistMenu = null;
    if (!this.active && !this.managed.length) return null;
    if (this.active && this.settings.onManual === 'follow') {
      this.followNext = true;
      return null;
    }
    return this.yieldToUser();
  }

  async start(seed = this.current, narrated = false, overlay = false) {
    if (this.active || this.busy) return;
    if (!this.current) {
      this.notify('Primero reproduce una canción de Spotify.', true);
      return;
    }
    if (this.captured || this.managed.length) {
      await this.stop();
      if (this.captured || this.managed.length) return;
    }
    this.active = true;
    this.sessionOverlay = overlay;
    this.anchor = seed;
    this.intent.reference = reference(seed);
    this.sessionExcluded.clear();
    this.artistExcluded.clear();
    this.sessionPlayed = new Set([this.current.uri]);
    this.sessionIds = new Set([songIdentity(this.current)]);
    this.pool = null;
    this.seeds = [];
    this.refillAfter = false;
    this.followNext = false;
    this.autoSkips = 0;
    this.autoSkipping = false;
    this.generation++;
    this.lastAttempt = 0;
    this.failures = 0;
    this.played = 0;
    this.lastTalkPlayed = 0;
    this.lastMilestone = 0;
    this.nextTalkAt = this.nextTalkSpacing();
    this.recent = [this.current];
    this.pinned = null;
    this.sessionList = [];
    this.sessionHeardMs = 0;
    this.discoveries = 0;
    this.artistSet = new Set(this.current.artists.map(artistKey));
    this.manualFingerprint = '';
    this.queuePlan = [];
    this.knownManual = (this.io.queue()?.priority || []).map(reference);
    this.initialManual = this.knownManual.slice();
    this.save();
    this.notify('Preparando tu sesión…');
    if (!narrated) {
      Promise.resolve(this.onNarrate('start')).catch(() => {});
    }
    if (this.active) await this.fill();
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.finishStop().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  async finishStop() {
    const wasActive = this.active;
    this.io.cancelTransition?.();
    this.pinned = null;
    this.active = false;
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.followNext = false;
    this.generation++;
    this.notify('Devolviendo el control a Spotify…');
    this.cancelLookup?.();
    if (this.flight) await this.flight;
    if (this.manualFlight) await this.manualFlight;
    if (this.yieldFlight) await this.yieldFlight;
    this.busy = true;
    this.onUpdate();
    try {
      const q = this.io.queue();
      if (!q) throw new Error('La cola no está disponible. Intenta restaurarla de nuevo.');
      const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
      const originalStillPresent = q.priority.filter(t => this.suspended.some(m => sameEntry(m, t)));
      const cleanup = [...ours, ...originalStillPresent];
      if (cleanup.length) await this.io.remove(cleanup);
      this.managed = [];
      this.preview = [];
      this.save();
      if (this.suspended.length) {
        const pending = this.suspended.slice();
        while (this.suspended.length) {
          if (this.restoreJournal) {
            const live = this.io.queue();
            if (!live) throw Error('No se puede confirmar la restauración');
            const restored = live.priority.filter(
              t => t.uri === this.restoreJournal.uri && !this.restoreJournal.before.includes(t.uid)
            );
            if (restored.length > 1) {
              throw Error('Restauración ambigua: conserva tu cola y reintenta después de revisar sus duplicados');
            }
            if (restored.length === 1) {
              this.suspended.shift();
              this.restoreJournal = null;
              this.save();
              continue;
            }
          }
          this.restoreJournal = {
            uri: this.suspended[0].uri,
            before: (this.io.queue()?.priority || []).map(t => t.uid)
          };
          this.save();
          await this.io.add([this.suspended[0]]);
          this.suspended.shift();
          this.restoreJournal = null;
          this.save();
        }
        this.notify(`Sesión terminada. ${pending.length} canciones de tu cola restauradas.`);
      } else {
        this.notify('Sesión terminada. Spotify continúa con tu playlist.');
      }
      this.captured = false;
      this.sessionExcluded.clear();
      this.artistExcluded.clear();
      this.save();
      if (wasActive && this.played > 0) {
        Promise.resolve(this.onNarrate('end')).catch(() => {});
      }
    } catch (e) {
      this.notify(`No pude restaurar toda la cola: ${e.message}`, true);
      this.save();
    } finally {
      this.busy = false;
      this.onUpdate();
    }
  }

  async saveSession() {
    const tracks = [...new Map(this.sessionList.filter(t => valid(t.uri)).map(t => [t.uri, t])).values()];
    if (tracks.length < 2) {
      this.notify('Aún hay pocas canciones para guardar la sesión.', true);
      return;
    }
    if (!this.io.createMix) {
      this.notify('Este cliente no permite guardar playlists.', true);
      return;
    }
    this.sessionStamp ||= Date.now();
    try {
      this.notify('Guardando la sesión como playlist privada…');
      const label =
        new Date(this.sessionStamp).toLocaleDateString('es', { day: 'numeric', month: 'short' }) +
        ' ' +
        new Date(this.sessionStamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const saved = await this.io.createMix(
        { uri: 'session:' + this.sessionStamp, name: 'Sesión ' + label },
        'session',
        tracks
      );
      this.mixPlaylist = saved;
      this.sessionStamp = null;
      this.save();
      this.notify('Sesión guardada: ' + saved.name);
    } catch (e) {
      this.notify(e.message || 'No pude guardar la sesión.', true);
    } finally {
      this.onUpdate();
    }
  }

  updateSettings(patch, rebuild = true) {
    const old = this.settings;
    this.settings = settingsOf({ ...old, ...patch });
    if (this.active) this.settings.takeover = old.takeover;
    if (patch.discovery !== undefined) this.intent.known = this.settings.discovery === 0;
    if (patch.diversity !== undefined) this.intent.variety = this.settings.diversity;
    if (patch.talk !== undefined) this.nextTalkAt = this.nextTalkSpacing();
    if (rebuild) this.pool = null;
    this.save();
    if (rebuild) {
      this.generation++;
      this.lastAttempt = 0;
      this.cancelLookup?.();
    }
    this.notify(this.active && rebuild ? 'Actualizando las siguientes canciones…' : 'Preferencias guardadas.');
    if (this.active && rebuild) return this.fill(true);
  }

  feedback(amount) {
    return this.feedbackFor(this.current, amount > 0 ? 'more' : 'less');
  }

  feedbackFor(track, kind) {
    if (!track) return;
    const key = contextKey(this.anchor || this.current, this.intent);
    this.undoVote = {
      uri: track.uri,
      memory: this.memory[track.uri] ? { ...this.memory[track.uri] } : null,
      contexts: JSON.parse(JSON.stringify(this.contexts)),
      taste: JSON.parse(JSON.stringify(this.taste)),
      anchor: this.anchor,
      intent: JSON.parse(JSON.stringify(this.intent)),
      sessionExcluded: [...this.sessionExcluded],
      artistExcluded: [...this.artistExcluded],
      given: this.feedbackGiven
    };
    this.feedbackGiven = true;
    if (kind === 'more') {
      this.anchor = track;
      this.intent.reference = reference(track);
      this.addSeed(track);
      this.pool = null;
      this.adjust(track, 1);
      this.updateArtistTaste(track, 1);
      this.onNarrate('direction');
    } else {
      this.sessionExcluded.add(track.uri);
      const m = (this.memory[track.uri] ||= { plays: 0, vote: 0, heard: 0 });
      m.dismissedAt = Date.now();
      if (kind === 'artist') {
        track.artists.forEach(a => this.artistExcluded.add(artistKey(a)));
        this.updateArtistTaste(track, -2);
      } else {
        this.updateArtistTaste(track, -0.5);
      }
      const c = (this.contexts[key] ||= { votes: {} });
      c.votes[track.uri] = clamp((c.votes[track.uri] || 0) - 1, -5, 5);
      this.save();
    }
    this.notify(
      kind === 'more'
        ? 'La canción actual guía esta sesión.'
        : kind === 'artist'
        ? 'Este artista queda fuera de la sesión.'
        : kind === 'repeat'
        ? 'No volverá a proponerse en esta sesión.'
        : 'Anotado: esta propuesta no encaja.'
    );
    return this.refresh();
  }

  undoFeedback() {
    const u = this.undoVote;
    if (!u) return;
    if (u.memory) this.memory[u.uri] = u.memory;
    else delete this.memory[u.uri];
    this.contexts = u.contexts;
    if (u.taste) this.taste = u.taste;
    this.anchor = u.anchor;
    this.intent = intentOf(u.intent);
    this.sessionExcluded = new Set(u.sessionExcluded);
    this.artistExcluded = new Set(u.artistExcluded);
    this.feedbackGiven = u.given;
    this.undoVote = null;
    this.pool = null;
    this.save();
    this.notify('Corrección deshecha.');
    return this.refresh();
  }

  refresh() {
    this.generation++;
    this.cancelLookup?.();
    this.lastAttempt = 0;
    if (this.active) return this.fill(true);
    return Promise.resolve();
  }

  reserve(t) {
    if (!t || !this.preview.some(x => sameEntry(x, t))) return;
    this.pinned = this.pinned && sameEntry(this.pinned, t) ? null : reference(t);
    this.notify(this.pinned ? 'Canción reservada: se conserva al renovar.' : 'Reserva liberada.');
  }

  adjust(t, amount) {
    const m = (this.memory[t.uri] ||= { plays: 0, vote: 0, heard: 0 });
    m.vote = clamp((m.vote || 0) + amount, -5, 5);
    if (m.vote > 0) {
      m.track = {
        uri: t.uri,
        name: t.name,
        artists: t.artists.slice(0, 10),
        image: t.image || '',
        duration: t.duration || 0,
        explicit: !!t.explicit
      };
    }
    const key = contextKey(this.anchor || this.current, this.intent);
    const context = (this.contexts[key] ||= { votes: {} });
    context.votes[t.uri] = clamp((context.votes[t.uri] || 0) + amount, -5, 5);
    while (Object.keys(this.contexts).length > 40) {
      delete this.contexts[Object.keys(this.contexts)[0]];
    }
    this.save();
  }

  sample(position, playing, wall = Date.now()) {
    if (playing && this.current && this.lastPosition !== null && this.lastWall !== null) {
      const delta = position - this.lastPosition;
      const elapsed = wall - this.lastWall;
      if (delta > 0 && elapsed > 0 && delta <= 6000 && delta <= elapsed + 800) {
        this.observedMs += delta;
        if (this.active) this.sessionHeardMs += delta;
        const threshold = Math.min(60000, this.current.duration > 0 ? this.current.duration * 0.7 : 60000);
        if (!this.heardCommitted && this.observedMs >= threshold) {
          const m = (this.memory[this.current.uri] ||= { plays: 0, vote: 0, heard: 0 });
          m.heard = (m.heard || 0) + 1;
          m.plays = (m.plays || 0) + 1;
          m.lastPlayed = Date.now();
          m.track = { ...this.current, audio: undefined };
          this.heardCommitted = true;
          this.save();
        }
      }
    }
    this.lastPosition = position;
    this.lastWall = wall;
  }

  trackChanged(track, ownSkip = false) {
    if (track?.uri && track.uri === this.current?.uri) {
      if (
        track &&
        ((!this.current.name && track.name) ||
          (!this.current.artists.length && track.artists.length) ||
          (!this.current.image && track.image))
      ) {
        this.current = { ...this.current, ...track, audio: this.current.audio };
        this.recent = this.recent.map(t => (t.uri === track.uri ? this.current : t));
        this.sessionList = this.sessionList.map(t => (t.uri === track.uri ? this.current : t));
        if (this.memory[track.uri]) this.memory[track.uri].track = { ...this.current, audio: undefined };
        if (this.active) {
          track.artists.forEach(a => this.artistSet.add(artistKey(a)));
          this.sessionIds.add(songIdentity(this.current));
        }
        this.onUpdate();
      }
      return;
    }

    const prev = this.current;
    const wasFollow = this.followNext;
    this.followNext = false;
    const wasAutoSkipping = this.autoSkipping;
    this.autoSkipping = false;

    const expected =
      this.expectedNext && (track?.uid ? sameEntry(this.expectedNext, track) : this.expectedNext.uri === track?.uri);
    const wasManaged =
      this.active &&
      track &&
      (expected || this.managed.some(m => (track.uid ? sameEntry(m, track) : m.uri === track.uri)));
    const endedNaturally =
      ownSkip === 'natural' || (prev?.duration > 0 && this.lastPosition !== null && this.lastPosition >= prev.duration - 2500);
    this.expectedNext = null;

    if (prev && this.active && this.settings.autoLearn && !this.feedbackGiven && !wasAutoSkipping && !wasFollow && !ownSkip) {
      const ratio = prev.duration ? this.observedMs / prev.duration : 0;
      if (ratio >= 0.7) {
        this.adjust(prev, 0.2);
        this.updateArtistTaste(prev, 1, { play: true });
        this.addSeed(prev);
      } else if (track && !endedNaturally && this.observedMs >= 1500 && this.observedMs < 30000) {
        this.adjust(prev, -0.5);
        this.updateArtistTaste(prev, -0.5, { skip: true });
      } else if (track && !endedNaturally && this.observedMs >= 30000 && this.observedMs < 60000) {
        this.adjust(prev, -0.15);
      }
    }

    this.current = track;
    this.observedMs = 0;
    this.lastPosition = null;
    this.lastWall = null;
    this.heardCommitted = false;
    this.feedbackGiven = false;
    this.undoVote = null;
    if (this.pinned?.uri === track?.uri) this.pinned = null;

    if (!track || !this.active) {
      this.onUpdate();
      return;
    }

    if (ownSkip === true) this.anchor = track;

    if (wasFollow) {
      this.anchor = track;
      this.intent.reference = reference(track);
      this.seeds = [];
      this.pool = null;
      this.generation++;
      this._recordActiveTrack(track);
      this.managed = this.managed.filter(t => t.uri !== track.uri);
      this.preview = this.preview.filter(t => t.uri !== track.uri);
      this.save();
      Promise.resolve(this.onNarrate('follow')).catch(() => {});
      this.lastTalkPlayed = this.played;
      this.nextTalkAt = this.nextTalkSpacing();
      this.refresh();
      this.onUpdate();
      return;
    }

    const isManualEntry = this.knownManual.some(m => (track.uid ? sameEntry(m, track) : m.uri === track.uri));
    if (
      !wasManaged &&
      !isManualEntry &&
      this.settings.skipRepeats &&
      (this.sessionPlayed.has(track.uri) || this.sessionIds.has(songIdentity(track)) || !this.eligible(track)) &&
      this.autoSkips < 3 &&
      typeof this.io.skip === 'function'
    ) {
      this.autoSkips++;
      this.autoSkipping = true;
      Promise.resolve(this.io.skip()).catch(() => {
        this.autoSkipping = false;
      });
      this.onUpdate();
      return;
    }

    this.autoSkips = 0;
    const prevMem = this.memory[track.uri];
    const isDiscovery = !prevMem;
    const daysSince = prevMem?.lastPlayed ? Math.floor((Date.now() - prevMem.lastPlayed) / 86400000) : 0;
    const isReturn = !isDiscovery && daysSince >= 30 && ((prevMem?.heard || 0) > 0 || (prevMem?.plays || 0) > 0);

    this._recordActiveTrack(track);

    const milestone = Math.floor(this.sessionHeardMs / 1800000);
    if (this.played >= this.nextTalkAt) {
      Promise.resolve(this.onNarrate('next')).catch(() => {});
      this.lastTalkPlayed = this.played;
      this.nextTalkAt = this.nextTalkSpacing();
    } else if (this.settings.talk !== 'start' && this.played - this.lastTalkPlayed >= 2) {
      if (isDiscovery && this.discoveries === 1) {
        Promise.resolve(this.onNarrate('discovery')).catch(() => {});
        this.lastTalkPlayed = this.played;
      } else if (isReturn) {
        Promise.resolve(this.onNarrate('return', { daysSince })).catch(() => {});
        this.lastTalkPlayed = this.played;
      } else if (milestone > this.lastMilestone && milestone > 0) {
        this.lastMilestone = milestone;
        Promise.resolve(this.onNarrate('milestone')).catch(() => {});
        this.lastTalkPlayed = this.played;
      }
    }

    this.managed = this.managed.filter(t => t.uri !== track.uri);
    this.preview = this.preview.filter(t => t.uri !== track.uri);
    this.save();
    this.fill();
    this.onUpdate();
  }

  _recordActiveTrack(track) {
    this.recent.push(track);
    this.recent = this.recent.slice(-50);
    this.sessionPlayed.add(track.uri);
    this.sessionIds.add(songIdentity(track));
    this.played++;
    if (!this.memory[track.uri]) this.discoveries++;
    const m = (this.memory[track.uri] ||= { plays: 0, vote: 0, heard: 0 });
    m.lastStarted = Date.now();
    m.track = {
      uri: track.uri,
      name: track.name,
      artists: track.artists,
      image: track.image || '',
      duration: track.duration || 0,
      explicit: !!track.explicit
    };
    track.artists.forEach(a => this.artistSet.add(artistKey(a)));
    this.sessionList.push({ ...track });
    this.sessionList = this.sessionList.slice(-100);
  }

  score(t, recent) {
    const m = this.memory[t.uri];
    let score =
      ({
        'artista relacionado': 45,
        'artista actual': 75,
        radio: 68,
        contexto: 80,
        'tu colección': 80
      })[t.source] || 0;
    const known = knownEvidence(t, m).length > 0;
    score += known ? (100 - this.settings.discovery) * 0.35 : this.settings.discovery * 0.2;
    const vote = this.contexts[contextKey(this.anchor || this.current, this.intent)]?.votes?.[t.uri] || 0;
    score += clamp(vote, -2, 2) * 6;
    const keys = new Set(t.artists.map(artistKey));
    if (this.intent.artist && hasArtist(t, this.intent.artist)) score += 100;
    recent.slice(-4).forEach(r => {
      if (r.artists.some(a => keys.has(artistKey(a)))) score -= this.settings.diversity * 0.025;
    });

    const primaryKey = t.artists?.[0] ? artistKey(t.artists[0]) : '';
    const artistTaste = primaryKey ? this.taste?.artists?.[primaryKey]?.score || 0 : 0;
    score += clamp(artistTaste, -5, 10) * 4;
    const libCount = primaryKey && this.libraryArtistCounts ? this.libraryArtistCounts.get(primaryKey) || 0 : 0;
    score += Math.min(8, libCount);
    if (Number.isFinite(t.radioRank)) score += Math.max(0, 50 - t.radioRank) * 0.4;

    const ageMs = m?.lastPlayed ? Date.now() - m.lastPlayed : Infinity;
    if (ageMs < 6 * 3600000) score -= 40;
    else if (ageMs < 24 * 3600000) score -= 20;
    else if (ageMs < 72 * 3600000) score -= 8;

    if (!this.intent.known && this.settings.discovery > 0 && this.settings.discovery < 100 && recent.length) {
      const window6 = recent.slice(-6);
      const newShare = window6.filter(r => !this.memory[r.uri]?.heard && !r.familiar).length / window6.length;
      const targetShare = this.settings.discovery / 100;
      const isNewTrack = !known && !m?.heard;
      if (isNewTrack && newShare < targetShare) score += 15;
      else if (!isNewTrack && newShare > targetShare) score += 15;
    }

    const from = recent.at(-1) || this.current;
    const comp = transitionFit(from?.audio, t.audio);
    if (comp.value !== null) score += (comp.value - 0.5) * this.settings.flowStrength * 0.6 * comp.coverage;
    if (comp.tempo !== null && comp.tempo > 0.25) score -= (10 * this.settings.flowStrength) / 65;
    if (comp.loudness !== null && comp.loudness > 8) score -= (6 * this.settings.flowStrength) / 65;
    return score;
  }

  reason(t, from) {
    const evidence = knownEvidence(t, this.memory[t.uri]);
    if (evidence.length) return evidenceLabel(evidence);
    if ((this.memory[t.uri]?.vote || 0) > 0) return 'Por tu voto · Más así';
    const c = compatibility(from?.audio, t.audio);
    if (c.value >= 0.7 && c.coverage >= 0.6) return 'Tempo y tono compatibles';
    if (t.source === 'radio') return 'Radio de Spotify · afín';
    if (t.source === 'artista relacionado') return 'Artista relacionado';
    if (!this.memory[t.uri]) return 'Nueva para ti';
    return 'Afinidad con esta sesión';
  }

  select(candidates, queued, count, { relaxed = false } = {}) {
    const now = Date.now();
    const blockedUris = new Set(
      [
        this.current?.uri,
        ...queued.map(t => t.uri),
        ...this.recent.map(t => t.uri),
        ...this.suspended.map(t => t.uri),
        ...this.sessionPlayed
      ].filter(Boolean)
    );
    const blockedIds = new Set(
      [
        ...[this.current, ...queued, ...this.recent].filter(Boolean).map(songIdentity),
        ...this.sessionIds
      ].filter(id => id && id !== '|')
    );
    const suggestWindow = relaxed ? 3600000 : 6 * 3600000;

    const byId = new Map();
    const recentBase = [...this.recent, ...queued];
    for (const t of candidates.slice(0, 300)) {
      if (!t || t.affinity !== true || !valid(t.uri) || blockedUris.has(t.uri)) continue;
      const id = songIdentity(t);
      if (id && id !== '|' && blockedIds.has(id)) continue;
      if (this.intent.known && !isKnown(t, this.memory[t.uri])) continue;
      if (!this.eligible(t)) continue;
      const m = this.memory[t.uri];
      if (!relaxed && m?.lastPlayed && now - m.lastPlayed < 2 * 3600000) continue;
      if (!relaxed && (m?.vote || 0) <= -1.5) continue;
      if (now - (m?.dismissedAt || m?.lastSuggested || 0) <= suggestWindow) continue;

      const dedupeKey = id && id !== '|' ? id : t.uri;
      const prev = byId.get(dedupeKey);
      if (!prev || this.score(t, recentBase) > this.score(prev, recentBase)) {
        byId.set(dedupeKey, t);
      }
    }

    const pool = [...byId.values()];
    const result = [];
    const recent = [...recentBase];
    const spacing = this.intent.variety >= 60 ? 5 : this.intent.variety <= 10 ? 1 : 3;

    while (pool.length && result.length < count) {
      const ranked = pool
        .map(t => ({ t, score: this.score(t, recent) }))
        .sort((a, b) => b.score - a.score || a.t.uri.localeCompare(b.t.uri));
      const recentPrimaries = new Set(
        recent
          .slice(-spacing)
          .map(r => (r.artists?.[0] ? artistKey(r.artists[0]) : ''))
          .filter(Boolean)
      );
      const chosen =
        artistChoice(ranked, recent, this.intent) ||
        (ranked.find(x => !recentPrimaries.has(x.t.artists?.[0] ? artistKey(x.t.artists[0]) : '')) || ranked[0]).t;
      const from = recent.at(-1) || this.current;
      const enriched = {
        ...chosen,
        reason: this.reason(chosen, from),
        compat: transitionFit(from?.audio, chosen.audio),
        transition: transitionLabel(from?.audio, chosen.audio)
      };
      result.push(enriched);
      recent.push(enriched);
      const chosenId = songIdentity(chosen);
      for (let i = pool.length - 1; i >= 0; i--) {
        if (pool[i].uri === chosen.uri || (chosenId !== '|' && songIdentity(pool[i]) === chosenId)) {
          pool.splice(i, 1);
        }
      }
    }
    return result;
  }

  fill(force = false, snapshot) {
    if (force) this.pendingRebuild = true;
    if (!this.active || !this.current) return this.flight || Promise.resolve();
    if (this.busy || this.manualFlight) {
      this.refillAfter = true;
      return this.flight || Promise.resolve();
    }
    force = this.pendingRebuild;
    const q = snapshot || this.io.queue();
    if (!q) {
      this.notify('Esperando a que Spotify cargue la cola…');
      return Promise.resolve();
    }
    const manualQueued = q.priority.filter(t => !this.managed.some(m => sameEntry(m, t)));
    if (!force && (this.captured || !this.settings.takeover) && manualQueued.length) {
      if (!this.managed.length && this.status !== 'Tus canciones en cola van primero; después sigo con la mezcla.') {
        this.notify('Tus canciones en cola van primero; después sigo con la mezcla.');
      }
      return Promise.resolve();
    }
    if (!force && this.managed.length >= this.settings.queueSize) {
      return Promise.resolve();
    }
    const backoff = this.failures ? Math.min(60000, 5000 * 2 ** (this.failures - 1)) : 0;
    if (!force && backoff && Date.now() - this.lastAttempt < backoff) {
      return Promise.resolve();
    }
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.busy = true;
    this.lastAttempt = Date.now();
    const generation = this.generation;
    let watchdog;
    const timeout = new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('Tiempo de espera agotado')), 25000);
    });
    this.flight = Promise.race([this.refill(q, force, generation), timeout])
      .catch(error => {
        if (this.active && generation === this.generation) {
          this.failures++;
          this.notify(`Spotify no respondió: ${error.message}. Sigo intentando.`, true);
        }
      })
      .finally(() => {
        clearTimeout(watchdog);
        this.busy = false;
        this.flight = null;
        this.onUpdate();
        if (this.active && (this.refillAfter || this.pendingRebuild)) {
          this.refillAfter = false;
          setTimeout(() => {
            if (this.active) this.fill();
          }, 0);
        }
      });
    return this.flight;
  }

  async refill(initial, force, generation) {
    this.notify('Seleccionando las próximas canciones…');
    const key = this.poolKey();
    let candidates;
    if (!force && this.pool && this.pool.key === key && Date.now() - this.pool.at < 600000) {
      candidates = this.pool.tracks;
    } else {
      let cancel;
      const cancelled = new Promise(resolve => {
        cancel = () => resolve([]);
        this.cancelLookup = cancel;
      });
      try {
        candidates = await Promise.race([
          this.io.candidates(this.anchor || this.current, this.settings, initial.all),
          cancelled
        ]);
      } finally {
        if (this.cancelLookup === cancel) this.cancelLookup = null;
      }
      if (!this.active || generation !== this.generation) return;
      this.pool = { key, at: Date.now(), tracks: candidates || [] };
    }

    let q = this.io.queue();
    if (!q) throw new Error('No se puede leer la cola.');
    const takeover = (this.settings.takeover || this.sessionOverlay) && !this.captured;
    const manualPresent = q.priority.filter(t => !this.managed.some(m => sameEntry(m, t)));
    if (!takeover && manualPresent.length) {
      const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
      if (ours.length) await this.io.remove(ours);
      this.managed = [];
      this.preview = [];
      this.knownManual = manualPresent.map(reference);
      this.save();
      this.notify('Tus canciones en cola van primero; después sigo con la mezcla.');
      return;
    }

    const oldManaged = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
    const toRemove = takeover
      ? q.priority
      : force
      ? oldManaged.filter(t => !this.pinned || !sameEntry(t, this.pinned))
      : [];
    if (toRemove.some(t => !t.uid)) {
      throw new Error('No puedo identificar las entradas de la cola con seguridad.');
    }
    const kept = q.priority.filter(t => !toRemove.some(r => sameEntry(t, r)));
    const need = Math.max(0, this.settings.queueSize - kept.length);

    let selected = this.select(candidates, [...kept, ...toRemove], need);
    if (selected.length < need && this.io.candidates) {
      const widened = await this.io.candidates(this.anchor || this.current, this.settings, q.all, { widen: true });
      if (!this.active || generation !== this.generation) return;
      if (widened?.length) {
        candidates = widened;
        this.pool = { key, at: Date.now(), tracks: widened };
        selected = this.select(candidates, [...kept, ...toRemove], need, { relaxed: true });
      }
    }

    if (!selected.length) {
      if (force && toRemove.length) {
        await this.io.remove(toRemove);
        this.managed = this.managed.filter(m => !toRemove.some(t => sameEntry(m, t)));
        this.preview = this.preview.filter(m => !toRemove.some(t => sameEntry(t, m)));
        this.save();
      }
      this.failures++;
      this.notify('Me quedé sin canciones afines; Spotify sigue mientras busco más.');
      return;
    }

    if (takeover) {
      this.suspended = toRemove.map(t => ({ ...t }));
      this.captured = true;
      this.save();
    }

    let removed = false;
    try {
      if (toRemove.length) {
        await this.io.remove(toRemove);
        removed = true;
      }
      if (!this.active || generation !== this.generation) {
        if (removed && !takeover) {
          const restored = await this.io.add(toRemove);
          this.managed = [...this.managed.filter(m => !toRemove.some(t => sameEntry(t, m))), ...restored.map(reference)];
          this.save();
        }
        return;
      }
      const inserted = await this.io.add(selected);
      this.managed = [...this.managed.filter(m => !toRemove.some(t => sameEntry(t, m))), ...inserted.map(reference)];
      this.preview = [
        ...this.preview.filter(t => kept.some(k => sameEntry(t, k))),
        ...selected.map((t, i) => ({ ...t, uid: inserted[i]?.uid }))
      ];
      for (const t of selected) {
        const m = (this.memory[t.uri] ||= { plays: 0, vote: 0, heard: 0 });
        m.lastSuggested = Date.now();
      }
      this.save();
      this.failures = 0;
      this.notify('DJ en vivo. Tus elecciones siguen teniendo prioridad.');
      if (this.preview[0]) {
        Promise.resolve(this.onPrepare?.(this.preview[0], this.intent)).catch(() => {});
      }

      const selectedSet = new Set(selected.map(t => t.uri));
      const remaining = candidates.filter(
        t => t && valid(t.uri) && !selectedSet.has(t.uri) && !this.sessionPlayed.has(t.uri) && this.eligible(t)
      ).length;
      if (remaining < Math.max(3, need * 3) && !this.poolRefreshFlight && this.io.candidates) {
        this.poolRefreshFlight = Promise.resolve(
          this.io.candidates(this.anchor || this.current, this.settings, q.all, { widen: true })
        )
          .then(fresh => {
            if (this.active && fresh?.length) {
              this.pool = { key: this.poolKey(), at: Date.now(), tracks: fresh };
            }
          })
          .catch(() => {})
          .finally(() => {
            this.poolRefreshFlight = null;
          });
      }
    } catch (error) {
      if (removed) {
        try {
          const restored = await this.io.add(toRemove);
          if (takeover) {
            this.suspended = [];
            this.captured = false;
          } else {
            this.managed = [...this.managed.filter(m => !toRemove.some(t => sameEntry(t, m))), ...restored.map(reference)];
          }
        } catch (_) {
          // Recovery retains the suspended queue for a later retry.
        }
      }
      this.save();
      throw error;
    }
  }

  sync(snapshot) {
    const q = snapshot || this.io.queue();
    if (!q) return;
    const head = q.priority[0];
    if (head && this.managed.some(m => sameEntry(m, head))) this.expectedNext = reference(head);
    this.managed = this.managed.filter(m => q.priority.some(t => sameEntry(t, m)));
    this.preview = this.preview.filter(m => q.priority.some(t => sameEntry(t, m)));
    if (this.pinned && !q.priority.some(t => sameEntry(t, this.pinned))) this.pinned = null;
  }

  yieldToUser() {
    if (this.yieldFlight) return this.yieldFlight;
    this.active = false;
    this.generation++;
    this.pendingRebuild = false;
    this.refillAfter = false;
    this.followNext = false;
    this.io.cancelTransition?.();
    this.cancelLookup?.();
    this.notify('Tú eliges. DJ pausado; retirando sus sugerencias…');
    this.yieldFlight = Promise.resolve()
      .then(async () => {
        if (this.flight) await this.flight;
        this.busy = true;
        this.onUpdate();
        try {
          const q = this.io.queue();
          if (!q) throw Error('No se puede leer la cola');
          const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
          if (ours.length) await this.io.remove(ours);
          this.managed = [];
          this.preview = [];
          this.queuePlan = [];
          if (!this.suspended.length) this.captured = false;
          this.save();
          this.notify(
            this.suspended.length
              ? 'DJ pausado. Tu elección manda. Puedes restaurar la cola guardada.'
              : 'DJ pausado. Tu elección manda; Spotify sigue tu lista.'
          );
        } catch (e) {
          this.notify('No pude retirar todas las sugerencias: ' + e.message + '. Pulsa Restaurar cola.', true);
        } finally {
          this.busy = false;
          this.onUpdate();
        }
      })
      .finally(() => {
        this.yieldFlight = null;
      });
    return this.yieldFlight;
  }

  reconcileManual(snapshot) {
    if (!this.active || this.busy) return this.manualFlight || this.yieldFlight || Promise.resolve();
    const q = snapshot || this.io.queue();
    if (!q) return Promise.resolve();
    const manualEntries = q.priority.filter(t => !this.managed.some(m => sameEntry(m, t)));
    const newManual = manualEntries.filter(t => !this.knownManual.some(k => sameEntry(k, t)));
    this.knownManual = manualEntries.map(reference);

    if (newManual.length && this.managed.length && !this.settings.takeover) {
      const ours = q.priority.filter(t => this.managed.some(m => sameEntry(m, t)));
      if (ours.length) {
        this.manualFlight = Promise.resolve()
          .then(async () => {
            await this.io.remove(ours);
            this.managed = [];
            this.preview = [];
            this.queuePlan = q.priority.filter(t => !ours.some(o => sameEntry(o, t))).map(t => ({ ...t, manual: true }));
            this.save();
            this.notify('Tus canciones en cola van primero; después sigo con la mezcla.');
          })
          .catch(() => {})
          .finally(() => {
            this.manualFlight = null;
            this.onUpdate();
          });
        return this.manualFlight;
      }
    }

    this.queuePlan = q.priority.map(t => ({
      ...this.preview.find(p => sameEntry(p, t)),
      ...t,
      manual: !this.managed.some(m => sameEntry(m, t))
    }));
    return Promise.resolve();
  }

  eligible(t) {
    if (!t || !valid(t.uri) || !t.artists?.length) return false;
    if (this.intent.artistMode === 'only' && this.intent.artist && !hasArtist(t, this.intent.artist)) return false;
    if ((!this.settings.explicit && t.explicit) || this.sessionExcluded.has(t.uri)) return false;
    if (
      t.artists.some(
        a => this.artistExcluded.has(artistKey(a)) || this.intent.excludedArtists.includes(words(a.name))
      )
    ) {
      return false;
    }
    const styles = [...(t.styles || []), ...(this.tags[t.uri] || [])].map(words);
    return !this.intent.styles.length || this.intent.styles.every(tag => styles.includes(words(tag)));
  }

  knownTracks() {
    const q = this.io.queue();
    const playlist = [...this.sessionPlaylist, ...(this.io.known?.() || []), ...(q?.all || []).filter(t => t.playlist)];
    const history = Object.values(this.memory)
      .filter(m => m.track && m.heard > 0)
      .map(m => ({ ...m.track, playlist: false, evidence: [] }));
    const found = new Map();
    const counts = new Map();
    for (const t of [...playlist, ...history]) {
      const evidence = [...new Set([...knownEvidence(t, this.memory[t.uri]), ...(found.get(t.uri)?.evidence || [])])];
      const previous = found.get(t.uri);
      if (isKnown(t, this.memory[t.uri]) && this.eligible(t)) {
        found.set(t.uri, {
          ...t,
          image: t.image || previous?.image || '',
          album: t.album || previous?.album || '',
          playlist: evidence.includes('playlist'),
          evidence,
          familiar: true
        });
      }
    }
    for (const t of found.values()) {
      const k = t.artists?.[0] ? artistKey(t.artists[0]) : '';
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    this.libraryArtistCounts = counts;
    const keys = new Set((this.anchor || this.current)?.artists.map(artistKey) || []);
    return [...found.values()]
      .sort(
        (a, b) =>
          Number(b.artists.some(x => keys.has(artistKey(x)))) - Number(a.artists.some(x => keys.has(artistKey(x))))
      )
      .slice(0, 300);
  }

  prepareChoices() {
    this.sessionPlaylist = (this.io.queue()?.all || []).filter(t => t.playlist).slice(0, 300);
    const candidates = this.knownTracks();
    candidates.sort((a, b) => this.score(b, []) - this.score(a, []) || a.uri.localeCompare(b.uri));
    this.choosing = true;
    this.deck.set(candidates);
    this.onUpdate();
    this.hydrateChoices();
    this.syncLibrary();
    return this.deck.pair;
  }

  async syncLibrary(force = false, playlist = '') {
    if (!this.io.loadKnown || this.libraryBusy) return;
    this.libraryBusy = true;
    this.onUpdate();
    try {
      await this.io.loadKnown(force, playlist);
      if (this.choosing) {
        const tracks = this.knownTracks();
        const signature = tracks
          .map(t => t.uri)
          .sort()
          .join('|');
        if (signature !== this.deck.signature) this.deck.set(tracks);
        this.hydrateChoices();
      }
      if (this.active) await this.refresh();
    } catch (_) {
      this.notify('La biblioteca no respondió. Puedes seguir con las fuentes ya disponibles.');
    } finally {
      this.libraryBusy = false;
      this.onUpdate();
    }
  }

  nextChoices(reset = false) {
    reset ? this.deck.reset() : this.deck.next();
    this.onUpdate();
    this.hydrateChoices();
    return this.deck.pair;
  }

  async hydrateChoices() {
    if (!this.io.cardDetails) return;
    const pair = this.deck.pair;
    const results = await Promise.allSettled(pair.map(t => (t.image ? Promise.resolve(null) : this.io.cardDetails(t))));
    if (!this.choosing || this.deck.pair !== pair) return;
    let changed = false;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.image) {
        const t = pair[i];
        t.image = r.value.image;
        t.album = r.value.album || t.album;
        const m = this.memory[t.uri];
        if (m?.track) {
          m.track = { ...m.track, image: t.image, album: t.album };
          changed = true;
        }
      }
    });
    if (changed) this.save();
    this.onUpdate();
  }

  tagPlaylist(styles) {
    const tags = intentOf({ styles }).styles;
    if (!tags.length) return;
    const tracks = [...this.sessionPlaylist, ...(this.io.queue()?.all || []).filter(t => t.playlist)];
    if (this.current) tracks.push(this.current);
    for (const t of tracks) this.tags[t.uri] = tags;
    this.pool = null;
    this.save();
    this.notify('Etiqueta musical guardada para estas canciones.');
    if (this.choosing) this.prepareChoices();
    return this.refresh();
  }

  async playChoice(track, start = false, overlay = false) {
    if (!track || !valid(track.uri)) throw Error('Elige una canción válida');
    if (!this.io.play) throw Error('Spotify no ofrece reproducción directa');
    const generation = ++this.commandGeneration;
    this.choiceBusy = true;
    this.onUpdate();
    try {
      if (this.captured) await this.stop();
      else await this.yieldToUser();
      if (this.captured || this.managed.length) throw Error('Primero hay que restaurar o liberar la cola pendiente');
      if (generation !== this.commandGeneration) return false;
      if (start && this.io.beforeSessionPlay) {
        const allowed = await this.io.beforeSessionPlay(track, this.intent);
        if (allowed === false || generation !== this.commandGeneration) return false;
      }
      await this.io.play(track);
      if (generation !== this.commandGeneration) return false;
      this.trackChanged(track);
      this.anchor = this.current;
      this.intent.reference = reference(track);
      this.choosing = false;
      this.commandChoices = [];
      this.commandArtists = [];
      this.artistMenu = null;
      if (start) await this.start(this.current, !!this.io.beforeSessionPlay, overlay);
      else this.notify('Tu canción está sonando. DJ pausado.');
      return true;
    } finally {
      this.choiceBusy = false;
      this.onUpdate();
    }
  }

  async command(text) {
    this.commandChoices = [];
    this.commandArtists = [];
    this.artistMenu = null;
    this.pendingCommand = null;
    const command = parseCommand(text);
    if (!command.ok) {
      this.notify(command.errors.join(' '), true);
      return command;
    }
    const generation = ++this.commandGeneration;
    if (command.target?.current && !this.current) {
      this.notify('Primero reproduce una canción.', true);
      return { ok: false };
    }
    if (command.action === 'stop' || command.action === 'restore') {
      await this.stop();
      return command;
    }
    let target = command.target?.current ? this.current : null;
    if (command.target && !target) {
      this.notify('Buscando tu canción…');
      const result =
        command.action === 'search' && this.io.search
          ? await this.io.search(command.target)
          : { tracks: (await this.io.resolve?.(command.target)) || [], artists: [] };
      const matches = result.tracks || [];
      this.commandArtists = result.artists || [];
      if (generation !== this.commandGeneration) {
        return { ok: false, errors: ['La orden fue sustituida por otra elección.'] };
      }
      if (!matches.length && !this.commandArtists.length) {
        this.notify('No encontré esa canción o artista.', true);
        return { ok: false, errors: ['Sin coincidencias'] };
      }
      const exact = matches.filter(
        t =>
          songKey(t.name) === songKey(command.target.title) &&
          (!command.target.artist || t.artists.some(a => words(a.name) === words(command.target.artist)))
      );
      if (command.action === 'search' || exact.length !== 1) {
        this.commandChoices = (exact.length ? exact : matches).slice(0, 6);
        this.pendingCommand = command;
        this.notify(
          command.action === 'search'
            ? 'Elige una canción para comenzar una mezcla con esa referencia.'
            : 'Elige la coincidencia correcta. No cambié tu reproducción.'
        );
        return { ...command, choices: this.commandChoices };
      }
      target = exact[0];
    }
    return this.applyCommand(command, target);
  }

  async applyCommand(command, target) {
    const next = intentOf({
      ...this.intent,
      ...command.patch,
      ...(target && ['play', 'search', 'reference'].includes(command.action) ? { artist: null, artistMode: null } : {}),
      excludedArtists: [...this.intent.excludedArtists, ...(command.patch.excludedArtists || [])]
    });
    if (target && target.artists.some(a => next.excludedArtists.includes(words(a.name)))) {
      this.notify('La referencia y el artista excluido se contradicen.', true);
      return { ok: false };
    }
    this.intent = next;
    this.settings.discovery = next.known ? 0 : Math.max(35, this.settings.discovery || 35);
    this.settings.diversity = next.variety;
    this.pool = null;
    if (target && command.action === 'reference') {
      this.anchor = target;
      this.intent.reference = reference(target);
      this.seeds = [];
    }
    this.save();
    if (command.action === 'play') return this.playChoice(target, command.start);
    if (command.action === 'search') return this.playChoice(target, true, true);
    if (command.action === 'reference' && target) {
      if (this.active && !this.captured && this.io.queue()?.priority.some(t => !this.managed.some(m => sameEntry(m, t)))) {
        await this.stop();
      }
      if (!this.active) await this.start(target, false, true);
      else {
        await this.refresh();
        await this.onNarrate('direction');
      }
      return command;
    }
    if (command.start && !this.active) {
      if (this.intent.known && !target) this.prepareChoices();
      else await this.start(target || this.current);
    } else if (this.active) {
      await this.refresh();
      this.onNarrate('direction');
    } else {
      this.notify('Entendido: ' + intentLabels(this.intent).join(' · '));
    }
    return command;
  }

  chooseCommand(track) {
    const command = this.pendingCommand;
    if (!command || !this.commandChoices.some(t => t.uri === track.uri)) return Promise.resolve();
    this.commandChoices = [];
    this.pendingCommand = null;
    return this.applyCommand(command, track);
  }

  chooseArtist(uri, mode) {
    const artist =
      this.commandArtists.find(a => a.uri === uri) ||
      this.commandChoices.flatMap(t => t.artists).find(a => a.uri === uri);
    if (!artist) return Promise.resolve();
    if (!mode) {
      this.artistMenu = artist;
      this.onUpdate();
      return Promise.resolve();
    }
    return this.beginArtist(artist, mode);
  }

  async beginArtist(artist, mode) {
    if (!['mix', 'only'].includes(mode)) return;
    const generation = ++this.commandGeneration;
    this.choiceBusy = true;
    this.notify('Preparando el catálogo de ' + artist.name + '…');
    try {
      const catalog = (await this.io.artistTracks?.(artist)) || this.commandChoices.filter(t => hasArtist(t, artist));
      if (generation !== this.commandGeneration) return;
      const tracks = catalog.filter(t => hasArtist(t, artist) && (this.settings.explicit || !t.explicit));
      if (!tracks.length) {
        this.notify('No encontré canciones reproducibles de ese artista.', true);
        return;
      }
      await this.stop();
      if (generation !== this.commandGeneration || this.captured || this.managed.length) return;
      this.intent = intentOf({
        ...this.intent,
        known: false,
        styles: [],
        artist,
        artistMode: mode,
        excludedArtists: this.intent.excludedArtists.filter(n => n !== words(artist.name))
      });
      this.settings.discovery = 50;
      this.pool = null;
      const choices = tracks.filter(t => t.uri !== this.current?.uri);
      const seed = (choices.length ? choices : tracks)[Math.floor(Math.random() * (choices.length || tracks.length))];
      this.commandArtists = [];
      this.artistMenu = null;
      this.pendingCommand = null;
      const played = await this.playChoice(seed, true, true);
      if (!played || !this.active) return;
      this.choiceBusy = true;
      this.onUpdate();
      const currentGeneration = this.commandGeneration;
      const pool = await this.io.candidates(this.anchor, this.settings, this.io.queue()?.all || []);
      if (currentGeneration !== this.commandGeneration || !this.active) return;
      const plan = [seed, ...this.preview, ...this.select(pool, this.io.queue()?.priority || [], 24)]
        .filter((t, i, a) => a.findIndex(x => x.uri === t.uri) === i)
        .slice(0, 24);
      if (this.io.createMix) {
        this.notify('Guardando la playlist de la mezcla…');
        const saved = await this.io.createMix(artist, mode, plan);
        if (currentGeneration !== this.commandGeneration || !this.active) return;
        this.mixPlaylist = saved;
        this.save();
        this.notify('Mezcla iniciada y playlist guardada: ' + this.mixPlaylist.name);
      }
      this.onUpdate();
    } catch (e) {
      this.notify('No pude completar la mezcla: ' + e.message, true);
    } finally {
      this.choiceBusy = false;
      this.onUpdate();
    }
  }

  exportProfile() {
    return {
      schema: 4,
      version: VERSION,
      settings: this.settings,
      intent: this.intent,
      memory: this.memory,
      preferences: this.preferences,
      contexts: this.contexts,
      tags: this.tags,
      taste: this.taste
    };
  }

  importProfile(data) {
    if (!data || ![1, 2, 3, 4].includes(data.schema) || !data.memory || typeof data.memory !== 'object' || Array.isArray(data.memory)) {
      throw Error('El archivo no es un perfil POOR DJ válido.');
    }
    const profile = migrateProfile(data);
    this.memory = profile.memory;
    this.preferences = profile.preferences;
    this.contexts = profile.contexts;
    this.tags = profile.tags;
    this.taste = profile.taste;
    this.intent = profile.intent;
    this.pool = null;
    this.updateSettings(profile.settings, false);
    this.commandGeneration++;
    return this.refresh();
  }
}
