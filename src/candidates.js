// Membership is checked against the seed and its explicitly related artists,
// unless a group is marked trusted (e.g., Spotify radio recommendations).
function affinityPool(seed, related, groups, intent = intentOf(), tags = {}) {
  const seedKeys = new Set((seed?.artists || []).map(artistKey));
  const allowed = new Set([...seedKeys, ...related]);
  const result = new Map();

  for (const { tracks, source, familiar = false, trusted = false } of groups) {
    for (const raw of tracks || []) {
      const t = normalize(raw, source);
      if (!t || !t.name) continue;
      const styles = [...new Set([...(t.styles || []), ...(tags[t.uri] || [])].map(words))];
      const styleMatch = intent.styles.length && intent.styles.every(tag => styles.includes(words(tag)));
      if (!trusted && !t.artists.some(a => allowed.has(artistKey(a))) && !styleMatch) continue;
      const existing = result.get(t.uri);
      const same = t.artists.some(a => seedKeys.has(artistKey(a)));
      const evidence = [...new Set([...(raw.evidence || []), ...(existing?.evidence || []), ...(raw.playlist ? ['playlist'] : [])])];
      const radioRank = Number.isFinite(raw.radioRank) ? raw.radioRank : existing?.radioRank;
      const resolvedSource = familiar
        ? source
        : source === 'radio'
        ? 'radio'
        : same
        ? 'artista actual'
        : 'artista relacionado';
      result.set(t.uri, {
        ...t,
        styles,
        source: existing?.familiar ? existing.source : resolvedSource,
        affinity: true,
        evidence,
        familiar: familiar || !!existing?.familiar,
        ...(Number.isFinite(radioRank) ? { radioRank } : {})
      });
    }
  }
  return [...result.values()];
}
