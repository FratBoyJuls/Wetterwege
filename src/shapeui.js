  /* Teil 4: Formen-Routen (GPS-Kunst): Motiv deuten, Umriss erzeugen, zeichnen, Größe empfehlen */

  const SHAPE_SUGGEST = [['❤️', 'Herz'], ['⭐', 'Stern'], ['🦛', 'Hippo'], ['🪼', 'Qualle'], ['🥨', 'Brezel'], ['🐟', 'Fisch'], ['', 'MUC'], ['', '42']];
  const KIND_NAME = { builtin: 'Form', emoji: 'Bild', text: 'Schrift' };
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
  const TEXT_FONT = '900 {S}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Arial Black", Arial, sans-serif';

  function renderShapeChips() {
    $('shapeChips').innerHTML = SHAPE_SUGGEST.map(([e, w]) => `<button type="button" class="chip" data-word="${esc(w)}">${e ? `<span class="chip-emoji">${e}</span> ` : ''}${esc(w)}</button>`).join('');
  }

  /** Emoji oder Text auf eine Leinwand malen und den Umriss abtasten */
  function glyphShape(str, isText) {
    const cv = $('shapeCanvas');
    const H = 220;
    const W = isText ? Math.min(1400, 80 + [...str].length * 150) : 220;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    let size = 170;
    ctx.font = isText ? TEXT_FONT.replace('{S}', size) : `${size}px ${EMOJI_FONT}`;
    const mw = ctx.measureText(str).width;
    if (mw > W - 30) { size = Math.floor(size * (W - 30) / mw); ctx.font = isText ? TEXT_FONT.replace('{S}', size) : `${size}px ${EMOJI_FONT}`; }
    ctx.fillText(str, W / 2, H / 2 + 6);
    const d = ctx.getImageData(0, 0, W, H).data;
    const alpha = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) alpha[i] = d[i * 4 + 3];
    const cs = SH.traceSilhouettes(alpha, W, H, 60, 40);
    if (!cs.length) return null;
    // Ersatzkästchen (Gerät kennt das Emoji nicht) erkennen: fast exakt rechteckig
    if (!isText && cs.length === 1) {
      const c = cs[0], box = (c.maxX - c.minX + 1) * (c.maxY - c.minY + 1);
      if (c.area / box > 0.93) return null;
    }
    return SH.shapeFromContours(cs, { text: isText });
  }

  /** Grobe Größenempfehlung aus dem Detailgrad: jede markante Ecke braucht etwa 400 m Straße */
  function aprioriKm(unit) {
    let verts = 0;
    unit.rings.forEach((r) => { verts += SH.simplifyXY(r, 0.03, true).length; });
    const parts = unit.rings.length;
    let km = verts * 0.42 + (parts - 1) * 1.2;
    if (!isFoot()) km *= 1.6;
    km = C.clamp(km, isFoot() ? 3 : 10, isFoot() ? 40 : 150);
    return isFoot() ? Math.round(km * 2) / 2 : Math.round(km / 5) * 5;
  }

  function unitFromLatLngs(pts) {
    const lat0 = pts[0].lat, k = Math.cos((lat0 * Math.PI) / 180);
    const xy = pts.map((p) => [p.lon * k, p.lat]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    xy.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    const s = Math.max(maxX - minX, maxY - minY, 1e-9), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { rings: [xy.map(([x, y]) => [(x - cx) / s, (y - cy) / s])], w: (maxX - minX) / s, h: (maxY - minY) / s, open: true };
  }

  function onShapeInput() {
    const v = $('shapeInput').value;
    const opts = SH.interpret(v) || [];
    R.shapeOpts = opts;
    if (!opts.length) { R.shape = null; renderShapeTab(); drawShapeGhost(); return; }
    // Bild vor Schrift, wenn es ein passendes Emoji gibt
    const i = Math.max(0, opts.findIndex((o) => o.kind === 'builtin'));
    chooseShapeOpt(opts.findIndex((o) => o.kind === 'builtin') >= 0 ? i : 0);
  }
  function chooseShapeOpt(i) {
    const o = R.shapeOpts[i]; if (!o) return;
    R.shapeOptIdx = i;
    const unit = o.kind === 'builtin' ? SH.builtinShape(o.value) : glyphShape(o.value, o.kind === 'text');
    if (!unit || !unit.rings.length) {
      R.shape = { kind: o.kind, value: o.value, label: o.label, error: o.kind === 'emoji' ? 'Dieses Bild kann dein Gerät nicht zeichnen. Probier ein anderes Motiv oder „Schrift“.' : 'Daraus ließ sich keine Form ableiten.' };
    } else {
      const rec = aprioriKm(unit);
      R.shape = { kind: o.kind, value: o.value, label: o.kind === 'emoji' ? `${o.value} ${o.label}` : o.label, unit, rec, km: rec, title: o.kind === 'emoji' ? o.label : o.label };
    }
    renderShapeTab();
    drawShapeGhost(true);
  }

  function shapePathD(unit) {
    return unit.rings.map((r) => 'M' + r.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join('L') + (unit.open ? '' : 'Z')).join('');
  }

  function renderShapeTab() {
    const sh = R.shape;
    const has = !!(sh && sh.unit);
    $('shapeCard').hidden = !sh;
    $('shapeOpts').hidden = !has;
    $('shapeCta').hidden = !has;
    renderHomeExtras();
    if (!sh) return;
    const opts = R.shapeOpts || [];
    $('shapeKind').hidden = sh.kind === 'drawn' || opts.length < 2;
    $('shapeKind').innerHTML = opts.map((o, i) => `<button type="button" data-k="${i}" aria-pressed="${i === R.shapeOptIdx}">${KIND_NAME[o.kind]}${o.kind === 'emoji' ? ' ' + o.value : ''}</button>`).join('');
    if (!has) {
      $('shapePreview').innerHTML = '';
      $('shapeTitle').textContent = sh.label;
      $('shapeCaption').textContent = sh.error || '';
      return;
    }
    $('shapePreview').innerHTML = `<path d="${shapePathD(sh.unit)}" ${sh.unit.open ? 'style="fill:none"' : ''}/>`;
    $('shapeTitle').textContent = sh.kind === 'drawn' ? 'Eigene Zeichnung' : sh.label;
    const parts = sh.unit.rings.length;
    if (sh.kind === 'drawn') {
      $('shapeCaption').textContent = `${fmt1(sh.km)} km Linie. Die Route folgt ihr so genau, wie die Wege es erlauben.`;
    } else {
      $('shapeCaption').textContent = `Empfohlen ab etwa ${fmtNum(sh.rec)} km${parts > 1 ? ` · ${parts} Teile, werden verbunden` : ''}`;
    }
    const drawn = sh.kind === 'drawn';
    $('shapeOpts').querySelector('.stepper-row').hidden = drawn;
    $('shapeDirRow').hidden = drawn;
    $('shapeAuto').closest('.row').hidden = drawn;
    $('shapeDist').value = fmtNum(sh.km); sizeInput($('shapeDist'));
    $('shapeDir').querySelectorAll('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === S.shapeDir)));
    $('shapeAuto').checked = !!S.shapeAuto;
    const dur = durationMin(sh.km);
    let rec;
    if (drawn) rec = `Etwa ${fmtDur(dur)} bei deinem Tempo.`;
    else if (sh.km < sh.rec * 0.75) rec = `Eher klein: unter ${fmtNum(sh.rec)} km gehen Details im Straßennetz verloren. Etwa ${fmtDur(dur)}.`;
    else if (sh.km > sh.rec * 2.2) rec = `Größer als nötig, schon ab ${fmtNum(sh.rec)} km gut erkennbar. Etwa ${fmtDur(dur)}.`;
    else rec = `Gute Größe für diese Form, etwa ${fmtDur(dur)}. Die App prüft beim Berechnen auch kleinere und größere Varianten.`;
    $('shapeRec').textContent = rec;
    $('shapeGo').textContent = drawn ? 'Route entlang der Zeichnung' : 'Form-Route berechnen';
  }
  function sizeInput(el) { el.style.width = Math.max(1, String(el.value).length) + 0.4 + 'ch'; }

  // Straßen verlaufen nie exakt entlang der Form: die Route wird im Schnitt etwa 30 % länger als die Linie
  const DETOUR = 1.3;
  function shapeScale(km) { return (km * 1000) / (SH.shapeLength(R.shape.unit) * DETOUR); }
  function shapeTarget(km, rot = 0) {
    const sh = R.shape;
    if (sh.kind === 'drawn') {
      const pts = sh.drawn.slice();
      if (C.dist(S.start, pts[0]) > 150) { pts.unshift({ lat: S.start.lat, lon: S.start.lon }); pts.push({ lat: S.start.lat, lon: S.start.lon }); }
      return pts;
    }
    return SH.placeShape(sh.unit, S.start, shapeScale(km), rot, S.shapeDir, true);
  }
  /** Vorschau der Form auf der Karte, solange noch keine Route berechnet ist */
  function drawShapeGhost(fit) {
    shapeGroup.clearLayers();
    if (S.tab !== 'shape' || curView() !== 'home' || !R.shape || !R.shape.unit || R.drawing) return;
    const t = shapeTarget(R.shape.km, 0);
    const ll = t.map((p) => [p.lat, p.lon]);
    L.polyline(ll, { color: '#ffffff', weight: 7, opacity: 0.6, interactive: false }).addTo(shapeGroup);
    L.polyline(ll, { color: cssVar('--purple'), weight: 3.5, opacity: 0.9, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(shapeGroup);
    if (fit) fitBounds(L.latLngBounds(ll.concat([[S.start.lat, S.start.lon]])), 16);
  }

  function changeShapeKm(v) {
    if (!R.shape || !R.shape.unit) return;
    R.shape.km = C.clamp(v, 1, 300);
    renderShapeTab(); drawShapeGhost();
  }

  // ---------- Berechnen ----------
  async function generateShape() {
    const sh = R.shape;
    if (R.busy || !sh || !sh.unit) return;
    R.statusTo = 'shape';
    setBusy(true); setProgress(0.03);
    try {
      if (!R.wx) await loadWeather(); else refreshConditions();
      setStatus('Routing-Profil für Formen wird vorbereitet…');
      const prof = await getProfile(routeParams({ art: true }));
      R.profileKind = prof.kind;
      const route = makeRouter(prof);
      const cond = R.cond || { wet: 0, snow: 0 };
      let done = 0, total = 1;
      const run = async (target, meta) => {
        const D = SH.pathLenM(target);
        let wps = SH.waypointsFor(target, C.clamp(D / 55, 90, 400));
        try {
          let geo = null;
          for (let attempt = 0; !geo; attempt++) {
            try { geo = await route(wps); }
            catch (e) {
              const msg = e.raw || e.message || '';
              const m = /section (\d+)/.exec(msg);
              // Wegpunkt in abgeschlossenem Gelände: diesen weglassen, sonst Abstand verdoppeln
              if (attempt < 3 && m && +m[1] + 1 < wps.length - 1) { wps = wps.filter((_, i) => i !== +m[1] + 1); continue; }
              if (attempt < 3 && /zu weit|nicht erreichbar/.test(e.message || '')) { wps = SH.waypointsFor(target, C.clamp(D / 25, 180, 800)); continue; }
              throw e;
            }
          }
          let a = C.analyzeRoute(geo, cond);
          let f = SH.fidelity(target, a.pts);
          // Stichwege zu Wegpunkten neben der Straße entfernen und neu routen
          const spur = SH.spurWaypoints(a.pts, wps);
          if (spur.length) {
            try {
              const w2 = wps.filter((_, i) => !spur.includes(i));
              const g2 = await route(w2);
              const a2 = C.analyzeRoute(g2, cond), f2 = SH.fidelity(target, a2.pts);
              if (f2.score >= f.score - 0.05) { geo = g2; a = a2; f = f2; }
            } catch (e) { /* erste Fassung behalten */ }
          }
          return { a, geo, fid: f.score, meanErr: f.meanErr, target, ...meta };
        } catch (e) { return { err: e, ...meta }; }
        finally { done++; setProgress(0.08 + 0.88 * (done / total)); setStatus(`Form wird auf die Straßen gelegt… ${done} von ${total}`); }
      };
      let cands = [];
      if (sh.kind === 'drawn') {
        total = 1;
        cands = [await run(shapeTarget(), { km: sh.km, rot: 0 })];
      } else {
        const km = sh.km;
        const step = (x) => (isFoot() ? Math.round(x * 2) / 2 : Math.round(x / 5) * 5);
        const sizes = [...new Set([km, step(km * 0.65), step(km * 1.5)].filter((x) => x >= 1))];
        const rots = S.shapeAuto ? [-15, 15] : [];
        total = sizes.length + rots.length;
        setStatus('Form wird auf die Straßen gelegt…');
        cands = await C.pool(sizes, 2, (s) => run(shapeTarget(s, 0), { km: s, rot: 0 }));
        if (rots.length) cands = cands.concat(await C.pool(rots, 2, (rot) => run(shapeTarget(km, rot), { km, rot })));
      }
      const ok = cands.filter((c) => !c.err);
      if (!ok.length) throw cands[0].err || new Error('Keine Route gefunden');
      // Pro Größe die beste Drehung
      const bySize = new Map();
      ok.forEach((c) => { const b = bySize.get(c.km); if (!b || c.fid > b.fid) bySize.set(c.km, c); });
      R.shapeEval = [...bySize.values()].map((c) => ({ km: c.km, fid: c.fid, len: c.a.length / 1000 })).sort((a, b) => a.km - b.km);
      const chosen = bySize.get(sh.km) || [...bySize.values()].sort((a, b) => b.fid - a.fid)[0];
      const others = [...bySize.values()].filter((c) => c !== chosen).sort((a, b) => b.fid - a.fid);
      const list = [chosen, ...others];
      list.forEach((c) => {
        c.kind = 'shape'; c.sport = S.sport; c.shapeLabel = sh.kind === 'drawn' ? 'Zeichnung' : sh.label;
        c.sizeLabel = sh.kind === 'drawn' ? 'wie gezeichnet' : c === chosen ? `gewählte Größe${c.rot ? `, ${c.rot > 0 ? '+' : ''}${c.rot}° gedreht` : ''}` : c.km < chosen.km ? 'kleiner' : 'größer';
      });
      R.routes = list; R.source = 'shape'; R.loopOpts = null;
      R.resTitle = sh.kind === 'drawn' ? 'Deine Zeichnung' : `Form: ${sh.label}`;
      labelRoutes();
      setProgress(1); setStatus('');
      R.shapeLast = { km: chosen.km, fid: chosen.fid };
      showResults();
    } catch (e) {
      setStatus(e.message || String(e), true); setProgress(0);
    } finally {
      setBusy(false);
      setTimeout(() => { if (!R.busy) setProgress(0); }, 900);
    }
  }

  /** Box auf der Ergebnisseite: Formtreue, Größen im Vergleich, Empfehlung */
  function renderShapeBox() {
    const r = R.routes[R.sel]; if (!r || r.kind !== 'shape') { $('shapeBox').hidden = true; return; }
    const pct = Math.round(r.fid * 100);
    const verdict = pct >= 75 ? 'Gut erkennbar' : pct >= 55 ? 'Erkennbar' : 'Kaum erkennbar';
    const ev = R.shapeEval || [];
    let html = `<div class="sb-top"><span class="sb-ring">${ring(pct, 56)}</span><span class="sb-text"><b>${verdict}</b>Formtreue ${pct} %: Die Route liegt im Schnitt ${Math.round(r.meanErr)} m neben der Soll-Form (gestrichelt).</span></div>`;
    if (ev.length > 1) {
      html += `<div class="mini-head">Größe im Vergleich <span class="mini-aside">Formtreue je Größe</span></div><div class="size-chart" role="group" aria-label="Größen">${ev.map((e) => {
        const cls = e.fid >= 0.72 ? 'ok' : e.fid >= 0.55 ? 'mid' : 'low';
        return `<button type="button" class="${cls}${Math.abs(e.km - r.km) < 1e-6 ? ' cur' : ''}" data-pick-km="${e.km}" aria-label="${fmt1(e.len)} km, ${Math.round(e.fid * 100)} Prozent"><span class="bar" style="height:${Math.max(6, Math.round(e.fid * 100))}%"></span><b>${Math.round(e.fid * 100)} %</b><span>${fmt1(e.len)} km</span></button>`;
      }).join('')}</div>`;
    }
    const rec = shapeAdvice(r, ev);
    if (rec) html += `<div class="rec${rec.warn ? ' warn' : ''}"><span>${esc(rec.text)}</span>${rec.km ? `<button type="button" class="link small" data-pick-km="${rec.km}">${fmt1(rec.len)} km zeigen</button>` : ''}</div>`;
    $('shapeBox').innerHTML = html;
    $('shapeBox').hidden = false;
  }
  function shapeAdvice(r, ev) {
    const dur = durationMin(r.a.length / 1000, r.a.asc, r.sport);
    const long = isFoot(r.sport) ? dur > 180 : dur > 360;
    const tail = long ? ` Achtung: das sind etwa ${fmtDur(dur)}.` : '';
    if (R.shape && R.shape.kind === 'drawn') {
      return r.fid >= 0.72 ? (tail ? { text: tail.trim(), warn: true } : null) : { text: 'Die Wege weichen stellenweise von deiner Zeichnung ab. Größer zeichnen oder entlang sichtbarer Straßen malen hilft.' + tail, warn: true };
    }
    if (ev.length < 2) return tail ? { text: tail.trim(), warn: true } : null;
    const good = ev.filter((e) => e.fid >= 0.72);
    const best = ev.reduce((a, b) => (b.fid > a.fid ? b : a));
    if (r.fid >= 0.72) {
      const smaller = good.filter((e) => e.km < r.km - 1e-6).sort((a, b) => a.km - b.km)[0];
      if (smaller) return { text: `Schon mit ${fmt1(smaller.len)} km gut erkennbar (${Math.round(smaller.fid * 100)} %).${tail}`, km: smaller.km, len: smaller.len, warn: long };
      return { text: `Passt: ${fmtKm(r.a.length)} km ist hier eine gute Größe für diese Form.${tail}`, warn: long };
    }
    const larger = good.filter((e) => e.km > r.km).sort((a, b) => a.km - b.km)[0];
    if (larger) return { text: `Zu klein für die Straßen hier, Details gehen verloren. Mit ${fmt1(larger.len)} km wird es deutlich besser (${Math.round(larger.fid * 100)} %).`, km: larger.km, len: larger.len, warn: true };
    if (best !== r && best.fid > r.fid + 0.05) return { text: `Am besten passt ${fmt1(best.len)} km (${Math.round(best.fid * 100)} %).${tail}`, km: best.km, len: best.len, warn: true };
    return { text: 'Die Straßen rund um den Start passen schlecht zu dieser Form. Eine andere Lage (N, O, S, W), ein anderer Startpunkt oder etwas mehr Kilometer helfen.' + tail, warn: true };
  }
  function pickShapeKm(km) {
    const i = R.routes.findIndex((x) => Math.abs(x.km - km) < 1e-6);
    if (i >= 0) selectRoute(i);
  }

  // ---------- Selbst zeichnen ----------
  const D = { strokes: [], cur: null };
  function startDraw() {
    R.drawing = true;
    document.documentElement.classList.add('drawing');
    shapeGroup.clearLayers(); routeGroup.clearLayers();
    const cv = $('drawCanvas'); cv.hidden = false;
    $('drawBar').hidden = false;
    D.strokes = []; D.cur = null;
    setDrawMode('draw');
    if (map.getZoom() < 13) map.setView([S.start.lat, S.start.lon], 14); else panIntoView([S.start.lat, S.start.lon]);
    resizeDraw();
  }
  function resizeDraw() {
    const cv = $('drawCanvas'), wrap = $('mapWrap');
    const dpr = window.devicePixelRatio || 1;
    cv.width = wrap.clientWidth * dpr; cv.height = wrap.clientHeight * dpr;
    cv.style.width = wrap.clientWidth + 'px'; cv.style.height = wrap.clientHeight + 'px';
    redrawDraw();
  }
  function redrawDraw() {
    const cv = $('drawCanvas'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 0, cv.width, cv.height);
    const xy = (p) => { const c = map.latLngToContainerPoint([p.ll.lat, p.ll.lon]); return { x: c.x, y: c.y, ll: p.ll }; };
    const all = D.strokes.concat(D.cur ? [D.cur] : []).map((s) => s.map(xy));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Verbindungen zwischen Strichen dünn
    ctx.setLineDash([3, 7]); ctx.lineWidth = 2; ctx.strokeStyle = cssVar('--purple');
    for (let i = 1; i < all.length; i++) { const a = all[i - 1][all[i - 1].length - 1], b = all[i][0]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.setLineDash([]);
    all.forEach((s) => {
      ctx.beginPath(); s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = cssVar('--purple'); ctx.lineWidth = 5; ctx.stroke();
    });
    const sp = map.latLngToContainerPoint([S.start.lat, S.start.lon]);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 9, 0, Math.PI * 2); ctx.fillStyle = cssVar('--green'); ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    const n = all.reduce((s, x) => s + x.length, 0);
    let len = 0;
    all.flat().forEach((p, i, arr) => { if (i) len += C.dist(arr[i - 1].ll, p.ll); });
    $('drawHint').textContent = n < 2 ? 'Am grünen Punkt anfangen und mit dem Finger malen. Mehrere Striche werden verbunden.' : `${fmt1(len / 1000)} km gezeichnet · ${D.strokes.length} ${D.strokes.length === 1 ? 'Strich' : 'Striche'}`;
    $('drawUndo').disabled = !D.strokes.length;
  }
  function setDrawMode(m) {
    D.mode = m;
    $('drawCanvas').style.pointerEvents = m === 'draw' ? 'auto' : 'none';
    $('drawCanvas').style.cursor = m === 'draw' ? 'crosshair' : '';
    $('drawMode').querySelectorAll('[data-dm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dm === m)));
  }
  function endDraw() {
    R.drawing = false;
    document.documentElement.classList.remove('drawing');
    $('drawCanvas').hidden = true; $('drawBar').hidden = true;
    if (isMobile()) setSheet('mid');
  }
  function finishDraw() {
    const pts = D.strokes.flat().map((p) => ({ lat: p.ll.lat, lon: p.ll.lon }));
    if (pts.length < 5) { toast('Bitte zuerst etwas auf die Karte malen.'); return; }
    const simp = C.simplify(pts, 6);
    const km = SH.pathLenM(simp) / 1000;
    if (km < 0.4) { toast('Die Zeichnung ist sehr klein. Etwas herauszoomen und größer malen.'); return; }
    endDraw();
    R.shapeOpts = []; R.shapeOptIdx = 0;
    $('shapeInput').value = '';
    R.shape = { kind: 'drawn', label: 'Eigene Zeichnung', drawn: simp, unit: unitFromLatLngs(simp), km, rec: km };
    renderShapeTab();
    drawShapeGhost(true);
  }
  function wireDraw() {
    const cv = $('drawCanvas');
    const pt = (e) => { const b = cv.getBoundingClientRect(); const x = e.clientX - b.left, y = e.clientY - b.top; const ll = map.containerPointToLatLng([x, y]); return { x, y, ll: { lat: ll.lat, lon: ll.lng } }; };
    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); D.cur = [pt(e)]; redrawDraw(); });
    cv.addEventListener('pointermove', (e) => {
      if (!D.cur) return;
      const p = pt(e), l = D.cur[D.cur.length - 1];
      if (Math.hypot(p.x - l.x, p.y - l.y) >= 4) { D.cur.push(p); redrawDraw(); }
    });
    const up = () => { if (D.cur) { if (D.cur.length > 1) D.strokes.push(D.cur); D.cur = null; redrawDraw(); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    $('drawUndo').addEventListener('click', () => { D.strokes.pop(); redrawDraw(); });
    $('drawCancel').addEventListener('click', () => { endDraw(); drawShapeGhost(); });
    $('drawDone').addEventListener('click', finishDraw);
    $('drawMode').addEventListener('click', (e) => { const b = e.target.closest('[data-dm]'); if (b) setDrawMode(b.dataset.dm); });
    map.on('move zoom', () => { if (R.drawing) redrawDraw(); });
    window.addEventListener('resize', () => { if (R.drawing) resizeDraw(); });
  }
