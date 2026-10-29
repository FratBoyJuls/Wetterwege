// Schnelle Tests ohne Browser:  node --test test/unit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const P = require('../src/profile.js');
const SH = require('../src/shape.js');
const { mockWeather, mockRoute } = require('./helpers.js');

const START = { lat: 48.1374, lon: 11.5755 };
const condFor = (opts) => { const wx = C.parseWeather(mockWeather(opts), null); return { wx, c: C.computeConditions(wx, Date.now(), 60, 'run') }; };

test('Profile: alle Sportarten und Wetterlagen werden erzeugt', () => {
  for (const sport of ['run', 'walk', 'road', 'gravel', 'mtb']) {
    for (const w of [{}, { wet: 0.9 }, { snow: 0.8, icy: true }, { dark: true }, { storm: true }, { heat: true }, { art: true }]) {
      const txt = P.buildProfile({ sport, green: 0.5, water: 0.3, quiet: 0.6, signals: 0.5, ...w });
      assert.match(txt, /---context:global/);
      assert.match(txt, /assign costfactor/);
      assert.ok(!/NaN|undefined/.test(txt), `${sport} ${JSON.stringify(w)} enthält NaN/undefined`);
    }
  }
});

test('Profile: „So grün wie möglich“ wirkt stärker, bei Sturm nicht in den Wald', () => {
  assert.match(P.buildProfile({ sport: 'run', green: 2.5 }), /assign c_green = 2\.5/);
  assert.match(P.buildProfile({ sport: 'run', green: 2.5, storm: true }), /assign c_green = 0\b/);
});

test('Wetter: nach viel Regen warnt die Ansage, bei Trockenheit „Alles easy“', () => {
  const wet = condFor({ rain: 1.2 }).c;
  assert.ok(wet.p96 > 25, 'Regen der letzten 4 Tage wird gezählt');
  const hw = C.headline(wet);
  assert.equal(hw.tone, 'bad');
  assert.match(hw.text, /letzten 4 Tagen/);
  const dry = condFor({ rain: 0, soil: 0.15 }).c;
  const hd = C.headline(dry);
  assert.equal(hd.tone, 'good');
  assert.match(hd.text, /Alles easy/);
});

test('Wetter: Erklärung nennt die gewählte Matsch-Einstellung', () => {
  const { c } = condFor({ rain: 1.2 });
  const tw = C.timeWindows(condFor({ rain: 1.2 }).wx, Date.now(), 60, 'run');
  const auto = C.explainConditions(c, tw, 'run', { mud: 'auto' });
  assert.ok(auto.effects.some((e) => /gemieden/.test(e.text)));
  const egal = C.explainConditions(c, tw, 'run', { mud: 'ignore', park: true });
  assert.ok(egal.effects.some((e) => /Matsch egal/.test(e.text)));
  assert.ok(egal.effects.some((e) => /So grün wie möglich/.test(e.text)));
  assert.ok(auto.parts.length >= 4 && auto.headline.text.length > 10);
});

test('Bewertung: grüne Runden werden im Park-Modus bevorzugt', () => {
  const a = { length: 10000, greenM: 6000, avgCost: 1.2, overlap: 0, uturns: 0, signalsN: 2, riskN: 0, turnsPerKm: 2 };
  const b = { ...a, greenM: 1000 };
  const sa = C.scoreRoute(a, 10000, 'run', { greenWeight: 1 }), sb = C.scoreRoute(b, 10000, 'run', { greenWeight: 1 });
  assert.ok(sa.total < sb.total);
  assert.equal(C.scoreRoute(a, 10000, 'run', {}).parts.green, -0);
});

test('Rundkurse: Schein-Router liefert Runden nah an der Wunschdistanz', async () => {
  const { c } = condFor({ rain: 0 });
  const r = await C.generateLoops({ start: START, targetM: 8000, sport: 'run', cond: c, route: async (w) => mockRoute(w), seed: 7, concurrency: 2 });
  assert.ok(r.routes.length >= 2);
  r.routes.forEach((x) => assert.ok(Math.abs(x.a.length - 8000) / 8000 < 0.16, `Länge ${x.a.length}`));
  const gpx = C.buildGPX(r.routes[0].a.pts, { name: 'Test', desc: 'Test' });
  assert.match(gpx.xml, /<trkpt lat="48\.137400" lon="11\.575500">/);
});

test('Formen: Herz platzieren, Start und Ende am Startpunkt', () => {
  const heart = SH.builtinShape('herz');
  const pts = SH.placeShape(heart, START, 1500, 0, 'N');
  assert.ok(Math.abs(pts[0].lat - START.lat) < 1e-9 && Math.abs(pts[pts.length - 1].lon - START.lon) < 1e-9);
  assert.ok(Math.max(...pts.map((p) => p.lat)) > START.lat, 'Form liegt nördlich');
  const same = SH.fidelity(pts, pts).score;
  const off = SH.fidelity(pts, pts.map((p) => ({ lat: p.lat + 300 / 111320, lon: p.lon }))).score;
  assert.ok(same > 0.99 && off < 0.7);
});

test('Formen: Stichwege zu Wegpunkten neben der Straße werden erkannt', () => {
  const Pm = (x, y) => ({ lat: 48.1 + y / 111320, lon: 11.5 + x / (111320 * Math.cos(48.1 * Math.PI / 180)) });
  const route = [Pm(0, 0), Pm(500, 0), Pm(500, 80), Pm(500.5, 0), Pm(1000, 0)];
  const wps = [Pm(0, 0), Pm(250, 0), Pm(500, 85), Pm(750, 0), Pm(1000, 0)];
  assert.deepEqual(SH.spurWaypoints(route, wps), [2]);
  assert.deepEqual(SH.spurWaypoints([Pm(0, 0), Pm(1000, 0)], wps), []);
});

test('Formen: Eingaben werden gedeutet', () => {
  assert.equal(SH.interpret('Hippo')[0].kind, 'emoji');
  assert.equal(SH.interpret('ein Herz')[0].kind, 'builtin');
  assert.equal(SH.interpret('42')[0].kind, 'text');
});
