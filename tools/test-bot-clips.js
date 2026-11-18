'use strict';
// BOT-04 B: Selbsttest der Cache-Hash-Logik des Clip-Generators, ohne Netz.      node tools/test-bot-clips.js
const assert = require('assert');
const path = require('path');
const Clips = require('./bot-clips.js');

const a = Clips.clipHash('profil-1', 'Aye, Schilde Steuerbord');
assert.strictEqual(a, Clips.clipHash('profil-1', 'Aye, Schilde Steuerbord'), 'gleiche Eingabe, gleicher Hash');
assert.notStrictEqual(a, Clips.clipHash('profil-2', 'Aye, Schilde Steuerbord'), 'anderes Profil, anderer Hash');
assert.notStrictEqual(a, Clips.clipHash('profil-1', 'Aye, Schilde Backbord'), 'anderer Text, anderer Hash');
assert.notStrictEqual(Clips.clipHash('ab', 'c'), Clips.clipHash('a', 'bc'), 'Trenner verhindert Verschmelzen von Profil und Text');
assert.ok(/^[0-9a-f]{16}$/.test(a), 'Hash: 16 Hex-Zeichen');
assert.strictEqual(path.basename(Clips.clipPath('p', 't', '/x')), Clips.clipHash('p', 't') + '.wav');
assert.deepStrictEqual(Clips.qwenProfile([{ default_engine: 'qwen', name: 'a' }, { default_engine: 'chatterbox', name: 'k' }, { default_engine: null, name: 'o' }]).map(p => p.name), ['a']);
console.log('test-bot-clips: ok');
