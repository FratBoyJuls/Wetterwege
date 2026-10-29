/* Wetterwege – Formen-Routen (GPS-Kunst): Umriss aus Bild/Schrift/Zeichnung, Platzierung, Formtreue.
   Reine Rechenfunktionen ohne DOM, damit sie auch im Test laufen. */
(function (root) {
  'use strict';
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

  // ---------- Umriss aus einer Pixelmaske ----------
  /**
   * alpha: Uint8 (0..255) Breite w, Höhe h. Liefert die Außenkonturen aller Teile (Löcher werden gefüllt).
   * Ergebnis: [{ pts: [[x,y],...], area, minX, maxX, minY, maxY }], Koordinaten in Pixeln (y nach unten).
   */
  function traceSilhouettes(alpha, w, h, thr = 60, minArea = 30) {
    const N = w * h;
    const on = new Uint8Array(N);
    for (let i = 0; i < N; i++) on[i] = alpha[i] > thr ? 1 : 0;
    // Außenbereich vom Rand aus fluten; alles andere gehört zur Figur (Löcher gefüllt)
    const ext = new Uint8Array(N);
    const q = [];
    const pushIf = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (!on[i] && !ext[i]) { ext[i] = 1; q.push(i); } };
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (q.length) { const i = q.pop(); const x = i % w, y = (i - x) / w; pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1); }
    const solid = new Uint8Array(N);
    for (let i = 0; i < N; i++) solid[i] = ext[i] ? 0 : 1;
    // Zusammenhängende Teile (4er-Nachbarschaft)
    const lab = new Int32Array(N).fill(-1);
    const comps = [];
    for (let i = 0; i < N; i++) {
      if (!solid[i] || lab[i] >= 0) continue;
      const id = comps.length; const stack = [i]; lab[i] = id; let area = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      while (stack.length) {
        const j = stack.pop(); area++;
        const x = j % w, y = (j - x) / w;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
        for (const k of nb) if (k >= 0 && solid[k] && lab[k] < 0) { lab[k] = id; stack.push(k); }
      }
      comps.push({ id, area, minX, maxX, minY, maxY });
    }
    const out = [];
    comps.filter((c) => c.area >= minArea).forEach((c) => {
      const pts = boundaryLoop(lab, w, h, c);
      if (pts && pts.length >= 4) out.push({ ...c, pts });
    });
    return out;
  }

  /** Randkanten eines Teils sammeln und zu einer geschlossenen Linie verketten (im Uhrzeigersinn, Bildkoordinaten) */
  function boundaryLoop(lab, w, h, c) {
    const id = c.id;
    const inC = (x, y) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === id;
    const edges = new Map();
    let first = null;
    const add = (x1, y1, x2, y2) => {
      const k = x1 + ',' + y1;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push([x2, y2]);
      if (!first) first = [x1, y1];
    };
    for (let y = c.minY; y <= c.maxY; y++) for (let x = c.minX; x <= c.maxX; x++) {
      if (!inC(x, y)) continue;
      if (!inC(x, y - 1)) add(x, y, x + 1, y);
      if (!inC(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inC(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inC(x - 1, y)) add(x, y + 1, x, y);
    }
    if (!first) return null;
    const loop = [first.slice()];
    let cur = first, prevDir = [1, 0];
    for (let guard = 0; guard < 4 * w * h; guard++) {
      const k = cur[0] + ',' + cur[1];
      const outs = edges.get(k);
      if (!outs || !outs.length) break;
      let pick = 0;
      if (outs.length > 1) {
        // Am Berührungspunkt immer die schärfste Rechtskurve nehmen
        let best = -Infinity;
        outs.forEach((o, i) => {
          const d = [o[0] - cur[0], o[1] - cur[1]];
          const cross = prevDir[0] * d[1] - prevDir[1] * d[0];
          const dot = prevDir[0] * d[0] + prevDir[1] * d[1];
          const score = cross * 2 + dot;
          if (score > best) { best = score; pick = i; }
        });
      }
      const nxt = outs.splice(pick, 1)[0];
      prevDir = [nxt[0] - cur[0], nxt[1] - cur[1]];
      cur = nxt;
      if (cur[0] === first[0] && cur[1] === first[1]) break;
      loop.push(cur.slice());
    }
    return loop;
  }

  // ---------- Geometrie in Einheitskoordinaten ----------
  function simplifyXY(pts, tol, closed) {
    if (pts.length < 3) return pts.slice();
    const src = closed ? pts.concat([pts[0]]) : pts;
    const keep = new Uint8Array(src.length); keep[0] = keep[src.length - 1] = 1;
    const st = [[0, src.length - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      let md = 0, mi = -1;
      const [x1, y1] = src[a], [x2, y2] = src[b];
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const [x, y] = src[i];
        let t = L2 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0; t = clamp(t);
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    const out = src.filter((_, i) => keep[i]);
    if (closed) out.pop();
    return out;
  }

  function polyLen(pts, closed) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (closed && pts.length > 2) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
    return L;
  }

  /**
   * Konturen (Pixel) zu einer Form in Einheitskoordinaten machen: größte Seite = 1, Mitte = 0, y nach Norden.
   * Mehrere Teile (Buchstaben) werden von links nach rechts sortiert.
   */
  function shapeFromContours(contours, opts = {}) {
    if (!contours.length) return null;
    const maxArea = Math.max(...contours.map((c) => c.area));
    // Winzige Teile (i-Punkte, Krümel) nur bei Schrift behalten
    let parts = contours.filter((c) => c.area >= maxArea * (opts.text ? 0.04 : 0.12));
    if (!opts.text) parts = [parts.reduce((a, b) => (b.area > a.area ? b : a))];
    parts.sort((a, b) => a.minX - b.minX);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    parts.forEach((p) => { minX = Math.min(minX, p.minX); maxX = Math.max(maxX, p.maxX + 1); minY = Math.min(minY, p.minY); maxY = Math.max(maxY, p.maxY + 1); });
    const s = Math.max(maxX - minX, maxY - minY);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const tol = opts.tol || s * 0.012;
    const rings = parts.map((p) => simplifyXY(p.pts, tol, true).map(([x, y]) => [(x - cx) / s, -(y - cy) / s]));
    return { rings: rings.filter((r) => r.length >= 3), w: (maxX - minX) / s, h: (maxY - minY) / s };
  }

  /** Eingebaute Formen, die auch ohne Emoji-Schrift funktionieren */
  const BUILTIN = {
    herz: () => { const r = []; for (let i = 0; i < 72; i++) { const t = (i / 72) * 2 * Math.PI; r.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]); } return r; },
    stern: () => { const r = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 0.42 : 1; r.push([Math.cos(a) * rr, Math.sin(a) * rr]); } return r; },
    kreis: () => { const r = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; r.push([Math.cos(a), Math.sin(a)]); } return r; },
    dreieck: () => [[0, 1], [0.87, -0.5], [-0.87, -0.5]],
    quadrat: () => [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    blitz: () => [[0.1, 1], [-0.55, -0.05], [-0.05, -0.05], [-0.25, -1], [0.55, 0.15], [0.05, 0.15], [0.35, 1]],
    raute: () => [[0, 1], [0.7, 0], [0, -1], [-0.7, 0]],
  };
  function builtinShape(key) {
    const f = BUILTIN[key]; if (!f) return null;
    const ring = f();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    ring.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    const s = Math.max(maxX - minX, maxY - minY), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { rings: [ring.map(([x, y]) => [(x - cx) / s, (y - cy) / s])], w: (maxX - minX) / s, h: (maxY - minY) / s };
  }

  /** Gesamtlänge der Form in Einheiten (inkl. Verbindungen zwischen Teilen) */
  function shapeLength(shape) {
    let L = 0;
    shape.rings.forEach((r, i) => {
      L += polyLen(r, true);
      if (i > 0) { const a = shape.rings[i - 1][0], b = r[0]; L += Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.6; }
    });
    return L;
  }

  // ---------- Auf die Karte legen ----------
  const DIRS = { N: [0, 1], S: [0, -1], O: [1, 0], W: [-1, 0] };
  /**
   * Form am Startpunkt verankern. dir = Richtung, in der die Form vom Start aus liegt.
   * scale = Meter pro Einheit, rot = Drehung in Grad. Liefert eine Punktfolge in lat/lon, die am Start beginnt.
   */
  function placeShape(shape, start, scale, rot, dir = 'N', returnToStart = true) {
    const th = rad(rot || 0), cs = Math.cos(th), sn = Math.sin(th);
    const rings = shape.rings.map((r) => r.map(([x, y]) => [(x * cs - y * sn) * scale, (x * sn + y * cs) * scale]));
    const dv = DIRS[dir] || DIRS.N;
    // Ankerpunkt: der Punkt der ersten Kontur, der am weitesten entgegen der Wunschrichtung liegt
    const first = rings[0];
    let ai = 0, best = Infinity;
    first.forEach(([x, y], i) => { const v = x * dv[0] + y * dv[1]; if (v < best - 1e-9) { best = v; ai = i; } });
    const path = [];
    const rotRing = (r, k) => r.slice(k).concat(r.slice(0, k));
    let cur = rotRing(first, ai);
    path.push(...cur, cur[0]);
    for (let j = 1; j < rings.length; j++) {
      const last = path[path.length - 1];
      let ki = 0, kd = Infinity;
      rings[j].forEach(([x, y], i) => { const d = Math.hypot(x - last[0], y - last[1]); if (d < kd) { kd = d; ki = i; } });
      cur = rotRing(rings[j], ki);
      path.push(...cur, cur[0]);
    }
    const ax = path[0][0], ay = path[0][1];
    const mLat = 111320, mLon = 111320 * Math.cos(rad(start.lat));
    const ll = path.map(([x, y]) => ({ lat: start.lat + (y - ay) / mLat, lon: start.lon + (x - ax) / mLon }));
    if (returnToStart && rings.length > 1) ll.push({ lat: start.lat, lon: start.lon });
    return ll;
  }

  function distM(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function pathLenM(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += distM(pts[i - 1], pts[i]); return L; }

  /** Gleichmäßig entlang der Linie abtasten (Eckpunkte bleiben erhalten) */
  function densify(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = distM(a, b);
      const n = Math.floor(d / step);
      for (let k = 1; k <= n; k++) {
        const f = (k * step) / d; if (f >= 0.999) break;
        out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      }
      out.push(b);
    }
    return out;
  }

  /** Wegpunkte für das Routing: Ecken behalten, Lücken auf höchstens `spacing` Meter füllen, sehr nahe Punkte zusammenfassen */
  function waypointsFor(pts, spacing) {
    const dense = densify(pts, spacing);
    const out = [dense[0]];
    for (let i = 1; i < dense.length; i++) if (distM(out[out.length - 1], dense[i]) >= spacing * 0.45 || i === dense.length - 1) out.push(dense[i]);
    return out;
  }

  /**
   * Formtreue: mittlerer Abstand zwischen Soll-Form und Route (beide Richtungen), bezogen auf die Formgröße.
   * score 1 = deckungsgleich, ab etwa 0,75 gut erkennbar.
   */
  function fidelity(target, route) {
    const lat0 = target[0].lat, mLat = 111320, mLon = 111320 * Math.cos(rad(lat0));
    const P = (p) => [(p.lon - target[0].lon) * mLon, (p.lat - lat0) * mLat];
    const tS = densify(target, 20).map(P), rS = densify(route, 20).map(P);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    tS.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    const size = Math.max(50, Math.hypot(maxX - minX, maxY - minY));
    const meanNN = (A, B) => {
      const cell = 40, grid = new Map();
      B.forEach((p) => { const k = Math.floor(p[0] / cell) + ':' + Math.floor(p[1] / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); });
      let sum = 0;
      A.forEach(([x, y]) => {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
        let best = Infinity;
        for (let r = 0; r < 40 && best > (r - 1) * cell; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const arr = grid.get((gx + dx) + ':' + (gy + dy)); if (!arr) continue;
            for (const p of arr) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < best) best = d; }
          }
        }
        sum += Math.min(best, size);
      });
      return sum / A.length;
    };
    const d1 = meanNN(tS, rS), d2 = meanNN(rS, tS);
    const err = (d1 + d2) / 2;
    return { score: Math.exp(-(err / size) * 11), meanErr: err, size };
  }

  /**
   * Stichwege finden: Liegt ein Wegpunkt neben der Straße, fährt das Routing hin und auf demselben Weg zurück.
   * Liefert die Indizes der Wegpunkte (ohne ersten und letzten), an deren Stelle die Route so einen Abstecher macht.
   */
  function spurWaypoints(route, wps, minSpur = 25) {
    if (!route || route.length < 3 || wps.length < 3) return [];
    const s = densify(route, 8);
    const d = [0];
    for (let i = 1; i < s.length; i++) d.push(d[i - 1] + distM(s[i - 1], s[i]));
    const at = (x) => {
      // Punkt bei Wegstrecke x (Binärsuche)
      let lo = 0, hi = d.length - 1;
      if (x <= 0) return s[0]; if (x >= d[hi]) return s[hi];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] < x) lo = m; else hi = m; }
      const f = (x - d[lo]) / Math.max(1e-9, d[hi] - d[lo]);
      return { lat: s[lo].lat + (s[hi].lat - s[lo].lat) * f, lon: s[lo].lon + (s[hi].lon - s[lo].lon) * f };
    };
    const out = [];
    let from = 0;
    for (let w = 1; w < wps.length - 1; w++) {
      // nächster Routenpunkt, in Fahrtrichtung nach dem vorigen Treffer suchen
      let bi = from, bd = Infinity;
      const lim = Math.min(s.length, from + 4000);
      for (let i = from; i < lim; i++) { const q = distM(s[i], wps[w]); if (q < bd) { bd = q; bi = i; } }
      from = bi;
      const x0 = d[bi];
      let spur = 0;
      for (let r = 10; r <= 400; r += 10) {
        if (x0 - r < 0 || x0 + r > d[d.length - 1]) break;
        if (distM(at(x0 - r), at(x0 + r)) < 14) spur = r; else if (r - spur > 20) break;
      }
      if (spur >= minSpur) out.push(w);
    }
    return out;
  }

  /** Wörter zu Emoji (deutsch und englisch) */
  const WORDS = {
    hippo: '🦛', nilpferd: '🦛', flusspferd: '🦛', qualle: '🪼', jellyfish: '🪼', hund: '🐕', dog: '🐕', katze: '🐈', cat: '🐈',
    fisch: '🐟', fish: '🐟', wal: '🐋', whale: '🐋', delfin: '🐬', delphin: '🐬', dolphin: '🐬', hai: '🦈', shark: '🦈', oktopus: '🐙', krake: '🐙', octopus: '🐙',
    vogel: '🐦', bird: '🐦', ente: '🦆', duck: '🦆', schwan: '🦢', huhn: '🐓', hahn: '🐓', pinguin: '🐧', eule: '🦉', adler: '🦅',
    schwein: '🐖', pig: '🐖', hase: '🐇', kaninchen: '🐇', rabbit: '🐇', elefant: '🐘', elephant: '🐘', giraffe: '🦒', pferd: '🐎', horse: '🐎',
    kuh: '🐄', cow: '🐄', schaf: '🐑', ziege: '🐐', hirsch: '🦌', reh: '🦌', fuchs: '🦊', bär: '🐻', baer: '🐻', bear: '🐻', maus: '🐁', mouse: '🐁',
    dino: '🦕', dinosaurier: '🦕', saurier: '🦕', trex: '🦖', 't-rex': '🦖', schildkröte: '🐢', schildkroete: '🐢', turtle: '🐢', schnecke: '🐌', snail: '🐌',
    schmetterling: '🦋', butterfly: '🦋', biene: '🐝', käfer: '🐞', marienkäfer: '🐞', krebs: '🦀', krabbe: '🦀', eichhörnchen: '🐿️', igel: '🦔', frosch: '🐸',
    baum: '🌳', tree: '🌳', tanne: '🌲', blatt: '🍁', pilz: '🍄', blume: '🌷', kaktus: '🌵', apfel: '🍎', apple: '🍎', birne: '🍐', banane: '🍌', kirsche: '🍒',
    brezel: '🥨', breze: '🥨', brezn: '🥨', pretzel: '🥨', bier: '🍺', beer: '🍺', maß: '🍺', mass: '🍺', pizza: '🍕', eis: '🍦', croissant: '🥐',
    mond: '🌙', moon: '🌙', wolke: '☁️', cloud: '☁️', schneeflocke: '❄️', tropfen: '💧', feuer: '🔥', haus: '🏠', house: '🏠', schuh: '👟', shoe: '👟',
    rakete: '🚀', rocket: '🚀', flugzeug: '✈️', auto: '🚗', fahrrad: '🚲', bike: '🚲', krone: '👑', crown: '👑', gitarre: '🎸', geist: '👻', ghost: '👻',
    daumen: '👍', hand: '✋', faust: '✊', glocke: '🔔', schlüssel: '🔑', anker: '⚓', regenschirm: '☂️', ballon: '🎈', geschenk: '🎁',
  };
  const BUILTIN_WORDS = { herz: 'herz', heart: 'herz', liebe: 'herz', stern: 'stern', star: 'stern', kreis: 'kreis', circle: 'kreis', oval: 'kreis', dreieck: 'dreieck', triangle: 'dreieck', quadrat: 'quadrat', viereck: 'quadrat', square: 'quadrat', blitz: 'blitz', raute: 'raute', diamant: 'raute' };
  const isEmoji = (s) => /\p{Extended_Pictographic}/u.test(s);

  /** Eingabe deuten: eingebaute Form, Emoji-Bild oder Schrift */
  function interpret(input) {
    const raw = (input || '').trim();
    if (!raw) return null;
    const key = raw.toLowerCase().replace(/^(ein|eine|einen|der|die|das|a|an|the)\s+/, '').replace(/[!.?]+$/, '');
    const opts = [];
    if (isEmoji(raw) && [...raw].length <= 3) opts.push({ kind: 'emoji', value: raw, label: raw });
    if (BUILTIN_WORDS[key]) opts.push({ kind: 'builtin', value: BUILTIN_WORDS[key], label: raw });
    if (WORDS[key]) opts.push({ kind: 'emoji', value: WORDS[key], label: raw });
    if (!isEmoji(raw) && raw.length <= 12) opts.push({ kind: 'text', value: raw.toUpperCase(), label: `„${raw.toUpperCase()}“` });
    return opts;
  }

  const api = { spurWaypoints, traceSilhouettes, shapeFromContours, builtinShape, shapeLength, placeShape, waypointsFor, fidelity, interpret, densify, pathLenM, simplifyXY, polyLen, WORDS, BUILTIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WWShape = api;
})(typeof window !== 'undefined' ? window : globalThis);
