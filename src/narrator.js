// Ánimo estimado solo con tempo, tono y nivel medidos; nunca con géneros supuestos.
function moodOf(audio) {
  if (!audio || !Number.isFinite(audio.bpm) || !Number.isInteger(audio.mode)) return null;
  const slow = audio.bpm < 100;
  const fast = audio.bpm >= 122;
  const loud = Number.isFinite(audio.loudness) && audio.loudness > -6;
  if (audio.mode === 0 && slow) return 'melancolica';
  if (slow && (audio.mode === 1 || (Number.isFinite(audio.loudness) && audio.loudness < -12))) return 'tranquila';
  if (fast && (loud || audio.bpm >= 138)) return 'intensa';
  if (audio.mode === 1 && fast) return 'animada';
  return null;
}

const MOODS = {
  melancolica: {
    lead: ['Un momento más sentimental.', 'Bajamos un poco la luz.', 'Toca algo con aire melancólico.'],
    now: 'más melancólico'
  },
  tranquila: {
    lead: ['Bajamos las revoluciones.', 'Un respiro.', 'Ahora, algo para ir con calma.'],
    now: 'más tranquilo'
  },
  animada: {
    lead: ['Subimos el ánimo.', 'Esta trae buena energía.', 'Arriba ese ánimo.'],
    now: 'más animado'
  },
  intensa: {
    lead: ['Ahora sí, a subir la energía.', 'Con fuerza.', 'Prepárate, que esta pega.'],
    now: 'con más intensidad'
  }
};

// Líneas por estilo: solo se usan si tú declaraste ese estilo en tus etiquetas.
const GENRE_LINES = {
  reggaeton: ['Para el perreo.', 'Sube el flow.'],
  trap: ['Bajos y rimas.', 'Para subir el volumen.'],
  rap: ['Rimas con carácter.', 'Atento a la letra.'],
  hiphop: ['Ritmo y rimas.', 'Del hip hop que te gusta.'],
  pop: ['Pop para cantar.', 'Un coro para el recuerdo.'],
  rock: ['Guitarras al frente.', 'Para dejar el volumen alto.'],
  electronica: ['Para la pista de baile.', 'Pulso electrónico.'],
  jazz: ['Jazz para escuchar con calma.', 'Con mucho oficio.'],
  salsa: ['Para mover los pies.', 'Sabor de salsa.'],
  bachata: ['Una de corazón.', 'Bachata para sentir.'],
  alabanzas: ['Un momento de alabanza.', 'Para elevar el ánimo.'],
  gospel: ['Para elevar el ánimo.', 'Voces con fuerza.'],
  ambient: ['Para dejar volar la mente.', 'Un paisaje sonoro.'],
  lofi: ['Para concentrarte.', 'Lo-fi sin prisa.']
};

function cleanTitle(name) {
  return String(name || 'esta canción')
    .replace(/\s*[(\[](?:feat\.?|ft\.?|with)[^)\]]*[)\]]/gi, '')
    .replace(/\s*[(\[][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+(?:remaster(?:ed)?|live|en\s+vivo|versi[oó]n|radio\s+edit|edit|mono|stereo)\b.*$/i, '')
    .trim() || 'esta canción';
}

function speakable(text) {
  let out = String(text || '');
  out = out.replace(/\s*[(\[](?:feat\.?|ft\.?|with|remaster(?:ed)?|live|en\s+vivo|versi[oó]n)[^)\]]*[)\]]/gi, ' ');
  out = out.replace(/\s+-\s+(?:remaster(?:ed)?|live|en\s+vivo|versi[oó]n|radio\s+edit|edit|mono|stereo)\b[^,.;!?]*/gi, '');
  out = out.replace(/\b(?:feat|ft)\b\.?/gi, 'con');
  out = out.replace(/&/g, ' y ');
  out = out.replace(/(?:^|\s)((?:[A-Za-z0-9]\s+){2,}[A-Za-z0-9])(?=\s|$)/g, (_, seq) => ' ' + seq.replace(/\s+/g, ''));
  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}♪♫★☆•·]/gu, ' ');
  out = out.replace(/\b[A-ZÁÉÍÓÚÜÑ]{4,}\b/g, w => w[0] + w.slice(1).toLowerCase());
  return out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

function greetingForHour(hour) {
  if (!Number.isFinite(hour)) return '¡Qué tal!';
  if (hour >= 5 && hour < 12) return 'Buenos días.';
  if (hour >= 12 && hour < 20) return 'Buenas tardes.';
  return 'Buenas noches.';
}

function pickOpener(openers, sequence, recentOpeners) {
  const n = Math.abs(Math.floor(sequence));
  for (let i = 0; i < openers.length; i++) {
    const candidate = openers[(n + i) % openers.length];
    if (!recentOpeners || !recentOpeners.includes(candidate)) {
      if (Array.isArray(recentOpeners)) {
        recentOpeners.push(candidate);
        if (recentOpeners.length > 10) recentOpeners.shift();
      }
      return candidate;
    }
  }
  return openers[n % openers.length];
}

function commentary(event, seed, intent = intentOf(), sequence = 0, recentOpeners = null) {
  const n = Math.abs(Math.floor(sequence));
  const pick = list => list[n % list.length];
  const title = cleanTitle(seed?.name);
  const artist = seed?.artists?.[0]?.name || intent?.artist?.name || '';
  const by = artist ? `, de ${artist}` : '';
  const mood = moodOf(seed?.audio);
  const before = moodOf(seed?.prevAudio);
  const style = (seed?.styles || []).map(words).find(x => GENRE_LINES[x]);
  const direction = intent?.styles?.length
    ? intent.styles.map(t => STYLE_NAMES[words(t)] || t).join(' y ')
    : intent?.artistMode === 'only'
    ? 'solo ' + (intent.artist?.name || artist || 'este artista')
    : intent?.artistMode === 'mix'
    ? 'la música de ' + (intent.artist?.name || artist || 'este artista')
    : 'el sonido de ' + (artist || title);

  if (event === 'next') {
    const openers = [
      `Ahora suena ${title}${by}.`,
      `Esto es ${title}${by}.`,
      `Sigue ${title}${by}.`,
      `Llega ${title}${by}.`,
      `Es el turno de ${title}${by}.`,
      `Ponemos ${title}${by}.`,
      `Aquí viene ${title}${by}.`,
      `Continuamos con ${title}${by}.`
    ];
    let lead = '';
    if (mood && before && mood !== before) lead = `Cambiamos de ambiente: ahora algo ${MOODS[mood].now}.`;
    else if (mood) lead = pick(MOODS[mood].lead);
    else if (Number.isFinite(seed?.hour) && (seed.hour >= 22 || seed.hour < 5)) lead = 'Para esta hora de la noche.';

    const tail = [];
    if (style) tail.push(pick(GENRE_LINES[style]));
    if (seed?.evidence) tail.push(`Viene de ${seed.evidence.toLowerCase()}.`);
    else if (seed?.source === 'radio') tail.push('Llega desde la radio de tu mezcla.');
    else if (seed?.source === 'artista relacionado') tail.push('De un artista cercano a tu mezcla.');
    if (seed?.plays >= 3) tail.push(`La has escuchado ${seed.plays} veces.`);
    if (seed?.minutes >= 20) tail.push(`Llevas ${seed.minutes} minutos de sesión.`);
    if (seed?.prevArtist && artist && words(seed.prevArtist) !== words(artist)) {
      tail.push(`Cambiamos de ${seed.prevArtist} a ${artist}.`);
    }
    if (!tail.length) {
      tail.push('Encaja bien con lo que traes.', 'Va directo con el pulso de la sesión.', 'Conecta bien con la anterior.');
    }
    const opener = pickOpener(openers, n, recentOpeners);
    return [lead, opener, tail[n % tail.length]].filter(Boolean).join(' ').split(/\s+/).slice(0, 30).join(' ');
  }

  if (event === 'follow') {
    const openers = [
      'Buena elección. Sigo por ahí.',
      'Me gusta ese giro.',
      'Excelente cambio de rumbo.',
      'Tomamos ese camino.',
      'Ajusto la mezcla a lo que pusiste.',
      'Perfecto, seguimos esa línea.',
      'Gran tema para guiar la sesión.',
      'Vamos por esa ruta.'
    ];
    const tails = [
      `Ahora nos guiamos por ${title}${by}.`,
      `Busco música afín a ${title}${by}.`,
      `Preparamos la siguiente cola alrededor de ${artist || title}.`,
      'Dejo tus elecciones al frente.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'discovery') {
    const openers = [
      `Esta es nueva para ti: ${title}${by}.`,
      `Algo fresco en tu sesión: ${title}${by}.`,
      `Te presento ${title}${by}.`,
      `Un descubrimiento para ti: ${title}${by}.`,
      `Primera vez por aquí con ${title}${by}.`,
      `Abrimos espacio a algo nuevo: ${title}${by}.`,
      `Para descubrir hoy: ${title}${by}.`,
      `Dale una oportunidad a ${title}${by}.`
    ];
    const tails = [
      'Encaja con la vibra que traes.',
      'Si te convence, dale un voto positivo.',
      'Va en la misma línea de tu referencia.',
      'Dime si quieres más en este estilo.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 4) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'return') {
    const days = Math.max(30, Number(seed?.daysSince) || 30);
    const openers = [
      `Hace ${days} días que no sonaba ${title}${by}.`,
      `Rescatamos ${title}${by} después de ${days} días.`,
      `Vuelve a sonar ${title}${by}.`,
      `Un reencuentro después de ${days} días: ${title}${by}.`,
      `Tenía ${days} días guardada y vuelve ${title}${by}.`,
      `Regresa a tu cola ${title}${by}.`,
      `Para recordar viejas escuchas: ${title}${by}.`,
      `Traemos de vuelta ${title}${by}.`
    ];
    const tails = [
      seed?.evidence ? `Viene de ${seed.evidence.toLowerCase()}.` : 'Ya formaba parte de tu música.',
      'Directo a la mezcla de hoy.',
      'A ver cómo se siente hoy.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'milestone') {
    const mins = Math.max(30, Number(seed?.minutes) || 30);
    const openers = [
      `Llevamos ${mins} minutos de música continua.`,
      `Ya van ${mins} minutos de sesión juntos.`,
      `Media hora más en la cabina: ${mins} minutos ya.`,
      `Seguimos en vivo tras ${mins} minutos de mezcla.`,
      `Qué buen ritmo: ${mins} minutos de sesión.`,
      `${mins} minutos sin soltar el pulso.`,
      `Cruzamos los ${mins} minutos de música.`,
      `Seguimos al aire después de ${mins} minutos.`
    ];
    const tails = [
      seed?.artistsCount ? `Ya pasaron ${seed.artistsCount} artistas por aquí.` : 'La mezcla sigue viva.',
      `Ahora con ${title}${by}.`,
      'Tú sigues al mando.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  if (event === 'end') {
    const openers = [
      'Hasta aquí llega la mezcla de hoy.',
      'Cerramos la cabina por ahora.',
      'Gracias por acompañarme en esta sesión.',
      'Dejo la música en tus manos.',
      'Terminamos por hoy en POOR DJ.',
      'Sesión cerrada con buen sabor.',
      'Me despido por ahora.',
      'Apagamos el micro hasta la próxima.'
    ];
    const tails = [
      seed?.minutes >= 5 ? `Fueron ${seed.minutes} minutos de música.` : 'Spotify sigue con tu reproducción.',
      'Cuando quieras, volvemos a mezclar.',
      'Tú mantienes el control.'
    ];
    return `${pickOpener(openers, n, recentOpeners)} ${tails[Math.floor(n / 3) % tails.length]}`
      .split(/\s+/)
      .slice(0, 30)
      .join(' ');
  }

  const greet = greetingForHour(seed?.hour);
  const startOpeners = [
    `${greet} Soy DJ POOR y arrancamos con ${direction}.`,
    `${greet} Arrancamos la mezcla alrededor de ${title}.`,
    `${greet} Tomamos ${title} como punto de partida.`,
    `¡Hola! Soy DJ POOR. Nos guiamos por ${direction}.`,
    `Empezamos la sesión desde ${title}.`,
    `Cabina lista. La referencia de hoy es ${title}.`,
    `Vamos con una sesión guiada por ${direction}.`,
    `Todo listo por aquí: partimos de ${title}.`
  ];
  const dirOpeners = [
    `La dirección ahora es ${direction}.`,
    `Ajustamos el rumbo hacia ${direction}.`,
    `Seguimos con ${direction}.`,
    `Tu rumbo queda claro: ${direction}.`,
    `Cambiamos el enfoque a ${direction}.`,
    `Trabajamos ahora con ${direction}.`,
    `Nueva guía en cabina: ${direction}.`,
    `Recibido: nos movemos con ${direction}.`
  ];
  const blockOpeners = [
    `Seguimos con ${direction}.`,
    `Mantenemos ${direction} como guía.`,
    `El hilo sigue siendo ${direction}.`,
    `Nos quedamos cerca de ${direction}.`,
    `La sesión continúa con ${direction}.`,
    `Conservamos ${direction} como referencia.`,
    `Mantenemos el pulso alrededor de ${direction}.`,
    `Continuamos sobre la línea de ${direction}.`
  ];
  const middles =
    intent?.artistMode === 'only'
      ? ['Dentro de su catálogo.', 'Sin salir del artista elegido.', 'También caben sus colaboraciones.', 'Su música lleva la sesión.']
      : intent?.artistMode === 'mix'
      ? ['El artista lleva el protagonismo.', 'Con música afín entre medias.', 'Sus canciones son la base.', 'Mezclamos su catálogo con afinidad.']
      : intent?.known
      ? ['Solo entre tu música conocida.', 'Desde tus fuentes personales.', 'Tu biblioteca marca el paso.', 'Sin salir de lo que ya conoces.']
      : ['Con espacio para descubrir.', 'Combinando tus favoritas y radio afín.', 'La afinidad guía cada propuesta.', 'Mezcla viva a tu medida.'];
  const endings =
    event === 'direction'
      ? ['Tus instrucciones quedan aplicadas.', 'Puedes ajustar el rumbo cuando quieras.', 'Tú conservas el control.']
      : ['Tú decides la próxima dirección.', 'Tu elección tiene prioridad.', 'El rumbo lo marcas tú.'];

  const openers = event === 'start' ? startOpeners : event === 'direction' ? dirOpeners : blockOpeners;
  const o = pickOpener(openers, n, recentOpeners);
  const m = middles[Math.floor(n / 5) % middles.length];
  const e = endings[Math.floor(n / 20) % endings.length];
  return `${o} ${m} ${e}`.split(/\s+/).slice(0, 30).join(' ');
}

class NeuralVoice {
  constructor(base = 'http://127.0.0.1:47811', { fetch: fetchImpl, Audio: AudioCtor, onStatus } = {}) {
    this.base = String(base || 'http://127.0.0.1:47811').replace(/\/+$/, '');
    this.fetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.Audio = AudioCtor || (typeof Audio === 'function' ? Audio : null);
    this.onStatus = onStatus || (() => {});
    this.ok = false;
    this.voices = [];
    this.defaultVoice = '';
    this.lastCheck = 0;
    this.checking = null;
    this.audio = null;
    this.loadingAudio = null;
    this.pendingResolve = null;
    this.watchdog = null;
    this.disposed = false;
  }

  async health(force = false) {
    if (this.disposed || !this.fetch) return { ok: false, voices: [], default: '' };
    const ttl = this.ok ? 300000 : 60000;
    if (!force && this.lastCheck && Date.now() - this.lastCheck < ttl) {
      return { ok: this.ok, voices: this.voices, default: this.defaultVoice };
    }
    if (this.checking) return this.checking;
    this.checking = (async () => {
      const prevOk = this.ok;
      const prevSig = JSON.stringify(this.voices);
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 3000) : null;
      try {
        const res = await this.fetch(`${this.base}/health`, ctrl ? { signal: ctrl.signal } : {});
        if (!res || !res.ok) throw Error('health failed');
        const data = await res.json();
        this.ok = !!data?.ok && Array.isArray(data.voices) && data.voices.length > 0;
        this.voices = this.ok ? data.voices : [];
        this.defaultVoice = this.ok ? String(data.default || this.voices[0]?.id || '') : '';
        this.lastError = '';
      } catch (err) {
        this.ok = false;
        this.voices = [];
        this.defaultVoice = '';
        this.lastError = String(err?.message || err || 'unknown');
      } finally {
        if (timer) clearTimeout(timer);
        this.lastCheck = Date.now();
        this.checking = null;
        if (!this.disposed && (prevOk !== this.ok || prevSig !== JSON.stringify(this.voices))) {
          this.onStatus();
        }
      }
      return { ok: this.ok, voices: this.voices, default: this.defaultVoice };
    })();
    return this.checking;
  }

  url(text, voice = '', speed = 1.0) {
    const clean = String(text || '')
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    const vid = String(voice || this.defaultVoice || '').replace(/^neural:/, '');
    const spd = Math.max(0.7, Math.min(1.4, Number(speed) || 1.0)).toFixed(2);
    return `${this.base}/tts?text=${encodeURIComponent(clean)}&voice=${encodeURIComponent(vid)}&speed=${spd}`;
  }

  async prefetch(text, voice = '', speed = 1.0) {
    if (this.disposed || !this.ok || !this.fetch || !text) return false;
    try {
      const res = await this.fetch(this.url(text, voice, speed));
      return !!res?.ok;
    } catch (_) {
      return false;
    }
  }

  load(text, voice = '', speed = 1.0, timeoutMs = 12000) {
    if (this.disposed || !this.Audio || !text) return Promise.resolve({ ok: false });
    this.cancelLoading();
    const audio = new this.Audio(this.url(text, voice, speed));
    audio.preload = 'auto';
    this.loadingAudio = audio;
    return new Promise(resolve => {
      let settled = false;
      const done = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audio.removeEventListener?.('canplaythrough', onReady);
        audio.removeEventListener?.('error', onErr);
        if (this.loadingAudio === audio) this.loadingAudio = null;
        if (!result.ok) {
          try {
            audio.pause?.();
            audio.src = '';
          } catch (_) {}
        }
        resolve(result);
      };
      const onReady = () => done({ ok: true, audio });
      const onErr = () => done({ ok: false });
      const timer = setTimeout(() => done({ ok: false }), timeoutMs);
      this._cancelLoadHook = () => done({ ok: false, cancelled: true });
      audio.addEventListener?.('canplaythrough', onReady, { once: true });
      audio.addEventListener?.('error', onErr, { once: true });
      try {
        audio.load?.();
      } catch (_) {}
    });
  }

  playLoaded(audio, volume = 0.9) {
    if (this.disposed || !audio) return Promise.resolve({ spoken: false });
    this.cancelPlayback();
    this.audio = audio;
    try {
      audio.volume = Math.max(0, Math.min(1, Number(volume) ?? 0.9));
    } catch (_) {}
    return new Promise(resolve => {
      const finish = result => {
        if (this.pendingResolve !== finish) return;
        clearTimeout(this.watchdog);
        this.watchdog = null;
        this.pendingResolve = null;
        audio.removeEventListener?.('ended', onEnd);
        audio.removeEventListener?.('error', onErr);
        try {
          audio.pause?.();
          audio.src = '';
        } catch (_) {}
        if (this.audio === audio) this.audio = null;
        resolve(result);
      };
      const onEnd = () => finish({ spoken: true });
      const onErr = () => finish({ spoken: false });
      this.pendingResolve = finish;
      this.watchdog = setTimeout(() => finish({ spoken: false }), 30000);
      audio.addEventListener?.('ended', onEnd, { once: true });
      audio.addEventListener?.('error', onErr, { once: true });
      try {
        const p = audio.play?.();
        if (p?.catch) p.catch(() => finish({ spoken: false }));
      } catch (_) {
        finish({ spoken: false });
      }
    });
  }

  async play(text, voice = '', volume = 0.9, speed = 1.0) {
    const loaded = await this.load(text, voice, speed);
    if (!loaded.ok) return { spoken: false, ...(loaded.cancelled ? { cancelled: true } : {}) };
    return this.playLoaded(loaded.audio, volume);
  }

  cancelLoading() {
    this._cancelLoadHook?.();
    this._cancelLoadHook = null;
    if (this.loadingAudio) {
      try {
        this.loadingAudio.pause?.();
        this.loadingAudio.src = '';
      } catch (_) {}
      this.loadingAudio = null;
    }
  }

  cancelPlayback() {
    this.pendingResolve?.({ cancelled: true });
    if (this.audio) {
      try {
        this.audio.pause?.();
        this.audio.src = '';
      } catch (_) {}
      this.audio = null;
    }
  }

  cancel() {
    this.cancelLoading();
    this.cancelPlayback();
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }
}

class Narrator {
  constructor(host, changed = () => {}, opts = {}) {
    this.host = host;
    this.changed = changed;
    this.enabled = true;
    this.voice = null;
    this.preferred = '';
    this.text = '';
    this.sequence = Math.floor(Math.random() * 10000);
    this.recent = [];
    this.recentOpeners = [];
    this.prepared = null;
    this.speed = 1.0;
    this.volume = 0.9;
    this.disposed = false;
    this.speaking = false;
    this.neural =
      opts.neural ||
      new NeuralVoice(opts.serverUrl, {
        fetch: host.Audio && typeof fetch === 'function' ? fetch.bind(globalThis) : opts.fetch || null,
        Audio: host.Audio || null,
        onStatus: () => {
          this.detect(true);
          this.changed();
        }
      });
    this.onVoices = () => this.detect();
    host.speechSynthesis?.addEventListener?.('voiceschanged', this.onVoices);
    this.detect();
    if (this.neural.Audio) {
      this.neural.health().catch(() => {});
    }
  }

  // Neural local voices first, then Spanish system voices ranked by quality.
  voices() {
    const neuralList = this.neural.ok
      ? this.neural.voices.map(v => ({
          name: 'neural:' + v.id,
          id: v.id,
          label: `${v.label} · neural local`,
          lang: v.lang || 'es',
          localService: true,
          neural: true
        }))
      : [];
    let all = [];
    try {
      all = this.host.speechSynthesis?.getVoices?.() || [];
    } catch (_) {}
    const score = v =>
      (/natural|neural/i.test(v.name) ? 4 : 0) +
      (/^es-MX$/i.test(v.lang) ? 3 : /^es-(US|419)$/i.test(v.lang) ? 2 : /^es-ES$/i.test(v.lang) ? 1 : 0) +
      (/sabina|dalia|paloma|livia/i.test(v.name) ? 1 : 0);
    const sys = all.filter(v => /^es(?:-|$)/i.test(v.lang)).sort((a, b) => score(b) - score(a));
    return [...neuralList, ...sys];
  }

  systemFallbackVoice() {
    let all = [];
    try {
      all = this.host.speechSynthesis?.getVoices?.() || [];
    } catch (_) {}
    const score = v =>
      (/natural|neural/i.test(v.name) ? 4 : 0) +
      (/^es-MX$/i.test(v.lang) ? 3 : /^es-(US|419)$/i.test(v.lang) ? 2 : /^es-ES$/i.test(v.lang) ? 1 : 0) +
      (/sabina|dalia|paloma|livia/i.test(v.name) ? 1 : 0);
    return all
      .filter(v => /^es(?:-|$)/i.test(v.lang) && v.localService === true)
      .sort((a, b) => score(b) - score(a))[0] || null;
  }

  detect(force) {
    if (this.disposed) return;
    if (this.voice && !force) {
      if (!this.voice.neural && this.neural.ok && !this.preferred) {
        // Upgrade automatic choice when neural server comes online.
      } else {
        return;
      }
    }
    const all = this.voices();
    const chosen =
      (this.preferred && all.find(v => v.name === this.preferred)) ||
      (this.neural.ok
        ? all.find(v => v.neural && v.id === this.neural.defaultVoice) || all.find(v => v.neural)
        : null) ||
      all.find(v => !v.neural && v.localService === true) ||
      null;
    this.voice = chosen;
    this.changed();
  }

  prefer(name) {
    this.preferred = name || '';
    this.detect(true);
  }

  canSpeak(local = true) {
    if (this.disposed || !this.enabled || !this.voice || !local) return false;
    if (this.voice.neural) return this.neural.ok;
    return !!this.host.SpeechSynthesisUtterance;
  }

  buildText(event, seed, intent) {
    if (event === 'next' && seed?.uri && this.prepared?.uri === seed.uri && this.prepared?.text) {
      const reused = this.prepared.text;
      this.prepared = null;
      return reused;
    }
    let text = '';
    for (let tries = 0; tries < 20; tries++) {
      text = commentary(event, seed, intent, this.sequence++, this.recentOpeners);
      if (!this.recent.includes(text)) break;
    }
    return text;
  }

  commitCaption(text) {
    this.text = text;
    this.textAt = Date.now();
    this.recent.push(text);
    this.recent = this.recent.slice(-20);
    this.changed();
    return text;
  }

  prepare(event, seed, intent) {
    if (this.disposed || !seed?.uri) return null;
    const text = commentary(event, seed, intent, this.sequence++, this.recentOpeners);
    this.prepared = { uri: seed.uri, event, text };
    if (this.enabled && this.voice?.neural && this.neural.ok) {
      this.neural.prefetch(speakable(text), this.voice.id, this.speed);
    }
    return text;
  }

  say(event, seed, intent, local = true, preloadedAudio = null, prebuiltText = null) {
    if (this.disposed) return Promise.resolve({ cancelled: true });
    if (!prebuiltText) {
      this.cancel();
    }
    const text = prebuiltText || this.buildText(event, seed, intent);
    if (!prebuiltText) this.commitCaption(text);
    if (!this.canSpeak(local)) return Promise.resolve({ spoken: false });

    const spokenText = speakable(text);
    if (this.voice.neural) {
      this.speaking = true;
      this.changed();
      const job = preloadedAudio
        ? this.neural.playLoaded(preloadedAudio, this.volume)
        : this.neural.play(spokenText, this.voice.id, this.volume, this.speed);
      return job.then(res => {
        this.speaking = false;
        this.changed();
        if (res.spoken || res.cancelled || this.disposed) return res;
        this.neural.health(true).catch(() => {});
        const sysVoice = this.systemFallbackVoice();
        if (!sysVoice || !this.host.SpeechSynthesisUtterance) return { spoken: false };
        return this.speakSystem(spokenText, sysVoice);
      });
    }

    return this.speakSystem(spokenText, this.voice);
  }

  speakSystem(spokenText, voice) {
    if (!voice || !this.host.SpeechSynthesisUtterance || !this.host.speechSynthesis) {
      return Promise.resolve({ spoken: false });
    }
    const utterance = new this.host.SpeechSynthesisUtterance(spokenText);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = this.rate || this.speed || 0.96;
    utterance.pitch = 1.02;
    utterance.volume = Math.max(0, Math.min(1, this.volume ?? 1));
    return new Promise(resolve => {
      const finish = result => {
        if (this.finish !== finish) return;
        clearTimeout(this.watchdog);
        this.finish = null;
        this.speaking = false;
        this.changed();
        resolve(result);
      };
      this.finish = finish;
      this.speaking = true;
      this.changed();
      utterance.onend = () => finish({ spoken: true });
      utterance.onerror = () => {
        if (this.voice === voice) this.voice = null;
        finish({ spoken: false });
      };
      this.watchdog = setTimeout(() => {
        if (this.voice === voice) this.voice = null;
        finish({ spoken: false });
        try {
          this.host.speechSynthesis.cancel();
        } catch (_) {}
      }, 20000);
      try {
        this.host.speechSynthesis.speak(utterance);
      } catch (_) {
        if (this.voice === voice) this.voice = null;
        finish({ spoken: false });
      }
    });
  }

  cancel() {
    this.neural.cancel();
    this.finish?.({ cancelled: true });
    try {
      this.host.speechSynthesis?.cancel?.();
    } catch (_) {}
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.neural.cancel();
      this.finish?.({ spoken: false });
      try {
        this.host.speechSynthesis?.cancel?.();
      } catch (_) {}
    }
    this.changed();
    return this.enabled;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.neural.dispose();
    this.host.speechSynthesis?.removeEventListener?.('voiceschanged', this.onVoices);
  }
}

// A narration owns only its own pause or duck lease. User playback, devices and stop revoke it.
class VoiceGate {
  constructor(narrator, music) {
    this.narrator = narrator;
    this.music = music;
    this.lease = null;
  }

  cancel(restore = true) {
    const old = this.lease;
    this.lease = null;
    this.narrator.cancel();
    if (restore && old?.ramped && old?.ducking && this.music.setVolume && this.music.getVolume) {
      try {
        const cur = this.music.getVolume();
        if (Math.abs(cur - old.lastSetVolume) <= 0.08) {
          this.music.setVolume(old.origVolume);
        }
      } catch (_) {}
      this.music.saveRecovery?.(null);
    }
  }

  playbackChanged() {
    if (this.lease?.expectedPause && !this.music.playing()) {
      this.lease.expectedPause = false;
      return;
    }
    if (this.lease?.ducking) return;
    this.cancel();
  }

  async _rampVolume(lease, from, to, ms, steps) {
    const stepMs = Math.max(10, Math.round(ms / steps));
    let expected = from;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, stepMs));
      if (this.lease !== lease) return false;
      const cur = this.music.getVolume();
      if (Math.abs(cur - expected) > 0.08) return false;
      const next = i === steps ? to : from + ((to - from) * i) / steps;
      lease.lastSetVolume = next;
      expected = next;
      this.music.setVolume(next);
    }
    return true;
  }

  async run(event, seed, intent, { resume = true, local = true } = {}) {
    const inherited = this.lease;
    const mode = this.music.mode ? this.music.mode() : 'pause';
    const canDuck = mode === 'duck' && typeof this.music.getVolume === 'function' && typeof this.music.setVolume === 'function';
    const inheritDuck = !!(canDuck && inherited?.ducking && inherited?.ramped);
    this.cancel(!inheritDuck);

    const text = this.narrator.buildText(event, seed, intent);
    this.narrator.commitCaption(text);

    if (!this.narrator.canSpeak(local)) {
      if (inheritDuck) {
        try {
          this.music.setVolume(inherited.origVolume);
        } catch (_) {}
        this.music.saveRecovery?.(null);
      }
      return { spoken: false };
    }

    if (!canDuck && (!this.music.pause || !this.music.resume)) {
      return { spoken: false };
    }

    const playing = this.music.playing();
    const uri = this.music.uri();
    const device = this.music.device();
    const trueOrig = inheritDuck ? inherited.origVolume : canDuck ? this.music.getVolume() : 1;
    const lease = {
      uri,
      device,
      wasPlaying: playing || !!(inherited?.wasPlaying && inherited.uri === uri && inherited.device === device),
      expectedPause: !canDuck && playing,
      ducking: canDuck,
      ramped: inheritDuck,
      origVolume: trueOrig,
      lastSetVolume: canDuck ? this.music.getVolume() : 1
    };
    this.lease = lease;

    let preloadedAudio = null;
    if (this.narrator.voice?.neural) {
      const loaded = await this.narrator.neural.load(speakable(text), this.narrator.voice.id, this.narrator.speed, 12000);
      if (this.lease !== lease) {
        if (loaded.audio) {
          try {
            loaded.audio.pause?.();
            loaded.audio.src = '';
          } catch (_) {}
        }
        return { cancelled: true };
      }
      if (!loaded.ok) {
        this.narrator.neural.health(true).catch(() => {});
        const sys = this.narrator.systemFallbackVoice();
        if (!sys || !this.narrator.host.SpeechSynthesisUtterance) {
          this.lease = null;
          return { spoken: false };
        }
        // Fallback to system voice for this utterance.
        return this._runWithVoice(lease, text, null, { resume, local, canDuck, sysFallback: sys });
      }
      preloadedAudio = loaded.audio;
    }

    return this._runWithVoice(lease, text, preloadedAudio, { resume, local, canDuck });
  }

  async _runWithVoice(lease, text, preloadedAudio, { resume, local, canDuck, sysFallback = null }) {
    try {
      if (canDuck) {
        const orig = lease.origVolume;
        const startVol = this.music.getVolume();
        lease.lastSetVolume = startVol;
        lease.ramped = true;
        const duckPct = clamp(this.music.duckLevel ? this.music.duckLevel() : 30, 10, 80);
        const ducked = Math.max(0.02, orig * (duckPct / 100));
        this.music.saveRecovery?.({ volume: orig, device: lease.device });
        await this._rampVolume(lease, startVol, ducked, 350, 8);
        if (this.lease !== lease) return { cancelled: true };

        const result = sysFallback
          ? await this.narrator.speakSystem(speakable(text), sysFallback)
          : await this.narrator.say('', null, null, local, preloadedAudio, text);

        if (this.lease !== lease || result.cancelled) {
          if (this.lease === lease) this.lease = null;
          return { cancelled: true };
        }
        const cur = this.music.getVolume();
        if (Math.abs(cur - lease.lastSetVolume) <= 0.08) {
          await this._rampVolume(lease, cur, orig, 700, 12);
        }
        this.music.saveRecovery?.(null);
        if (this.lease === lease) this.lease = null;
        return result;
      }

      if (lease.wasPlaying && this.music.playing()) await this.music.pause();
      if (this.lease !== lease) return { cancelled: true };
      const result = sysFallback
        ? await this.narrator.speakSystem(speakable(text), sysFallback)
        : await this.narrator.say('', null, null, local, preloadedAudio, text);
      if (
        this.lease !== lease ||
        result.cancelled ||
        this.music.uri() !== lease.uri ||
        this.music.device() !== lease.device
      ) {
        if (this.lease === lease) this.lease = null;
        return { cancelled: true };
      }
      this.lease = null;
      if (
        resume &&
        lease.wasPlaying &&
        this.music.uri() === lease.uri &&
        this.music.device() === lease.device &&
        !this.music.playing()
      ) {
        await this.music.resume();
      }
      return result;
    } catch (_) {
      if (this.lease === lease) {
        this.lease = null;
        if (canDuck) {
          try {
            const cur = this.music.getVolume();
            if (Math.abs(cur - lease.lastSetVolume) <= 0.03) this.music.setVolume(lease.origVolume);
          } catch (_) {}
          this.music.saveRecovery?.(null);
        } else if (
          lease.wasPlaying &&
          resume &&
          this.music.uri() === lease.uri &&
          this.music.device() === lease.device
        ) {
          await this.music.resume();
        }
      }
      return { spoken: false };
    }
  }
}
