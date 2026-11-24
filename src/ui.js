function mountUI(S, engine, { audio, queue, narrator, voiceGate, library, transitions, recovery, recoverVolume, lyrics, diagnose }) {
  const style = document.createElement('style');
  style.id = 'poor-dj-style';
  style.textContent = CSS;
  document.head.append(style);

  const svg = (paths, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    disc: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 0 7-7"/>', 20),
    play: svg('<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>', 20),
    pause: svg('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>', 20),
    prev: svg('<polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"/><line x1="5" y1="19" x2="5" y2="5"/>', 18),
    next: svg('<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/>', 18),
    heart: svg('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>', 15),
    thumbsDown: svg('<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>', 15),
    userX: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>', 15),
    undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>', 15),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>', 15),
    pin: svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>', 15),
    x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 17),
    mic: svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>', 17),
    micOff: svg('<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>', 17),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 16),
    search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', 16),
    sparkles: svg('<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z"/>', 17),
    library: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', 17),
    compass: svg('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>', 17),
    lyrics: svg('<path d="M4 6h16M4 12h10M4 18h14"/>', 16),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>', 14),
    save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>', 15),
    arrowLeft: svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', 15),
    external: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', 14),
    maximize: svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>', 15),
    sliders: svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>', 16),
    radio: svg('<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>', 16)
  };

  const ROUTE = '/PoorDJ';
  let lastNonDjPath = '/';
  const curInitPath = S.Platform.History?.location?.pathname;
  if (curInitPath && curInitPath !== ROUTE) lastNonDjPath = curInitPath;
  const detectExternalLyrics = () => {
    if (root.SpicyLyrics || document.querySelector('#SpicyLyrics_PageButton')) {
      return { id: 'spicy', name: 'Spicy Lyrics', open: () => S.Platform.History.push('/SpicyLyrics') };
    }
    if (root.LyricsPlus || document.querySelector('a[href="/lyrics-plus"], [data-uri="spotify:app:lyrics-plus"]')) {
      return { id: 'lyrics-plus', name: 'Lyrics Plus', open: () => S.Platform.History.push('/lyrics-plus') };
    }
    if (root.BeautifulLyrics || document.querySelector('.BeautifulLyrics, #BeautifulLyrics, [class*="BeautifulLyrics"]')) {
      return { id: 'beautiful-lyrics', name: 'Beautiful Lyrics', open: () => S.Platform.History.push('/lyrics') };
    }
    return null;
  };
  const useExternalLyrics = () => !!detectExternalLyrics() && engine.settings.lyricsProvider !== 'builtin';
  const ownLyrics = () => engine.settings.lyrics && !useExternalLyrics();
  const mainView = () => document.querySelector('#main-view') || document.querySelector('.Root__main-view');
  const onRoute = () => S.Platform.History?.location?.pathname === ROUTE;

  const mini = document.createElement('aside');
  mini.className = 'pd-mini';
  mini.hidden = true;
  mini.setAttribute('aria-label', 'Sesión POOR DJ');
  mini.innerHTML = `<button data-open><span class="pd-mini-cover">${ICONS.disc}<img data-minicover alt="" hidden></span><span data-minitext>POOR DJ</span></button><button data-stop aria-label="Terminar DJ">${ICONS.stop}</button>`;
  document.body.append(mini);

  const toast = document.createElement('aside');
  toast.className = 'pd-toastdj';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.append(toast);

  const perform = async work => {
    try {
      await work();
    } catch (e) {
      engine.notify(e.message, true);
    } finally {
      update();
    }
  };

  const closeBooth = () => {
    if (document.fullscreenElement && (!pageEl || document.fullscreenElement === pageEl)) {
      try {
        document.exitFullscreen?.().catch?.(() => {});
      } catch (_) {}
    }
    if (onRoute()) {
      const idx = S.Platform.History?.index;
      if ((typeof idx !== 'number' || idx > 0) && typeof S.Platform.History?.goBack === 'function') {
        try {
          S.Platform.History.goBack();
        } catch (_) {}
      }
      if (onRoute() && typeof S.Platform.History?.push === 'function') {
        try {
          S.Platform.History.push(lastNonDjPath && lastNonDjPath !== ROUTE ? lastNonDjPath : '/');
        } catch (_) {}
      }
      if (onRoute()) closePage();
    }
    update();
  };
  const toggleBooth = () => {
    if (onRoute()) closeBooth();
    else S.Platform.History.push(ROUTE);
  };

  mini.querySelector('[data-open]').onclick = () => open();
  mini.querySelector('[data-stop]').onclick = () => perform(() => engine.stop());

  let playerButton = null;
  let playerButtonParent = null;
  let playerButtonFrame = 0;
  let fallbackButton = null;

  const ensurePlayerButton = () => {
    const bar = document.querySelector('[data-testid="now-playing-bar"]');
    const anchor = bar?.querySelector('#SpicyLyrics_PageButton') || bar?.querySelector('[data-testid="control-button-queue"]');
    const parent = anchor?.parentElement;
    if (!parent) return;
    if (fallbackButton) {
      fallbackButton.deregister?.();
      fallbackButton = null;
    }
    if (playerButton?.isConnected && playerButtonParent === parent) return;
    playerButton?.remove();
    playerButton = document.createElement('button');
    playerButton.type = 'button';
    const styleRef = bar.querySelector('[data-testid="control-button-queue"]') || anchor;
    playerButton.className = styleRef.className;
    playerButton.id = 'PoorDJ_PlaybarButton';
    playerButton.setAttribute('aria-label', 'Abrir POOR DJ · Ctrl+D');
    playerButton.title = 'POOR DJ · Ctrl+D';
    playerButton.innerHTML = ICON;
    playerButton.onclick = () => toggleBooth();
    parent.insertBefore(playerButton, anchor);
    playerButtonParent = parent;
  };

  const playerButtonObserver = new MutationObserver(() => {
    if (playerButtonFrame) return;
    playerButtonFrame = requestAnimationFrame(() => {
      playerButtonFrame = 0;
      ensurePlayerButton();
    });
  });
  playerButtonObserver.observe(document.body, { childList: true, subtree: true });

  const fallbackTimer = setTimeout(() => {
    if (!playerButton?.isConnected && S.Playbar?.Button && !fallbackButton) {
      fallbackButton = new S.Playbar.Button('POOR DJ', ICON, () => toggleBooth());
    }
  }, 6000);

  const shortcut = e => {
    if (e.key === 'Escape' && onRoute()) {
      e.preventDefault();
      e.stopPropagation();
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen?.().catch?.(() => {});
        } catch (_) {}
      } else {
        closeBooth();
      }
      return;
    }
    if (e.code !== 'KeyD' || !e.ctrlKey || e.altKey || e.shiftKey || e.metaKey || e.repeat) return;
    const target = e.target;
    if (
      target?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '') ||
      target?.closest?.('[contenteditable="true"],[role="textbox"]')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    toggleBooth();
  };
  document.addEventListener('keydown', shortcut, true);
  ensurePlayerButton();

  const theme = node => {
    node.dataset.accent = engine.settings.accent;
  };
  const setText = (key, value) => {
    const n = pageEl?.querySelector(`[data-${key}]`);
    if (n && n.textContent !== String(value)) n.textContent = value;
  };
  const download = (data, name) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const L = {
    uri: '',
    data: null,
    state: 'idle',
    idx: -2,
    follow: true,
    pause: 0,
    raf: 0,
    tab: 'dj',
    tint: new Map(),
    tintUri: '',
    sleep: 0,
    sleepAt: 0,
    job: 0
  };

  const fmt = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const clock = () => S.Player.getProgress() + (engine.settings.lyricsOffset || 0);
  const seek = ms => {
    try {
      if (typeof S.Player.seek === 'function') S.Player.seek(ms);
      else (S.Platform.PlayerAPI?.seekTo || S.Platform.PlayerAPI?.seek)?.call(S.Platform.PlayerAPI, ms);
    } catch (_) {}
  };

  let pageEl = null;
  let lyricsView = null;
  const views = [];
  const addView = (rootNode, active) => {
    const v = { root: rootNode, active, idx: -2, rendered: '', follow: true, pause: 0 };
    views.push(v);
    return v;
  };
  const liveViews = () => {
    for (let i = views.length - 1; i >= 0; i--) {
      if (!views[i].root.isConnected) views.splice(i, 1);
    }
    return views;
  };
  const resetViews = () =>
    liveViews().forEach(v => {
      v.idx = -2;
      v.follow = true;
      v.pause = 0;
    });

  function loadLyrics() {
    const track = engine.current;
    if (!ownLyrics() || !track?.uri || !liveViews().some(v => v.active())) return;
    if (L.uri === track.uri && L.state !== 'error') return;
    L.uri = track.uri;
    L.state = 'loading';
    L.data = null;
    views.forEach(v => {
      v.rendered = '';
      v.idx = -2;
    });
    const job = ++L.job;
    paintLyrics();
    lyrics
      .get(track, { fallback: engine.settings.lyricsExternal })
      .then(r => {
        if (job !== L.job) return;
        L.state = r.state;
        L.data = r.state === 'ready' ? r : null;
        L.message = r.message;
        views.forEach(v => {
          v.rendered = '';
        });
        paintLyrics();
      })
      .catch(e => {
        if (job !== L.job) return;
        L.state = 'error';
        L.message = e.message;
        views.forEach(v => {
          v.rendered = '';
        });
        paintLyrics();
      });
  }

  function paintLyrics() {
    const info = {
      idle: 'Reproduce una canción para ver su letra.',
      loading: 'Buscando la letra…',
      none: engine.settings.lyricsExternal
        ? 'No encontré letra para esta canción.'
        : 'Spotify no tiene letra para esta canción. Puedes activar la búsqueda externa en Ajustes.',
      error: 'No pude cargar la letra. Se reintentará con la siguiente canción.'
    };
    const d = L.data;
    for (const v of liveViews()) {
      const box = v.root.querySelector('[data-lines]');
      const msg = v.root.querySelector('[data-lyricsmsg]');
      const skel = v.root.querySelector('[data-lyricsskeleton]');
      if (!box) continue;
      v.root.dataset.synced = d ? String(!!d.synced) : '';
      v.root.dataset.state = L.state;
      if (skel) skel.hidden = L.state !== 'loading' || !!d;
      msg.hidden = !!d || L.state === 'loading';
      msg.textContent = d || L.state === 'loading' ? '' : info[L.state] || '';
      const key = d ? L.uri + d.source : '';
      if (v.rendered === key) continue;
      v.rendered = key;
      box.innerHTML = d
        ? d.lines
            .map(
              (l, i) =>
                `<p class="pd-line${isGap(l) ? ' pd-gap' : ''}"${l.t != null ? ` data-seek="${l.t}" data-time="${fmt(l.t)}"` : ''} data-i="${i}">${
                  isGap(l)
                    ? '<span class="pd-gap-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
                    : `<span class="pd-ltext">${esc(l.text)}</span>`
                }</p>`
            )
            .join('')
        : '';
      v.root.querySelector('[data-lyricssource]').textContent = d
        ? `${d.synced ? 'Sincronizada' : 'Sin sincronizar'} · ${d.provider || d.source}`
        : '';
      box.parentNode.scrollTop = 0;
      v.idx = -2;
    }
  }

  function tickLyrics() {
    if (!L.data?.synced) return;
    const nowMs = clock() + 220;
    const lines = L.data.lines;
    const i = activeLine(lines, nowMs);
    for (const v of liveViews()) {
      if (!v.active()) continue;
      const box = v.root.querySelector('[data-lines]');
      if (!box) continue;
      const backBtn = v.root.querySelector('[data-follow-lyrics]');
      const canFollow = v.follow && Date.now() > v.pause;
      if (backBtn) backBtn.hidden = canFollow;
      const nodes = box.children;
      if (i !== v.idx) {
        v.idx = i;
        for (let n = 0; n < nodes.length; n++) {
          const elLine = nodes[n];
          elLine.classList.toggle('pd-now', i >= 0 && n === i);
          if (i < 0 || n !== i) elLine.style.removeProperty('--lp');
          if (i < 0) {
            elLine.dataset.state = 'future';
            elLine.dataset.d = '2';
            continue;
          }
          elLine.dataset.d = Math.min(3, Math.abs(n - i));
          if (n < i) elLine.dataset.state = 'past';
          else if (n === i) elLine.dataset.state = 'now';
          else if (n === i + 1) elLine.dataset.state = 'next';
          else elLine.dataset.state = 'future';
        }
        if (i >= 0 && nodes[i]) {
          const node = nodes[i];
          if (canFollow) {
            const sc = box.parentNode;
            sc.scrollTo({
              top: Math.max(0, node.offsetTop - sc.clientHeight * 0.36 + node.offsetHeight / 2),
              behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth'
            });
          }
        }
      }
      if (i >= 0 && nodes[i]) {
        const curT = lines[i].t ?? 0;
        const rawNext = lines[i + 1]?.t;
        const durFallback = S.Player.getDuration?.() || engine.current?.duration || curT + 4000;
        const span = Math.max(400, (rawNext != null ? rawNext : durFallback) - curT);
        const lp = Math.max(0, Math.min(1, (nowMs - curT) / span));
        nodes[i].style.setProperty('--lp', lp.toFixed(3));
      }
    }
  }

  function wireLyrics(v) {
    const rNode = v.root;
    const sc = rNode.querySelector('.pd-lyricsscroll');
    const back = rNode.querySelector('[data-follow-lyrics]');
    const pause = () => {
      v.pause = Date.now() + 3500;
      if (back) back.hidden = false;
    };
    sc.addEventListener('wheel', pause, { passive: true });
    sc.addEventListener('touchmove', pause, { passive: true });
    sc.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) pause();
    });
    rNode.addEventListener('click', e => {
      const line = e.target.closest('[data-seek]');
      if (line) {
        e.stopPropagation();
        seek(Math.max(0, Number(line.dataset.seek) - (engine.settings.lyricsOffset || 0)));
        v.follow = true;
        v.pause = 0;
        v.idx = -2;
        if (back) back.hidden = true;
        tickLyrics();
        frameBody();
        if (!S.Player.isPlaying()) setTimeout(() => { tickLyrics(); frameBody(); }, 120);
        return;
      }
      const b = e.target.closest('button');
      if (!b || !rNode.contains(b)) return;
      const d = b.dataset;
      if ('followLyrics' in d) {
        v.follow = true;
        v.pause = 0;
        b.hidden = true;
        v.idx = -2;
        tickLyrics();
      } else if (d.offset) {
        Promise.resolve(engine.updateSettings({ lyricsOffset: engine.settings.lyricsOffset + Number(d.offset) }, false)).then(
          () => {
            resetViews();
            update();
          }
        );
      } else if ('lsize' in d) {
        Promise.resolve(engine.updateSettings({ lyricsSize: { s: 'm', m: 'l', l: 's' }[engine.settings.lyricsSize] }, false)).then(
          update
        );
      } else if ('full' in d) {
        try {
          document.fullscreenElement ? document.exitFullscreen?.().catch?.(() => {}) : pageEl?.requestFullscreen?.();
        } catch (_) {}
      } else if ('exitfull' in d) {
        try {
          document.fullscreenElement && document.exitFullscreen?.().catch?.(() => {});
        } catch (_) {}
      } else {
        return;
      }
      e.stopPropagation();
    });
  }

  function frame() {
    L.raf = 0;
    if (!pageEl?.isConnected) return;
    try {
      frameBody();
    } catch (_) {}
    if (S.Player.isPlaying()) L.raf = requestAnimationFrame(frame);
  }

  function frameBody() {
    if (!pageEl) return;
    const dur = S.Player.getDuration?.() || engine.current?.duration || 0;
    const pos = S.Player.getProgress();
    const ratio = dur ? Math.min(1, pos / dur) : 0;
    const posText = fmt(pos);
    const durText = fmt(dur);
    pageEl.querySelectorAll('[data-progress]').forEach(bar => bar.style.setProperty('--p', ratio));
    pageEl.querySelectorAll('[data-pos]').forEach(el => {
      if (el.textContent !== posText) el.textContent = posText;
    });
    pageEl.querySelectorAll('[data-dur]').forEach(el => {
      if (el.textContent !== durText) el.textContent = durText;
    });
    tickLyrics();
    if (L.sleepAt && Date.now() >= L.sleepAt) {
      L.sleepAt = 0;
      L.sleep = 0;
      pageEl.querySelector('[data-sleep]').value = '0';
      if (engine.active) perform(() => engine.stop());
    }
  }

  const startFrame = () => {
    if (!L.raf && pageEl?.isConnected) L.raf = requestAnimationFrame(frame);
  };

  const paintTint = () => {
    const v = engine.settings.ambient ? L.tint.get(engine.current?.image) : '';
    if (pageEl?.isConnected) {
      if (v) pageEl.style.setProperty('--pd-tint', v);
      else pageEl.style.removeProperty('--pd-tint');
    }
  };

  async function tint() {
    if (!pageEl?.isConnected) return;
    const uri = engine.current?.image;
    if (!engine.settings.ambient || !uri) {
      paintTint();
      return;
    }
    if (L.tint.has(uri)) {
      paintTint();
      return;
    }
    if (L.tintUri === uri) return;
    L.tintUri = uri;
    try {
      const c = await S.colorExtractor?.(engine.current.uri);
      L.tint.set(uri, c?.VIBRANT || c?.PROMINENT || c?.DARK_VIBRANT || '');
    } catch (_) {
      L.tint.set(uri, '');
    }
    paintTint();
  }

  function setTab(tab) {
    L.tab = tab;
    if (!pageEl) return;
    pageEl.dataset.tab = tab;
    pageEl.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('pd-selected', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    pageEl.querySelectorAll('[data-pane]').forEach(n => {
      n.hidden = n.dataset.pane !== tab;
    });
    if (tab === 'lyrics') {
      loadLyrics();
      resetViews();
      startFrame();
      queueMicrotask(tickLyrics);
    } else if (tab === 'settings') {
      narrator.neural.health().catch(() => {});
      transitions.refresh().then(update).catch(() => {});
    }
  }

  function cards(tracks, kind) {
    return tracks
      .map(
        t =>
          `<button class="pd-choice" data-${kind}="${esc(t.uri)}" ${engine.choiceBusy ? 'disabled' : ''}>
            <span class="pd-choicecover">${imageURL(t.image) ? `<img src="${esc(imageURL(t.image))}" alt="" loading="eager">` : ICONS.disc}<span class="pd-choiceplay">${ICONS.play}</span></span>
            <b>${esc(t.name)}</b>
            <small>${esc(t.artists.map(a => a.name).join(', '))}</small>
            <small class="pd-evidence">${esc(evidenceLabel(t.evidence || knownEvidence(t, engine.memory[t.uri])) || t.album || 'Resultado de Spotify')}</small>
          </button>`
      )
      .join('');
  }

  function currentReasonLabel() {
    const c = engine.current;
    if (!c) return 'Reproduce una canción en Spotify';
    const ev = knownEvidence(c, engine.memory[c.uri]);
    if (ev.length) return evidenceLabel(ev);
    const activeMatch = engine.sessionList.find(t => t.uri === c.uri);
    if (activeMatch?.reason) return activeMatch.reason;
    if (engine.active && engine.anchor?.uri === c.uri) return 'Referencia actual de la sesión';
    if (!engine.memory[c.uri]) return 'Nueva para ti';
    return 'Sonando en Spotify';
  }

  function buildBoothDOM() {
    const el = document.createElement('section');
    el.className = 'pd-booth';
    el.id = 'PoorDJPage';
    el.setAttribute('aria-label', 'Cabina de POOR DJ');

    el.innerHTML = `
      <div class="pd-backdrop"><img data-bgcover alt="" hidden></div>
      <div class="pd-shell">
        <header class="pd-header">
          <div class="pd-brand">
            <span class="pd-brand-mark">${ICONS.disc}</span>
            <div>
              <h1>POOR DJ <small>${VERSION}</small></h1>
              <span class="pd-tagline">Tu música. Tu mando.</span>
            </div>
          </div>
          <div class="pd-tabs" role="tablist" data-tabs aria-label="Vista">
            <button role="tab" data-tab="dj" aria-selected="true" class="pd-selected">${ICONS.radio}<span>Sesión</span></button>
            <button role="tab" data-tab="lyrics" aria-selected="false" tabindex="-1">${ICONS.lyrics}<span>Letras</span></button>
            <button role="tab" data-tab="settings" aria-selected="false" tabindex="-1">${ICONS.settings}<span>Ajustes</span></button>
          </div>
          <div class="pd-header-actions">
            <button class="pd-pill-link" data-openspicy hidden>${ICONS.external}<span>Letras ↗</span></button>
            <span class="pd-live" data-live><i class="pd-live-dot"></i><span data-livetext>Tú tienes el control</span></span>
            <button class="pd-icon-btn" data-voice aria-label="Voz del DJ">${ICONS.mic}</button>
            <button class="pd-icon-btn" data-closepage aria-label="Cerrar cabina">${ICONS.x}</button>
          </div>
        </header>

        <div data-pane="dj" class="pd-session-grid">
          <section class="pd-card pd-deck" aria-label="Reproductor del DJ">
            <div class="pd-deck-stage">
              <div class="pd-vinyl" aria-hidden="true"></div>
              <div class="pd-cover-wrap">
                ${ICONS.disc}
                <img data-cover alt="Portada actual" hidden>
                <div class="pd-mic-overlay" data-micoverlay hidden>
                  <div class="pd-rings"><span class="pd-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>
                  <span class="pd-mic-label">DJ POOR al micro</span>
                  <p class="pd-mic-caption" data-miccaption></p>
                </div>
              </div>
            </div>
            <div class="pd-track-meta">
              <h2 data-title></h2>
              <p class="pd-track-artist" data-artist></p>
              <span class="pd-why-chip" data-why></span>
            </div>
            <div class="pd-transport">
              <div class="pd-progress-row">
                <span data-pos>0:00</span>
                <div class="pd-progress" data-progress role="progressbar" aria-label="Progreso"></div>
                <span data-dur>0:00</span>
              </div>
              <div class="pd-controls">
                <button data-prev aria-label="Anterior">${ICONS.prev}</button>
                <button data-toggleplay class="pd-playbtn" aria-label="Reproducir">${ICONS.play}</button>
                <button data-nextsong aria-label="Siguiente">${ICONS.next}</button>
              </div>
            </div>
            <div class="pd-feedback" data-feedbackrow>
              <button data-feedback="more">${ICONS.heart}<span>Me encanta</span></button>
              <button data-feedback="less">${ICONS.thumbsDown}<span>No es para mí</span></button>
              <button data-feedback="artist">${ICONS.userX}<span>Sin este artista hoy</span></button>
              <button data-undo>${ICONS.undo}<span>Deshacer</span></button>
            </div>
          </section>

          <div class="pd-main-col">
            <section class="pd-card pd-hero" data-idleview aria-label="Empieza tu sesión">
              <div class="pd-hero-head">
                <h2>Empieza tu sesión</h2>
                <p>Elige el estilo de mezcla y el DJ cuida el pulso sin interrumpir tus saltos.</p>
              </div>
              <div class="pd-vibes" role="group" aria-label="Modo de mezcla">
                <button class="pd-vibe-card" data-vibe="0">
                  ${ICONS.library}
                  <b>Mis favoritas</b>
                  <small>Solo playlists, Me gusta y escuchas que ya conoces.</small>
                </button>
                <button class="pd-vibe-card" data-vibe="35">
                  ${ICONS.sparkles}
                  <b>Mezcla</b>
                  <small>Equilibrio entre tus canciones conocidas y radio afín.</small>
                </button>
                <button class="pd-vibe-card" data-vibe="75">
                  ${ICONS.compass}
                  <b>Descubrir</b>
                  <small>Explora radio de Spotify y artistas relacionados.</small>
                </button>
              </div>
              <button class="pd-primary" data-toggle></button>
              <div class="pd-hero-links">
                <button class="pd-secondary" data-openpicker>${ICONS.disc}<span>Elegir canción de inicio</span></button>
                <button class="pd-secondary" data-follow>${ICONS.radio}<span>Seguir esta canción</span></button>
              </div>
              <button class="pd-secondary" data-restore hidden>Restaurar cola guardada</button>
            </section>

            <section class="pd-card pd-picker" data-picker hidden aria-label="Elige tu canción de inicio">
              <h3>Tu música conocida</h3>
              <p data-pickernote></p>
              <div class="pd-cards" data-cards></div>
              <div class="pd-pickeractions">
                <button class="pd-secondary" data-again>Otra vez</button>
                <button class="pd-secondary" data-resetdeck hidden>Reiniciar selección</button>
                <button class="pd-secondary" data-closepicker>Cancelar</button>
              </div>
            </section>

            <section class="pd-card" data-upnextcard hidden aria-label="A continuación">
              <div class="pd-section-head">
                <h3>A continuación</h3>
                <button class="pd-secondary" data-refresh>${ICONS.refresh}<span>Otra selección</span></button>
              </div>
              <div class="pd-next-list" data-next></div>
            </section>

            <section class="pd-stats" data-statsrow hidden aria-label="Estadísticas de sesión">
              <div class="pd-stat"><b data-statmin>0</b><small>Minutos</small></div>
              <div class="pd-stat"><b data-stattracks>0</b><small>Canciones</small></div>
              <div class="pd-stat"><b data-statartists>0</b><small>Artistas</small></div>
              <div class="pd-stat"><b data-statnew>0</b><small>Descubrimientos</small></div>
            </section>

            <section class="pd-card pd-command">
              <form data-command>
                <label for="pd-command" data-cmdlabel>¿Qué quieres escuchar?</label>
                <div class="pd-input-row">
                  <input id="pd-command" name="command" autocomplete="off" maxlength="240" placeholder="Yoko, L A K E N O S H I o sigue esta canción" required>
                  <button class="pd-secondary" type="submit">${ICONS.search}<span>Buscar</span></button>
                </div>
              </form>
              <div class="pd-examples" data-examples></div>
              <div class="pd-chips" data-intent aria-label="Instrucciones vigentes"></div>
            </section>

            <div class="pd-card pd-matches" data-matches hidden></div>
            <section class="pd-card pd-artistmenu" data-artistmenu hidden aria-label="Mezcla del artista"></section>
            <button class="pd-secondary" data-closesearch hidden>Cerrar resultados</button>

            <p class="pd-status" data-status role="status" aria-live="polite"></p>

            <div class="pd-session-actions" data-activeactions hidden>
              <button class="pd-secondary" data-savesession>${ICONS.save}<span>Guardar sesión como playlist</span></button>
              <button class="pd-primary pd-stop" data-stopbtn>${ICONS.stop}<span>Terminar DJ</span></button>
            </div>

            <div class="pd-card" data-mixcard hidden>
              <p class="pd-note" data-savedmix></p>
              <button class="pd-secondary" data-openmix>${ICONS.external}<span>Abrir última playlist guardada</span></button>
            </div>
          </div>
        </div>

        <div data-pane="lyrics" hidden class="pd-card pd-lyricspane">
          <div class="pd-lyrics-aura" aria-hidden="true"><img data-lyricsaura alt="" hidden></div>
          <div class="pd-lyrics-stage">
            <aside class="pd-lyrics-rail" aria-label="Ahora suena">
              <div class="pd-lyrics-cover">
                ${ICONS.disc}
                <img data-lyricscover alt="Portada actual" hidden>
              </div>
              <div class="pd-lyrics-meta">
                <h2 data-lyricstitle></h2>
                <p class="pd-track-artist" data-lyricsartist></p>
                <div class="pd-lyrics-badges">
                  <span class="pd-lyrics-badge" data-lyricssource></span>
                  <button class="pd-pill-link" data-openextlyrics hidden></button>
                </div>
              </div>
              <div class="pd-lyrics-rail-transport">
                <div class="pd-progress-row">
                  <span data-pos>0:00</span>
                  <div class="pd-progress" data-progress role="progressbar" aria-label="Progreso"></div>
                  <span data-dur>0:00</span>
                </div>
                <div class="pd-controls pd-controls-compact">
                  <button data-prev aria-label="Anterior">${ICONS.prev}</button>
                  <button data-toggleplay class="pd-playbtn" aria-label="Reproducir">${ICONS.play}</button>
                  <button data-nextsong aria-label="Siguiente">${ICONS.next}</button>
                </div>
              </div>
            </aside>

            <div class="pd-lyrics-main">
              <div class="pd-lyricsscroll" tabindex="0" aria-label="Letra de la canción">
                <div class="pd-lyrics-skeleton" data-lyricsskeleton hidden aria-hidden="true"><span></span><span></span><span></span><span></span></div>
                <p class="pd-note pd-lyrics-empty" data-lyricsmsg role="status"></p>
                <div data-lines class="pd-lines"></div>
              </div>
              <div class="pd-lyricstools">
                <button data-follow-lyrics hidden>Volver a la línea actual</button>
                <span>
                  <button data-offset="-250" aria-label="Retrasar letra">−</button>
                  <small>Ajuste <b data-offsetlabel>0 s</b></small>
                  <button data-offset="250" aria-label="Adelantar letra">+</button>
                </span>
                <button data-lsize aria-label="Cambiar tamaño de letra">Aa</button>
                <button data-full aria-label="Pantalla completa">${ICONS.maximize}</button>
                <button data-exitfull hidden aria-label="Salir de pantalla completa">${ICONS.x}</button>
              </div>
            </div>
          </div>
        </div>

        <div data-pane="settings" hidden class="pd-settings-grid">
          <section class="pd-card pd-setting-card">
            <h3>${ICONS.mic}<span>Voz del DJ</span></h3>
            <div class="pd-server-pill" data-serverpill>Comprobando voz neuronal local…</div>
            <p class="pd-note" data-serverhint hidden>Para voces locales naturales en español, ejecuta <code>voice\\install.ps1 -Autostart</code> y reinicia o lanza <code>voice\\start.ps1</code>.</p>
            <label class="pd-field">Voz preferida<select data-voicepick></select></label>
            <p class="pd-note" data-voicestatus></p>
            <label class="pd-field">Modo al hablar
              <select data-select="voiceMode">
                <option value="duck">Hablar sobre la música (baja el volumen)</option>
                <option value="pause">Pausar la música mientras habla</option>
              </select>
            </label>
            <label class="pd-field">
              <span class="pd-field-head"><span>Volumen de la música al hablar</span><span data-ducklabel>30%</span></span>
              <input type="range" min="10" max="80" step="5" data-range="duckLevel">
            </label>
            <label class="pd-field">
              <span class="pd-field-head"><span>Volumen de la voz</span><span data-vvollabel>90%</span></span>
              <input type="range" min="0" max="100" step="5" data-range="voiceVolume">
            </label>
            <label class="pd-field">
              <span class="pd-field-head"><span>Velocidad de la voz</span><span data-vspdlabel>1.00x</span></span>
              <input type="range" min="70" max="140" step="5" data-range="voiceSpeed">
            </label>
            <label class="pd-field">Frecuencia de comentarios
              <select data-select="talk">
                <option value="start">Al empezar y al cambiar rumbo</option>
                <option value="few">Cada 4–6 canciones</option>
                <option value="often">Cada 2–3 canciones</option>
              </select>
            </label>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-testvoice>${ICONS.mic}<span>Probar voz</span></button>
              <button class="pd-secondary" data-recheckvoice>${ICONS.refresh}<span>Reintentar servidor</span></button>
            </div>
          </section>

          <section class="pd-card pd-setting-card">
            <h3>${ICONS.disc}<span>Música y comportamiento</span></h3>
            <label class="pd-field">Modo predeterminado
              <select data-select="discovery">
                <option value="0">Mis favoritas (solo conocidas)</option>
                <option value="35">Mezcla (equilibrada)</option>
                <option value="75">Descubrir afines</option>
              </select>
            </label>
            <label class="pd-field">Canciones preparadas en cola
              <select data-select="queueSize">
                <option value="2">2 canciones</option>
                <option value="3">3 canciones</option>
                <option value="4">4 canciones</option>
                <option value="5">5 canciones</option>
              </select>
            </label>
            <label class="pd-field">Cuando elijo manualmente una canción
              <select data-select="onManual">
                <option value="follow">Seguir esa dirección (mantener DJ)</option>
                <option value="pause">Pausar el DJ</option>
              </select>
            </label>
            ${[
              ['explicit', 'Permitir contenido explícito'],
              ['skipRepeats', 'Evitar repeticiones en la sesión'],
              ['autoLearn', 'Aprender de mi escucha y saltos'],
              ['takeover', 'Suspender mi cola manual al iniciar']
            ]
              .map(([k, lbl]) => `<label class="pd-check"><input type="checkbox" data-setting="${k}"><span>${lbl}</span></label>`)
              .join('')}
          </section>

          <section class="pd-card pd-setting-card">
            <h3>${ICONS.sliders}<span>Transiciones y tiempo</span></h3>
            <label class="pd-field">Continuidad entre canciones
              <select data-select="flowStrength">
                <option value="40">Equilibrada</option>
                <option value="65">Suave</option>
                <option value="90">Más continuidad</option>
              </select>
            </label>
            <label class="pd-field">Solapamiento nativo de Spotify
              <select data-crossfade>
                <option value="0">Sin solapamiento</option>
                <option value="2">2 segundos</option>
                <option value="4" selected>4 segundos</option>
                <option value="6">6 segundos</option>
              </select>
            </label>
            <p class="pd-note" data-transitionstatus></p>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-applytransition>Aplicar en Spotify</button>
              <button class="pd-secondary" data-restoretransition>Restaurar</button>
              <button class="pd-secondary" data-recovervolume hidden>Recuperar volumen anterior</button>
            </div>
            <label class="pd-check"><input type="checkbox" data-setting="autoFade"><span>Transición automática según cada pareja de canciones</span></label>
            <label class="pd-field">Terminar el DJ en
              <select data-sleep>
                <option value="0">Sin temporizador</option>
                <option value="15">15 minutos</option>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
              </select>
            </label>
          </section>

          <section class="pd-card pd-setting-card">
            <h3>${ICONS.sparkles}<span>Apariencia y letras</span></h3>
            <label class="pd-field">Color de acento
              <select data-select="accent">
                <option value="spotify">Verde Spotify</option>
                <option value="theme">Mi tema</option>
                <option value="blue">Azul</option>
                <option value="violet">Violeta</option>
                <option value="rose">Rosa</option>
              </select>
            </label>
            <label class="pd-field" data-lyricsproviderwrap hidden>Proveedor de letras
              <select data-select="lyricsProvider"></select>
            </label>
            ${[
              ['mini', 'Control flotante al salir de la cabina'],
              ['ambient', 'Ambiente con color de portada'],
              ['lyrics', 'Mostrar pestaña de letras sincronizadas'],
              ['lyricsExternal', 'Buscar letras fuera de Spotify (LRCLIB)']
            ]
              .map(([k, lbl]) => `<label class="pd-check"><input type="checkbox" data-setting="${k}"><span>${lbl}</span></label>`)
              .join('')}
            <p class="pd-note" data-lrclibnote>LRCLIB está apagado por defecto: al activarlo se envían título, artista, álbum y duración a lrclib.net solo si Spotify no tiene letra.</p>
          </section>

          <section class="pd-card pd-setting-card" style="grid-column: 1 / -1">
            <h3>${ICONS.library}<span>Biblioteca y datos locales</span></h3>
            <p class="pd-note" data-library></p>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-librarysync>Actualizar Me gusta y playlists</button>
              <select data-playlists aria-label="Playlist de mi biblioteca" style="max-width:280px"></select>
              <button class="pd-secondary" data-loadplaylist>Leer playlist</button>
            </div>
            <form data-tag class="pd-input-row">
              <input id="pd-tag" maxlength="100" placeholder="Etiquetas para esta canción y playlist (ej. reggaetón, trap)">
              <button class="pd-secondary" type="submit">Etiquetar</button>
            </form>
            <div class="pd-btn-row">
              <button class="pd-secondary" data-diagnose>Comprobar compatibilidad</button>
              <button class="pd-secondary" data-export>Exportar perfil</button>
              <button class="pd-secondary" data-import>Importar perfil</button>
              <button class="pd-secondary" data-reset>Borrar aprendizaje</button>
              <button class="pd-secondary" data-cacheclear>Borrar caché acústica</button>
              <input data-file type="file" accept=".json,application/json" hidden>
            </div>
            <ul class="pd-diag" data-diagresult></ul>
          </section>
        </div>

        <footer class="pd-credit">Hecho por <b>KROMBYTE</b> · POOR DJ ${VERSION}</footer>
      </div>
    `;

    el.onclick = event => {
      const button = event.target.closest('button');
      if (!button || !el.contains(button)) return;
      const d = button.dataset;
      if (d.choice) {
        perform(() => engine.playChoice(engine.deck.pair.find(t => t.uri === d.choice), true));
      } else if (d.match) {
        perform(() => engine.chooseCommand(engine.commandChoices.find(t => t.uri === d.match)));
      } else if (d.mixartist) {
        perform(async () => {
          await engine.chooseArtist(d.mixartist);
          queueMicrotask(() => pageEl?.querySelector('[data-artistmode]')?.focus({ preventScroll: true }));
        });
      } else if (d.artistmode) {
        perform(() => engine.chooseArtist(d.artisturi, d.artistmode));
      } else if ('closeartist' in d) {
        const uri = engine.artistMenu?.uri;
        engine.artistMenu = null;
        update();
        pageEl?.querySelectorAll('[data-mixartist]').forEach(n => {
          if (n.dataset.mixartist === uri) n.focus({ preventScroll: true });
        });
      } else if ('closesearch' in d) {
        engine.commandGeneration++;
        engine.commandChoices = [];
        engine.commandArtists = [];
        engine.artistMenu = null;
        engine.pendingCommand = null;
        update();
      } else if ('openmix' in d && engine.mixPlaylist) {
        S.Platform.History.push('/playlist/' + engine.mixPlaylist.uri.split(':').pop());
      } else if ('applytransition' in d) {
        perform(async () => {
          await transitions.apply(Number(pageEl.querySelector('[data-crossfade]').value));
          engine.notify('Transición nativa aplicada en Spotify.');
        });
      } else if ('restoretransition' in d) {
        perform(async () => {
          await transitions.restore();
          engine.notify('Ajuste de transición anterior restaurado.');
        });
      } else if ('follow' in d) {
        perform(() => engine.command('sigue esta canción'));
      } else if ('openpicker' in d) {
        engine.prepareChoices();
      } else if (d.vibe !== undefined) {
        perform(() => engine.updateSettings({ discovery: Number(d.vibe) }));
      } else if ('librarysync' in d) {
        perform(() => engine.syncLibrary(true));
      } else if ('loadplaylist' in d) {
        const uri = pageEl.querySelector('[data-playlists]').value;
        if (uri) perform(() => engine.syncLibrary(true, uri));
      } else if ('again' in d) {
        engine.nextChoices();
      } else if ('resetdeck' in d) {
        engine.nextChoices(true);
      } else if ('closepicker' in d) {
        engine.choosing = false;
        update();
      } else if ('toggle' in d) {
        perform(() => (engine.active ? engine.stop() : engine.current ? engine.start() : engine.prepareChoices()));
      } else if ('stopbtn' in d || 'restore' in d) {
        perform(() => engine.stop());
      } else if ('refresh' in d) {
        perform(() => engine.refresh());
      } else if (d.feedback) {
        perform(() => engine.feedbackFor(engine.current, d.feedback));
      } else if ('undo' in d) {
        perform(() => engine.undoFeedback());
      } else if (d.reject) {
        perform(() => engine.feedbackFor(engine.preview.find(t => t.uid === d.reject), 'less'));
      } else if (d.pin) {
        engine.reserve(engine.preview.find(t => t.uid === d.pin));
        update();
      } else if (d.tab) {
        setTab(d.tab);
      } else if ('closepage' in d) {
        closeBooth();
      } else if ('openspicy' in d || 'openextlyrics' in d) {
        detectExternalLyrics()?.open();
      } else if ('prev' in d) {
        S.Player.back?.();
      } else if ('nextsong' in d) {
        S.Player.next?.();
      } else if ('toggleplay' in d) {
        S.Player.togglePlay?.();
        setTimeout(() => {
          update();
          startFrame();
        }, 120);
      } else if (d.example) {
        const inp = pageEl.querySelector('#pd-command');
        inp.value = d.example;
        inp.focus();
      } else if ('voice' in d) {
        narrator.toggle();
        engine.updateSettings({ voice: narrator.enabled }, false);
      } else if ('testvoice' in d) {
        narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
        narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
        if (!narrator.enabled) narrator.toggle();
        voiceGate.run(
          'next',
          { name: engine.current?.name || 'tu canción', artists: engine.current?.artists || [], evidence: 'tu playlist' },
          engine.intent,
          { local: true }
        );
      } else if ('recheckvoice' in d) {
        narrator.neural.health(true).then(() => update()).catch(() => {});
      } else if ('recovervolume' in d) {
        recoverVolume();
      } else if ('export' in d) {
        download(engine.exportProfile(), 'poor-dj-profile.json');
      } else if ('savesession' in d) {
        perform(() => engine.saveSession());
      } else if ('diagnose' in d) {
        perform(async () => {
          const out = pageEl.querySelector('[data-diagresult]');
          out.textContent = 'Comprobando…';
          const r = await diagnose();
          out.innerHTML =
            r.rows
              .map(
                x =>
                  `<li class="${x.ok === false ? 'pd-error' : ''}">${x.ok === false ? '✕' : x.ok ? '✓' : '·'} <b>${esc(x.name)}</b>: ${esc(x.detail)}</li>`
              )
              .join('') + `<li><b>${r.problems ? r.problems + ' problema(s)' : 'Todo responde'}</b></li>`;
        });
      } else if ('import' in d) {
        pageEl.querySelector('[data-file]').click();
      } else if ('reset' in d && root.confirm('¿Borrar el aprendizaje local de POOR DJ?')) {
        engine.memory = {};
        engine.contexts = {};
        engine.preferences = {};
        engine.taste = { artists: {} };
        engine.undoVote = null;
        engine.pool = null;
        engine.save();
        engine.refresh();
      } else if ('cacheclear' in d) {
        audio.clear();
        engine.notify('Caché acústica borrada.');
      }
    };

    lyricsView = addView(el.querySelector('[data-pane="lyrics"]'), () => L.tab === 'lyrics');
    wireLyrics(lyricsView);

    el.querySelector('[data-tabs]').onkeydown = e => {
      const order = ownLyrics() ? ['dj', 'lyrics', 'settings'] : ['dj', 'settings'];
      const cur = order.indexOf(L.tab);
      if (e.key === 'ArrowRight') {
        const nextTab = order[(cur + 1) % order.length];
        setTab(nextTab);
        el.querySelector(`[data-tab="${nextTab}"]`).focus();
      } else if (e.key === 'ArrowLeft') {
        const nextTab = order[(cur - 1 + order.length) % order.length];
        setTab(nextTab);
        el.querySelector(`[data-tab="${nextTab}"]`).focus();
      }
    };

    el.querySelectorAll('[data-progress]').forEach(bar => {
      bar.onclick = e => {
        const r = e.currentTarget.getBoundingClientRect();
        const d = S.Player.getDuration?.();
        if (d) {
          seek(Math.round(d * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))));
          frameBody();
        }
      };
    });

    el.querySelector('[data-sleep]').onchange = e => {
      L.sleep = Number(e.target.value);
      L.sleepAt = L.sleep ? Date.now() + L.sleep * 60000 : 0;
      engine.notify(L.sleep ? `El DJ terminará en ${L.sleep} minutos.` : 'Temporizador apagado.');
    };

    el.querySelector('[data-command]').onsubmit = event => {
      event.preventDefault();
      perform(() => engine.command(el.querySelector('#pd-command').value));
    };

    el.querySelector('[data-tag]').onsubmit = event => {
      event.preventDefault();
      perform(() =>
        engine.tagPlaylist(
          el
            .querySelector('#pd-tag')
            .value.split(',')
            .map(words)
            .filter(Boolean)
        )
      );
    };

    el.querySelector('[data-voicepick]').onchange = e => {
      const v = e.target.value;
      const on = v !== 'off';
      if (narrator.enabled !== on) narrator.toggle();
      if (on) {
        narrator.prefer(v);
        narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
        narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
        engine.updateSettings({ voice: true, voiceName: v }, false);
        voiceGate.run(
          'next',
          { name: engine.current?.name || 'tu canción', artists: engine.current?.artists || [], evidence: 'tu playlist' },
          engine.intent,
          { local: true }
        );
      } else {
        engine.updateSettings({ voice: false }, false);
      }
      update();
    };

    el.querySelectorAll('[data-select]').forEach(input => {
      input.onchange = () => {
        const key = input.dataset.select;
        const val = ['queueSize', 'flowStrength', 'discovery'].includes(key) ? Number(input.value) : input.value;
        perform(() => engine.updateSettings({ [key]: val }, ['queueSize', 'discovery'].includes(key)));
      };
    });

    el.querySelectorAll('[data-range]').forEach(input => {
      input.oninput = () => {
        const key = input.dataset.range;
        const val = Number(input.value);
        engine.updateSettings({ [key]: val }, false);
        narrator.volume = (engine.settings.voiceVolume ?? 90) / 100;
        narrator.speed = (engine.settings.voiceSpeed ?? 100) / 100;
        update();
      };
    });

    el.querySelectorAll('[data-setting]').forEach(input => {
      input.onchange = () =>
        perform(() => {
          if (input.dataset.setting === 'lyricsExternal') L.uri = '';
          return engine.updateSettings(
            { [input.dataset.setting]: input.checked },
            ['explicit', 'takeover'].includes(input.dataset.setting)
          );
        });
    });

    el.querySelector('[data-file]').onchange = event =>
      perform(async () => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 2000000) throw Error('El perfil supera 2 MB');
        await engine.importProfile(JSON.parse(await file.text()));
        narrator.enabled = engine.settings.voice;
        narrator.prefer(engine.settings.voiceName);
        event.target.value = '';
      });

    return el;
  }

  function closePage() {
    if (document.fullscreenElement && (!pageEl || document.fullscreenElement === pageEl)) {
      try {
        document.exitFullscreen?.().catch?.(() => {});
      } catch (_) {}
    }
    cancelAnimationFrame(L.raf);
    L.raf = 0;
    pageEl?.remove();
    pageEl = null;
    lyricsView = null;
  }

  function update() {
    ensurePlayerButton();
    if (playerButton) playerButton.classList.toggle('main-genericButton-buttonActive', onRoute() || engine.active);
    if (fallbackButton) fallbackButton.active = onRoute() || engine.active;

    const recentCaption = narrator.text && Date.now() - (narrator.textAt || 0) < 7000;
    const onBooth = onRoute();
    const showToast = (narrator.speaking || recentCaption) && !!narrator.text && !onBooth;
    toast.hidden = !showToast;
    if (showToast && !narrator.speaking) {
      clearTimeout(L.toastTimer);
      L.toastTimer = setTimeout(() => update(), 7100);
    }
    if (showToast) {
      theme(toast);
      toast.innerHTML = `<span class="pd-toast-ring"><span class="pd-eq" aria-hidden="true"><i></i><i></i><i></i></span></span><div class="pd-toastdj-body"><b>DJ POOR</b><span>${esc(narrator.text)}</span></div>`;
    }

    theme(mini);
    mini.hidden = !engine.settings.mini || !engine.active || onBooth;
    if (!mini.hidden) {
      const mUrl = imageURL(engine.current?.image);
      const mImg = mini.querySelector('[data-minicover]');
      mImg.hidden = !mUrl;
      if (mUrl && mImg.getAttribute('src') !== mUrl) mImg.src = mUrl;
      mini.querySelector('[data-minitext]').textContent = narrator.speaking
        ? 'DJ al micro'
        : engine.current?.name || 'DJ activo';
    }

    if (!onBooth) {
      if (pageEl) closePage();
      return;
    }

    if (!pageEl?.isConnected) {
      const host = mainView();
      if (!host) return;
      document.getElementById('PoorDJPage')?.remove();
      pageEl = buildBoothDOM();
      host.append(pageEl);
      L.uri = '';
      setTab(L.tab);
      narrator.neural.health().catch(() => {});
      transitions.refresh().then(update).catch(() => {});
    } else if (pageEl.dataset.tab !== L.tab) {
      setTab(L.tab);
    }

    theme(pageEl);
    pageEl.dataset.lyrics = String(engine.settings.lyrics);
    pageEl.dataset.lsize = engine.settings.lyricsSize;
    pageEl.dataset.playing = String(S.Player.isPlaying());
    pageEl.dataset.full = String(document.fullscreenElement === pageEl);
    const exitFullBtn = pageEl.querySelector('[data-exitfull]');
    if (exitFullBtn) exitFullBtn.hidden = document.fullscreenElement !== pageEl;
    tint();

    const talking = !!narrator.speaking;
    pageEl.dataset.dj = String(talking);

    setText(
      'livetext',
      talking
        ? 'DJ al micro'
        : engine.choiceBusy
        ? 'Reproduciendo'
        : engine.active
        ? engine.busy
          ? 'Eligiendo…'
          : 'En vivo'
        : 'Tú tienes el control'
    );
    pageEl.querySelector('[data-live]').classList.toggle('pd-active', engine.active || talking);

    const coverUrl = imageURL(engine.current?.image);
    for (const sel of ['[data-cover]', '[data-bgcover]', '[data-lyricscover]', '[data-lyricsaura]']) {
      const img = pageEl.querySelector(sel);
      if (!img) continue;
      img.hidden = !coverUrl;
      if (coverUrl && img.getAttribute('src') !== coverUrl) img.src = coverUrl;
    }

    const micOverlay = pageEl.querySelector('[data-micoverlay]');
    micOverlay.hidden = !talking;
    if (talking) setText('miccaption', narrator.text || '');

    const curTitle = engine.current?.name || 'Reproduce algo que te guste';
    const curArtist = engine.current?.artists.map(a => a.name).join(', ') || 'Tu próxima sesión empieza contigo.';
    setText('title', curTitle);
    setText('artist', curArtist);
    setText('lyricstitle', curTitle);
    setText('lyricsartist', curArtist);
    setText('why', currentReasonLabel());

    const isPlaying = S.Player.isPlaying();
    pageEl.querySelectorAll('[data-toggleplay]').forEach(playBtn => {
      playBtn.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
      playBtn.setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
    });

    pageEl.querySelector('[data-feedbackrow]').hidden = !engine.active;
    pageEl.querySelector('[data-undo]').disabled = !engine.undoVote;
    pageEl.querySelectorAll('[data-feedback]').forEach(b => {
      b.disabled = !engine.current || !!engine.choiceBusy;
    });

    pageEl.querySelector('[data-idleview]').hidden = engine.active;
    pageEl.querySelector('[data-upnextcard]').hidden = !engine.active;
    pageEl.querySelector('[data-statsrow]').hidden = !engine.active && !engine.sessionHeardMs;
    pageEl.querySelector('[data-activeactions]').hidden = !engine.active;

    // Vibe cards selection
    const activeVibe = engine.intent.known ? '0' : engine.settings.discovery >= 60 ? '75' : '35';
    pageEl.querySelectorAll('[data-vibe]').forEach(b => {
      const on = b.dataset.vibe === activeVibe;
      b.classList.toggle('pd-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const toggle = pageEl.querySelector('[data-toggle]');
    toggle.textContent = engine.current ? 'Iniciar DJ' : 'Elegir canción para empezar';
    toggle.disabled = !!engine.choiceBusy || engine.busy;

    const restoreBtn = pageEl.querySelector('[data-restore]');
    restoreBtn.hidden = !(engine.captured || (engine.managed.length && !engine.active));
    restoreBtn.disabled = engine.busy || !!engine.choiceBusy;

    // Known song picker
    const chooser = pageEl.querySelector('[data-picker]');
    chooser.hidden = !engine.choosing;
    const cardKey = JSON.stringify([engine.deck.pair.map(t => [t.uri, t.name, t.image, t.evidence]), engine.choiceBusy]);
    if (chooser._key !== cardKey) {
      chooser._key = cardKey;
      pageEl.querySelector('[data-cards]').innerHTML = cards(engine.deck.pair, 'choice');
    }
    setText(
      'pickernote',
      engine.deck.pair.length
        ? `${engine.deck.tracks.length} canciones conocidas · ${Math.max(0, engine.deck.tracks.length - engine.deck.offset)} por explorar. Elige una para guiar la sesión.`
        : engine.deck.tracks.length
        ? 'Ya viste todas las opciones. Reinicia la selección para revisarlas.'
        : 'No hay canciones conocidas disponibles. Lee una playlist o actualiza tus Me gusta en Ajustes.'
    );
    pageEl.querySelector('[data-again]').disabled = engine.deck.exhausted || !!engine.choiceBusy;
    pageEl.querySelector('[data-resetdeck]').hidden = !engine.deck.exhausted || !engine.deck.tracks.length;

    // Up next list
    pageEl.querySelector('[data-refresh]').disabled = !engine.active || engine.busy;
    const ordered = engine.active
      ? (queue()?.priority || []).slice(0, 8).map(t => ({
          ...t,
          ...engine.preview.find(p => sameEntry(p, t)),
          manual: !engine.managed.some(m => sameEntry(m, t))
        }))
      : [];
    const nextKey = JSON.stringify(
      ordered.map(t => [t.uri, t.uid, t.reason, t.manual, t.image, engine.pinned && sameEntry(t, engine.pinned)])
    );
    const list = pageEl.querySelector('[data-next]');
    if (list._key !== nextKey) {
      list._key = nextKey;
      list.innerHTML =
        ordered
          .map(
            t =>
              `<div class="pd-next">
                <span class="pd-next-thumb">${imageURL(t.image) ? `<img src="${esc(imageURL(t.image))}" alt="">` : ICONS.disc}</span>
                <div class="pd-next-info">
                  <b>${esc(t.name)}</b>
                  <small>${esc(t.artists.map(a => a.name).join(', '))}</small>
                  <div class="pd-next-tags">
                    <span class="${t.manual ? 'pd-manual-tag' : 'pd-reason-tag'}">${esc(
                      t.manual ? 'Tu elección' : t.reason || engine.reason(t, engine.current)
                    )}</span>
                    ${t.manual ? '' : `<span class="pd-flow-note">${esc(t.transition || transitionLabel(engine.current?.audio, t.audio))}</span>`}
                  </div>
                </div>
                ${
                  t.manual
                    ? ''
                    : `<div class="pd-next-actions">
                        <button data-pin="${esc(t.uid)}" aria-label="Reservar ${esc(t.name)}" aria-pressed="${!!(engine.pinned && sameEntry(engine.pinned, t))}">${ICONS.pin}</button>
                        <button data-reject="${esc(t.uid)}" aria-label="No encaja: ${esc(t.name)}">${ICONS.x}</button>
                      </div>`
                }
              </div>`
          )
          .join('') || '<p class="pd-empty">Preparando sugerencias para la cola…</p>';
    }

    // Session stats
    setText('statmin', Math.floor(engine.sessionHeardMs / 60000));
    setText('stattracks', engine.played);
    setText('statartists', engine.artistSet.size);
    setText('statnew', engine.discoveries);

    // Command box & examples
    setText('cmdlabel', engine.active ? 'Dirige al DJ' : '¿Qué quieres escuchar?');
    const artist0 = engine.current?.artists?.[0]?.name || '';
    const examples = [
      'más variedad',
      'solo conocidas',
      'descubrir',
      'sigue esta canción',
      ...(artist0 ? ['sin ' + artist0] : [])
    ];
    const exBox = pageEl.querySelector('[data-examples]');
    const exKey = JSON.stringify([engine.active, examples]);
    if (exBox._key !== exKey) {
      exBox._key = exKey;
      exBox.innerHTML = engine.active
        ? examples.map(ex => `<button type="button" data-example="${esc(ex)}">${esc(ex)}</button>`).join('')
        : '';
    }

    const labels = intentLabels(engine.intent);
    const chips = pageEl.querySelector('[data-intent]');
    chips.hidden = !engine.active;
    if (chips._key !== JSON.stringify(labels)) {
      chips._key = JSON.stringify(labels);
      chips.innerHTML = labels.map(label => `<span class="pd-chip">${esc(label)}</span>`).join('');
    }

    // Search results & artist menu
    const matchBox = pageEl.querySelector('[data-matches]');
    const menu = pageEl.querySelector('[data-artistmenu]');
    const hasResults = !!(engine.commandChoices.length || engine.commandArtists.length || engine.artistMenu);
    matchBox.hidden = !hasResults || !!engine.artistMenu;
    menu.hidden = !engine.artistMenu;
    pageEl.querySelector('[data-closesearch]').hidden = !hasResults;
    pageEl.querySelector('[data-closesearch]').disabled = !!engine.choiceBusy;
    const matchKey = JSON.stringify([engine.commandChoices.map(t => [t.uri, t.name, t.image]), engine.commandArtists]);
    if (matchBox._key !== matchKey) {
      matchBox._key = matchKey;
      const artists = engine.commandArtists.length
        ? engine.commandArtists
        : [
            ...new Map(
              engine.commandChoices
                .flatMap(t => t.artists)
                .filter(a => words(a.name).includes(words(engine.pendingCommand?.target?.title)))
                .map(a => [a.uri, a])
            ).values()
          ];
      matchBox.innerHTML =
        '<small class="pd-note">Resultados de Spotify</small><div class="pd-results">' +
        artists
          .map(
            a =>
              `<button class="pd-choice pd-result" data-mixartist="${esc(a.uri)}">
                <span class="pd-choicecover pd-artist-photo">${imageURL(a.image) ? `<img src="${esc(imageURL(a.image))}" alt="" loading="eager">` : ICONS.disc}</span>
                <b>${esc(a.name)}</b>
                <small>Artista · elegir mezcla</small>
              </button>`
          )
          .join('') +
        cards(engine.commandChoices, 'match') +
        '</div>';
    }
    if (engine.artistMenu && menu._key !== engine.artistMenu.uri) {
      const a = engine.artistMenu;
      menu._key = a.uri;
      menu.innerHTML = `
        <div class="pd-menuhead">
          <h3>${esc(a.name)}</h3>
          <button class="pd-secondary" data-closeartist aria-label="Volver a resultados">${ICONS.arrowLeft}<span>Volver</span></button>
        </div>
        <p class="pd-note">Elige el rumbo. Guardamos una playlist privada y devolvemos tu cola al terminar.</p>
        <div class="pd-cards">
          <button class="pd-choice pd-mode" data-artistmode="mix" data-artisturi="${esc(a.uri)}" aria-label="Aleatorio">
            <b>Aleatorio ↗</b>
            <small>Mucho de este artista, con canciones afines entre medias.</small>
          </button>
          <button class="pd-choice pd-mode" data-artistmode="only" data-artisturi="${esc(a.uri)}" aria-label="Artista">
            <b>Solo artista ↻</b>
            <small>Su catálogo y colaboraciones. Toda la mezcla gira alrededor de él.</small>
          </button>
        </div>`;
    }
    pageEl.querySelectorAll('[data-mixartist],[data-match],[data-artistmode]').forEach(n => {
      n.disabled = !!engine.choiceBusy;
    });

    setText('status', engine.status);
    pageEl.querySelector('[data-status]').classList.toggle('pd-error', engine.error);

    pageEl.querySelector('[data-savesession]').disabled = engine.sessionList.length < 2 || engine.busy;
    pageEl.querySelector('[data-stopbtn]').disabled = !!engine.choiceBusy || engine.busy;
    pageEl.querySelector('[data-mixcard]').hidden = !engine.mixPlaylist;
    setText('savedmix', engine.mixPlaylist ? `${engine.mixPlaylist.name} · ${engine.mixPlaylist.count} canciones` : '');

    // Voice & settings tab
    const voiceBtn = pageEl.querySelector('[data-voice]');
    voiceBtn.disabled = !narrator.voice;
    voiceBtn.innerHTML = narrator.enabled ? ICONS.mic : ICONS.micOff;
    voiceBtn.setAttribute('aria-pressed', String(narrator.enabled));
    voiceBtn.setAttribute('aria-label', narrator.enabled ? 'Silenciar voz' : 'Activar voz');

    const serverPill = pageEl.querySelector('[data-serverpill]');
    serverPill.classList.toggle('pd-ok', !!narrator.neural.ok);
    serverPill.textContent = narrator.neural.ok
      ? `Voz neuronal local: conectada ✓ (${narrator.neural.voices.length} voces)`
      : 'Voz neuronal local: no detectada (usando respaldo del sistema)';
    pageEl.querySelector('[data-serverhint]').hidden = !!narrator.neural.ok;

    setText(
      'voicestatus',
      !narrator.voice
        ? 'No hay voz en español disponible. Los comentarios siguen por escrito.'
        : narrator.voice.neural
        ? `Usando voz neuronal local (${narrator.voice.label}).`
        : narrator.voice.localService
        ? `Usando voz local del sistema (${narrator.voice.name}).`
        : 'Voz en línea: el texto del comentario se envía a su proveedor.'
    );
    pageEl.querySelector('[data-voicestatus]').hidden = !pageEl.querySelector('[data-voicestatus]').textContent;

    const pick = pageEl.querySelector('[data-voicepick]');
    const vlist = narrator.voices();
    const pickKey = JSON.stringify(vlist.map(v => [v.name, v.label || v.name]));
    if (pick._key !== pickKey) {
      pick._key = pickKey;
      pick.innerHTML =
        '<option value="">Automática (mejor local)</option><option value="off">Sin voz (solo subtítulos)</option>' +
        vlist
          .map(
            v =>
              `<option value="${esc(v.name)}">${esc(v.label || `${v.name} · ${v.lang}`)}${
                v.localService ? '' : ' · en línea'
              }</option>`
          )
          .join('');
    }
    if (document.activeElement !== pick) {
      pick.value = !engine.settings.voice
        ? 'off'
        : vlist.some(v => v.name === engine.settings.voiceName)
        ? engine.settings.voiceName
        : '';
    }

    setText('ducklabel', engine.settings.duckLevel + '%');
    setText('vvollabel', engine.settings.voiceVolume + '%');
    setText('vspdlabel', (engine.settings.voiceSpeed / 100).toFixed(2) + 'x');
    pageEl.querySelectorAll('[data-range]').forEach(input => {
      if (document.activeElement !== input) input.value = engine.settings[input.dataset.range];
    });

    pageEl.querySelectorAll('[data-select]').forEach(input => {
      if (document.activeElement !== input) input.value = String(engine.settings[input.dataset.select]);
    });
    pageEl.querySelectorAll('[data-setting]').forEach(input => {
      input.checked = !!engine.settings[input.dataset.setting];
      input.disabled = input.dataset.setting === 'takeover' && (engine.active || engine.busy);
    });

    setText('library', engine.libraryBusy ? 'Leyendo tu biblioteca…' : library.status);
    pageEl.querySelector('[data-librarysync]').disabled = !!engine.libraryBusy;
    const playlists = pageEl.querySelector('[data-playlists]');
    const playlistKey = JSON.stringify(library.playlists);
    if (playlists._key !== playlistKey) {
      const selected = playlists.value;
      playlists._key = playlistKey;
      playlists.innerHTML =
        '<option value="">Elige una playlist de tu biblioteca</option>' +
        library.playlists.map(p => `<option value="${esc(p.uri)}">${esc(p.name)}</option>`).join('');
      playlists.value = selected;
    }
    pageEl.querySelector('[data-loadplaylist]').disabled = !!engine.libraryBusy;

    const native = transitions.state();
    setText(
      'transitionstatus',
      native.enabled
        ? `Crossfade de Spotify: ${native.seconds} s. Se priorizan tempo, tono y nivel cuando hay datos.`
        : 'Crossfade de Spotify apagado. Se prioriza continuidad musical cuando hay datos.'
    );
    pageEl.querySelector('[data-applytransition]').disabled = !native.available;
    pageEl.querySelector('[data-restoretransition]').disabled = !native.available;
    pageEl.querySelector('[data-recovervolume]').hidden = !recovery();

    // Tabs visibility and external lyrics provider choice
    const extLyrics = detectExternalLyrics();
    const extActive = useExternalLyrics();
    const lpWrap = pageEl.querySelector('[data-lyricsproviderwrap]');
    const lpSelect = pageEl.querySelector('[data-select="lyricsProvider"]');
    lpWrap.hidden = !extLyrics;
    if (extLyrics && lpSelect._key !== extLyrics.id) {
      lpSelect._key = extLyrics.id;
      lpSelect.innerHTML = `<option value="auto">Usar ${esc(extLyrics.name)} (recomendado)</option><option value="builtin">Usar letras integradas de POOR DJ</option>`;
    }
    if (extLyrics && document.activeElement !== lpSelect) {
      lpSelect.value = engine.settings.lyricsProvider;
    }

    const lyricsTabBtn = pageEl.querySelector('[data-tab="lyrics"]');
    lyricsTabBtn.hidden = !ownLyrics();
    if (!ownLyrics() && L.tab === 'lyrics') setTab('dj');

    const openExtBtn = pageEl.querySelector('[data-openspicy]');
    openExtBtn.hidden = !extActive;
    if (extActive && extLyrics && openExtBtn._key !== extLyrics.id) {
      openExtBtn._key = extLyrics.id;
      openExtBtn.innerHTML = `${ICONS.external}<span>${esc(extLyrics.name)} ↗</span>`;
    }

    const headExtBtn = pageEl.querySelector('[data-openextlyrics]');
    headExtBtn.hidden = !(extLyrics && !extActive);
    if (extLyrics && !extActive && headExtBtn._key !== extLyrics.id) {
      headExtBtn._key = extLyrics.id;
      headExtBtn.innerHTML = `${ICONS.external}<span>Abrir en ${esc(extLyrics.name)} ↗</span>`;
    }

    pageEl.querySelectorAll('[data-setting=lyrics],[data-setting=lyricsExternal]').forEach(i => {
      i.closest('label').hidden = extActive;
    });
    pageEl.querySelector('[data-lrclibnote]').hidden = extActive;

    setText(
      'offsetlabel',
      (engine.settings.lyricsOffset > 0 ? '+' : '') +
        (engine.settings.lyricsOffset / 1000).toFixed(2).replace(/\.?0+$/, '') +
        ' s'
    );

    loadLyrics();
    startFrame();
  }

  const onFullscreen = () => {
    if (!pageEl) return;
    const isFull = document.fullscreenElement === pageEl;
    pageEl.dataset.full = String(isFull);
    const exitBtn = pageEl.querySelector('[data-exitfull]');
    if (exitBtn) exitBtn.hidden = !isFull;
    if (L.tab === 'lyrics') {
      resetViews();
      requestAnimationFrame(tickLyrics);
    }
  };
  document.addEventListener('fullscreenchange', onFullscreen);

  const unlisten = S.Platform.History?.listen?.(loc => {
    const p = loc?.pathname ?? S.Platform.History?.location?.pathname;
    if (p && p !== ROUTE) lastNonDjPath = p;
    update();
  });

  function open() {
    if (!onRoute()) {
      S.Platform.History.push(ROUTE);
    }
    update();
  }

  return {
    open,
    update,
    openLyrics: () => {
      L.tab = 'lyrics';
      if (!onRoute()) S.Platform.History.push(ROUTE);
      else update();
    },
    dispose: () => {
      clearTimeout(fallbackTimer);
      clearTimeout(L.toastTimer);
      toast.remove();
      closePage();
      unlisten?.();
      fallbackButton?.deregister?.();
      playerButtonObserver.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('keydown', shortcut, true);
      cancelAnimationFrame(playerButtonFrame);
      playerButton?.remove();
      cancelAnimationFrame(L.raf);
      L.raf = 0;
      mini.remove();
      style.remove();
    }
  };
}
