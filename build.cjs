const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
const core = read('core.js');
const versionMatch = core.match(/const VERSION = '([^']+)'/);
if (!versionMatch) throw new Error('VERSION not found in src/core.js');
const version = versionMatch[1];

const exportsList = [
  'Engine',
  'normalize',
  'compatibility',
  'settingsOf',
  'AudioLibrary',
  'RequestCache',
  'sameEntry',
  'affinityPool',
  'guardPlay',
  'parseCommand',
  'intentOf',
  'intentLabels',
  'knownEvidence',
  'migrateProfile',
  'ChoiceDeck',
  'Narrator',
  'NeuralVoice',
  'VoiceGate',
  'MusicLibrary',
  'isKnown',
  'collectArtists',
  'hasArtist',
  'mixUris',
  'artistChoice',
  'transitionFit',
  'transitionLabel',
  'NativeTransitions',
  'commentary',
  'speakable',
  'contextKey',
  'words',
  'songKey',
  'songIdentity',
  'queryDefinition',
  'parseLrc',
  'lyricsFromSpotify',
  'lyricsFromLrclib',
  'activeLine',
  'LyricsProvider',
  'isGap',
  'compatReport',
  'moodOf',
  'fadePlan'
];

const parts = [
  `/* POOR DJ ${version} | AGPL-3.0 */`,
  '(function(root){',
  "'use strict';",
  read('music.js'),
  read('requests.js'),
  core,
  read('intent.js'),
  read('profile.js'),
  read('library.js'),
  read('artists.js'),
  read('transitions.js'),
  read('narrator.js'),
  read('candidates.js'),
  read('playback-guard.js'),
  read('lyrics.js'),
  read('diagnostics.js'),
  `if (typeof module !== 'undefined' && module.exports) { module.exports = { ${exportsList.join(', ')} }; return; }`,
  `const CSS = ${JSON.stringify(read('style.css'))};`,
  read('ui.js'),
  read('runtime.js'),
  "})(typeof window !== 'undefined' ? window : globalThis);"
];

fs.writeFileSync(path.join(__dirname, 'poor-mans-dj.js'), parts.join('\n'));
console.log('Built POOR DJ ' + version);
