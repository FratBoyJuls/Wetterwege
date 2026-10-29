  /* Teil 3: Gespeicherte Routen, Lieblingswege, Bedingungen-Seite, Einstellungen */

  // ---------- Ablage: IndexedDB, sonst localStorage ----------
  const DB = {
    db: null, mem: null,
    open() {
      if (this.ready) return this.ready;
      this.ready = new Promise((resolve) => {
        try {
          const rq = indexedDB.open('wetterwege', 1);
          rq.onupgradeneeded = () => { rq.result.createObjectStore('routes', { keyPath: 'id' }); };
          rq.onsuccess = () => { this.db = rq.result; resolve(); };
          rq.onerror = () => { this.db = null; resolve(); };
          setTimeout(() => resolve(), 2500);
        } catch (e) { resolve(); }
      });
      return this.ready;
    },
    tx(mode) { return this.db.transaction('routes', mode).objectStore('routes'); },
    req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async all() {
      await this.open();
      if (this.db) { try { return await this.req(this.tx('readonly').getAll()); } catch (e) { /* weiter */ } }
      return store.get('ww:lib', []);
    },
    async put(rec) {
      await this.open();
      if (this.db) { try { await this.req(this.tx('readwrite').put(rec)); return true; } catch (e) { /* weiter */ } }
      const list = store.get('ww:lib', []).filter((x) => x.id !== rec.id); list.unshift(rec);
      return store.set('ww:lib', list);
    },
    async del(id) {
      await this.open();
      if (this.db) { try { await this.req(this.tx('readwrite').delete(id)); return; } catch (e) { /* weiter */ } }
      store.set('ww:lib', store.get('ww:lib', []).filter((x) => x.id !== id));
    },
    async get(id) { return (await this.all()).find((x) => x.id === id); },
  };
  let libCache = [];
  async function libLoad() {
    libCache = await DB.all();
    // Alte „Gemerkt“-Liste einmalig übernehmen
    const old = store.get('ww:saved', null);
    if (old && old.length) {
      for (const x of old) {
        if (libCache.some((y) => y.id === x.id)) continue;
        const rec = { id: x.id, name: x.name, sport: x.sport, km: x.km, asc: x.asc, created: x.t, lastUsed: x.t, uses: 0, start: x.start || '', reversed: !!x.reversed, geo: x.geo, kind: 'route' };
        rec.thumb = thumbPath(rec.geo.features[0].geometry.coordinates);
        await DB.put(rec); libCache.push(rec);
      }
      try { localStorage.removeItem('ww:saved'); } catch (e) { /* ok */ }
    }
    return libCache;
  }

  function slimGeo(geo) {
    const f = geo.features[0];
    const m = f.properties.messages || [];
    const head = m[0] || [];
    const keep = ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'WayTags', 'NodeTags'].map((k) => head.indexOf(k)).filter((i) => i >= 0);
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'track-length': f.properties['track-length'], 'filtered ascend': f.properties['filtered ascend'], cost: f.properties.cost, messages: m.map((row) => keep.map((i) => row[i])) }, geometry: { type: 'LineString', coordinates: f.geometry.coordinates.map((c) => [+c[0].toFixed(6), +c[1].toFixed(6), Math.round(c[2] || 0)]) } }] };
  }
  /** Vorschaubild: Linie in ein 42×42-Feld einpassen */
  function thumbPath(coords) {
    const step = Math.max(1, Math.floor(coords.length / 120));
    const pts = coords.filter((_, i) => i % step === 0).concat([coords[coords.length - 1]]);
    const lat0 = pts[0][1], k = Math.cos((lat0 * Math.PI) / 180);
    const xy = pts.map((c) => [c[0] * k, -c[1]]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    xy.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    const s = 36 / Math.max(maxX - minX, maxY - minY, 1e-9);
    const ox = 21 - ((maxX - minX) * s) / 2, oy = 21 - ((maxY - minY) * s) / 2;
    return xy.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * s).toFixed(1)},${(oy + (y - minY) * s).toFixed(1)}`).join('');
  }

  async function saveCurrent() {
    const r = R.routes[R.sel]; if (!r || !r.geo) return;
    if (r.libId) {
      const ok = await ask({ title: 'Nicht mehr speichern?', text: `„${r.name}“ wird aus „Gespeichert“ entfernt.`, ok: 'Entfernen', danger: true });
      if (!ok) return;
      await DB.del(r.libId); libCache = libCache.filter((x) => x.id !== r.libId);
      r.libId = null; r.name = null; renderResultsHead(); toast('Entfernt');
      return;
    }
    const sport = r.sport || S.sport;
    const place = (S.start.name || '').split(',')[0];
    const def = r.kind === 'shape' ? `${r.shapeLabel || 'Form'} · ${fmtKm(r.a.length)} km` : `${C.SPORTS[sport].label} ${fmtKm(r.a.length)} km${place ? ' · ' + place : ''}`;
    const name = await ask({ title: 'Route speichern', text: 'Unter diesem Namen findest du sie in „Gespeichert“.', value: def, ok: 'Sichern' });
    if (name === null) return;
    const geo = slimGeo(r.geo);
    const rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || def, sport, km: r.a.length, asc: r.a.asc,
      created: Date.now(), lastUsed: Date.now(), uses: 0, start: S.start.name || '', reversed: !!r.a.reversed, geo,
      thumb: thumbPath(geo.features[0].geometry.coordinates), kind: r.kind === 'shape' ? 'shape' : 'route',
      shape: r.target ? { label: r.shapeLabel || '', target: r.target.map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]), fid: r.fid } : null,
    };
    const ok = await DB.put(rec);
    if (!ok) { toast('Speicher voll, Route konnte nicht gesichert werden.'); return; }
    libCache.unshift(rec);
    r.libId = rec.id; r.name = rec.name;
    renderResultsHead();
    toast('In „Gespeichert“ abgelegt');
  }
  async function renameCurrent() {
    const r = R.routes[R.sel]; if (!r || !r.libId) return;
    const name = await ask({ title: 'Umbenennen', value: r.name, ok: 'Sichern' });
    if (!name) return;
    const rec = libCache.find((x) => x.id === r.libId) || await DB.get(r.libId); if (!rec) return;
    rec.name = name; await DB.put(rec);
    r.name = name; renderResultsHead();
  }
  async function deleteCurrent() {
    const r = R.routes[R.sel]; if (!r || !r.libId) return;
    const ok = await ask({ title: 'Route löschen?', text: `„${r.name}“ wird von diesem Gerät gelöscht.`, ok: 'Löschen', danger: true });
    if (!ok) return;
    await DB.del(r.libId); libCache = libCache.filter((x) => x.id !== r.libId);
    toast('Gelöscht');
    R.routes = []; R.source = null;
    popToHome(); setTab('library');
  }
  async function touchLib(id) {
    const rec = libCache.find((x) => x.id === id); if (!rec) return;
    rec.lastUsed = Date.now(); rec.uses = (rec.uses || 0) + 1; await DB.put(rec);
  }
  async function openSaved(id) {
    const x = libCache.find((s) => s.id === id) || await DB.get(id); if (!x) return;
    if (S.sport !== x.sport) { S.sport = x.sport; persist(); renderPlan(); }
    refreshConditions();
    const cond = R.cond || { wet: 0, snow: 0 };
    let a = C.analyzeRoute(x.geo, cond);
    if (x.reversed) a = C.reverseAnalysis(a);
    if (R.cond) a.wind = C.windSplit(a, R.cond.windDir);
    const r = { a, geo: x.geo, kind: 'saved', libId: x.id, name: x.name, sport: x.sport, sc: null };
    if (x.shape && x.shape.target) { r.target = x.shape.target.map(([lat, lon]) => ({ lat, lon })); r.fid = x.shape.fid; r.shapeLabel = x.shape.label; }
    R.routes = [r]; R.source = 'saved'; R.loopOpts = null; R.resTitle = x.name;
    labelRoutes();
    x.lastUsed = Date.now(); DB.put(x);
    showResults();
  }

  const SORTS = {
    new: (a, b) => b.created - a.created,
    used: (a, b) => (b.lastUsed || 0) - (a.lastUsed || 0),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    short: (a, b) => a.km - b.km,
    long: (a, b) => b.km - a.km,
    flat: (a, b) => a.asc / Math.max(1, a.km) - b.asc / Math.max(1, b.km),
    fav: (a, b) => (b.uses || 0) - (a.uses || 0) || b.created - a.created,
  };
  async function renderLib() {
    await libLoad();
    const q = $('libSearch').value.trim().toLowerCase();
    const sports = [...new Set(libCache.map((x) => x.sport))];
    const hasShapes = libCache.some((x) => x.kind === 'shape');
    const filters = [['all', 'Alle'], ...Object.keys(C.SPORTS).filter((k) => sports.includes(k)).map((k) => [k, C.SPORTS[k].label]), ...(hasShapes ? [['shape', 'Formen']] : [])];
    if (!filters.some(([k]) => k === S.libFilter)) S.libFilter = 'all';
    $('libFilter').innerHTML = filters.length > 2 ? filters.map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${S.libFilter === k}">${esc(l)}</button>`).join('') : '';
    $('libFilter').hidden = filters.length <= 2;
    $('libSort').value = S.libSort;
    let list = libCache.filter((x) => S.libFilter === 'all' || (S.libFilter === 'shape' ? x.kind === 'shape' : x.sport === S.libFilter));
    if (q) list = list.filter((x) => (x.name + ' ' + (x.start || '')).toLowerCase().includes(q));
    list.sort(SORTS[S.libSort] || SORTS.new);
    if (!libCache.length) {
      $('libList').innerHTML = '<li class="empty">Noch nichts gespeichert.<br>Bei einer Route auf <svg style="width:15px;height:15px;vertical-align:-2px;color:var(--accent)"><use href="#i-bookmark"/></svg> tippen, dann landet sie hier.</li>';
      return;
    }
    const sortInfo = { new: (x) => fmtDate(x.created), used: (x) => 'genutzt ' + fmtDate(x.lastUsed || x.created), fav: (x) => `${x.uses || 0}× genutzt`, flat: (x) => `${Math.round(x.asc / Math.max(0.5, x.km / 1000))} hm/km` };
    $('libList').innerHTML = list.length ? list.map((x) => `<li class="libitem"><button type="button" class="lib-open" data-open="${x.id}">
        <span class="lib-thumb"><svg viewBox="0 0 42 42" aria-hidden="true"><path d="${x.thumb || ''}" ${x.kind === 'shape' ? 'style="stroke:var(--purple)"' : ''}/></svg></span>
        <span class="lib-name"><b>${esc(x.name)}</b><span>${fmtKm(x.km)} km · ↑ ${x.asc} m · ${esc(C.SPORTS[x.sport]?.label || '')} · ${esc((sortInfo[S.libSort] || sortInfo.new)(x))}</span></span>
        <svg class="chev-s"><use href="#i-chev"/></svg></button></li>`).join('')
      : '<li class="empty">Nichts gefunden.</li>';
  }
  // ---------- Daten sichern und einspielen ----------
  // Format 2: Einstellungen und Lieblingswege (localStorage) plus gespeicherte Routen (IndexedDB).
  // Format 1 aus Version 0.2.0 wird weiterhin gelesen.
  const DATA_KEYS = ['ww:v1', 'ww:favs', 'ww:recent', 'ww:layer'];
  async function exportAll() {
    await libLoad();
    const data = {};
    DATA_KEYS.forEach((k) => { const v = store.get(k, undefined); if (v !== undefined) data[k] = v; });
    const body = JSON.stringify({ app: 'wetterwege', format: 2, version: VERSION, exported: new Date().toISOString(), data, routes: libCache });
    const file = `wetterwege-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    const msg = `${libCache.length} Routen, ${getFavs().length} Lieblingswege und die Einstellungen gesichert.`;
    if (useShare()) {
      try {
        const f = new File([body], file, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: 'Wetterwege-Sicherung' }).then(() => toast(msg + ' Am besten „In Dateien sichern“ wählen.')).catch((e) => {
            if (e && e.name === 'AbortError') return;
            downloadText(file, body, 'application/json'); toast(msg);
          });
          return;
        }
      } catch (e) { /* Download als Ersatz */ }
    }
    downloadText(file, body, 'application/json'); toast(msg);
  }
  async function importAll(file) {
    let j = null;
    try { j = JSON.parse(await file.text()); } catch (e) { j = null; }
    if (!j || j.app !== 'wetterwege') { toast('Das ist keine Wetterwege-Sicherung.'); return; }
    const d = j.data && typeof j.data === 'object' ? j.data : {};
    let nf = 0, nr = 0;
    // Lieblingswege zusammenführen
    const favIn = Array.isArray(d['ww:favs']) ? d['ww:favs'] : Array.isArray(j.favs) ? j.favs : [];
    const favs = getFavs();
    favIn.forEach((f) => { if (f && f.id && f.pts && !favs.some((x) => x.id === f.id)) { favs.push(f); nf++; } });
    if (nf) { store.set('ww:favs', favs); favCache = null; }
    // Routen: Format 2 direkt, Format 1 über die alte Liste (wird beim Laden übernommen)
    await libLoad();
    if (Array.isArray(d['ww:saved'])) {
      const old = d['ww:saved'].filter((x) => x && x.id && x.geo && !libCache.some((y) => y.id === x.id));
      if (old.length) { store.set('ww:saved', old); nr += old.length; await libLoad(); }
    }
    for (const rec of (Array.isArray(j.routes) ? j.routes : [])) {
      if (!rec || !rec.id || !rec.geo || libCache.some((x) => x.id === rec.id)) continue;
      if (!rec.thumb) rec.thumb = thumbPath(rec.geo.features[0].geometry.coordinates);
      await DB.put(rec); libCache.push(rec); nr++;
    }
    // Einstellungen übernehmen (Startpunkt, Vorlieben, Tempo …)
    const settings = d['ww:v1'] && typeof d['ww:v1'] === 'object';
    if (settings) store.set('ww:v1', d['ww:v1']);
    if (d['ww:layer']) store.set('ww:layer', d['ww:layer']);
    if (Array.isArray(d['ww:recent'])) store.set('ww:recent', d['ww:recent']);
    toast(`Eingespielt: ${nr} Routen, ${nf} Lieblingswege${settings ? ', Einstellungen' : ''}.${settings ? ' Die App startet neu…' : ''}`);
    if (settings) setTimeout(() => location.reload(), 1800);
    else { renderFavs(); if (curView() === 'home' && S.tab === 'library') renderLib(); }
  }

  // ---------- Lieblingswege ----------
  let favCache = null;
  const getFavs = () => store.get('ww:favs', []);
  function favIdx() {
    if (favCache === null) { const f = getFavs(); favCache = f.length ? C.favIndex(f) : false; }
    return favCache || null;
  }
  function parseGpxText(text, fileName) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('keine gültige GPX-Datei');
    let pts = [...doc.getElementsByTagName('trkpt')];
    if (pts.length < 2) pts = [...doc.getElementsByTagName('rtept')];
    const list = pts.map((p) => ({ lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon') })).filter((p) => isFinite(p.lat) && isFinite(p.lon));
    if (list.length < 10) throw new Error('enthält keine Strecke');
    let tol = 4, sp = C.simplify(list, tol);
    while (sp.length > 2500 && tol < 60) { tol *= 1.6; sp = C.simplify(list, tol); }
    let len = 0; for (let i = 1; i < sp.length; i++) len += C.dist(sp[i - 1], sp[i]);
    const nm = (doc.querySelector('trk > name') || doc.querySelector('metadata > name') || doc.querySelector('rte > name'));
    const name = (nm && nm.textContent.trim()) || fileName.replace(/\.gpx$/i, '');
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 60), km: len / 1000, pts: sp.map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]) };
  }
  async function importFavs(files) {
    const favs = getFavs(); let ok = 0; const bad = [];
    for (const f of files) {
      if (!/\.gpx$/i.test(f.name) && !/xml/.test(f.type)) { bad.push(`${f.name}: nur GPX`); continue; }
      try { favs.push(parseGpxText(await f.text(), f.name)); ok++; } catch (e) { bad.push(`${f.name}: ${e.message}`); }
    }
    let saved = store.set('ww:favs', favs);
    while (!saved && favs.length > 1) { favs.shift(); saved = store.set('ww:favs', favs); }
    favCache = null; renderFavs();
    if (ok) toast(`${ok} ${ok === 1 ? 'Strecke' : 'Strecken'} importiert${bad.length ? `, ${bad.length} übersprungen` : ''}`);
    else toast(bad[0] || 'Nichts importiert');
  }
  function renderFavs() {
    const favs = getFavs();
    $('favCount').textContent = favs.length ? `${favs.length} ${favs.length === 1 ? 'Strecke' : 'Strecken'}` : '';
    $('favList').innerHTML = favs.length ? favs.map((f) => `<li class="item"><span class="name"><i class="fav-swatch"></i>${esc(f.name)}<small>${fmt1(f.km)} km</small></span><button type="button" class="icon-btn pill" data-favcheck="${f.id}">Prüfen</button><button type="button" class="icon-btn del" data-favdel="${f.id}" aria-label="${esc(f.name)} entfernen"><svg><use href="#i-trash"/></svg></button></li>`).join('')
      : '<li class="empty">Noch keine Lieblingswege importiert.</li>';
    $('favShow').checked = !!S.favShow;
    favGroup.clearLayers();
    if (S.favShow) {
      const col = cssVar('--purple');
      favs.forEach((f) => L.polyline(f.pts, { color: col, weight: 3, opacity: 0.5, interactive: false }).addTo(favGroup));
    }
  }
  async function checkFav(id) {
    const f = getFavs().find((x) => x.id === id); if (!f || R.busy) return;
    setBusy(true); toast(`„${f.name}“ wird mit dem heutigen Wetter geprüft…`);
    R.statusTo = 'plan';
    try {
      if (!R.wx) await loadWeather(); else refreshConditions();
      const cond = R.cond || { wet: 0, snow: 0, profile: {} };
      const prof = await getProfile(routeParams());
      const route = makeRouter(prof);
      const pts = f.pts.map(([lat, lon]) => ({ lat, lon }));
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + C.dist(pts[i - 1], pts[i]));
      const step = Math.max(250, cum[cum.length - 1] / 70);
      const wps = C.resample(pts, cum, step);
      const last = pts[pts.length - 1];
      if (C.dist(wps[wps.length - 1], last) > 30) wps.push(last);
      const geo = await route(wps);
      const a = C.analyzeRoute(geo, cond);
      a.wind = C.windSplit(a, cond.windDir || 0);
      a.favShare = 1;
      R.routes = [{ a, geo, kind: 'fav', name: f.name, sport: S.sport, sc: null }];
      R.source = 'fav'; R.loopOpts = null; R.resTitle = f.name;
      labelRoutes();
      popToHome();
      showResults();
    } catch (e) { toast(e.message || String(e)); }
    finally { setBusy(false); }
  }

  // ---------- Bedingungen erklärt ----------
  function renderWeather() {
    const c = R.cond, ex = R.explain;
    if (!R.wx || !c) {
      $('wxHero').innerHTML = `<div class="hero-top"><span class="hero-icon" style="background:var(--label-3)"><svg><use href="#i-cloud"/></svg></span><h3>${R.wxErr ? 'Wetter nicht erreichbar' : 'Wetter wird geladen…'}</h3></div><p>${esc(R.wxErr ? 'Ohne Wetterdaten werden Routen normal berechnet, ohne Matsch- oder Schnee-Anpassung.' : '')}</p>`;
      ['wxEffects', 'timeline', 'tlAxis', 'slotInfo', 'mudGauge', 'mudParts', 'condGrid', 'warnList'].forEach((id) => { $(id).innerHTML = ''; });
      return;
    }
    const tStart = S.startT || Date.now();
    const toneBg = { good: 'var(--green)', warn: 'var(--orange)', bad: 'var(--red)', snow: 'var(--cyan)' }[ex.tone];
    const h = R.wx.hours[C.hourIndex(R.wx, tStart)];
    $('wxHero').innerHTML = `<div class="hero-top"><span class="hero-icon" style="background:${toneBg}">${wxIcon(h.code, h.isDay).replace(/class="wx-\w+"/, '')}</span><div><h3>${esc(ex.title)}</h3></div></div>
      <p class="headline ${ex.headline.tone}">${esc(ex.headline.text)}</p>
      <p>${S.startT ? `Für deinen Start ${fmtDay(S.startT)}um ${fmtTime(S.startT)} Uhr` : 'Für einen Start jetzt'}: ${esc(WMO(h.code))}, ${Math.round(c.temp)} °C, Matsch-Index ${ex.wetPct} von 100.</p>
      ${ex.betterAt ? `<p>Besser wäre ${fmtDay(ex.betterAt)}${fmtTime(ex.betterAt)} Uhr. <button type="button" class="link" data-set-t="${ex.betterAt}">Übernehmen</button></p>` : ''}`;
    $('wxEffects').innerHTML = ex.effects.map((e) => `<li><svg><use href="#i-${e.icon}"/></svg><span>${esc(e.text)}</span></li>`).join('')
      + '<li><svg><use href="#i-check"/></svg><span>Auf der Karte zeigt die Linienfarbe später, wo es matschig, verschneit oder dunkel wird.</span></li>';

    // Zeitleiste
    const tw = R.tw;
    const good = cssVar('--green'), warn = cssVar('--orange'), bad = cssVar('--red'), night = cssVar('--indigo');
    let selI = 0;
    $('timeline').innerHTML = tw.slots.map((s, i) => {
      const q = C.clamp(1 - s.pen / 4, 0.14, 1);
      const col = s.pen < 0.7 ? good : s.pen < 1.8 ? warn : bad;
      const isSel = S.startT ? Math.abs(s.t - S.startT) < 30 * 60e3 : i === 0;
      if (isSel) selI = i;
      const tip = `${fmtTime(s.t)} · ${C.slotReasons(s)}`;
      return `<button type="button" data-t="${s.t}" aria-pressed="${isSel}" class="${i === tw.best ? 'best' : ''}" title="${esc(tip)}" aria-label="${esc(tip)}" style="height:${Math.round(q * 100)}%;background:${s.dark ? `color-mix(in srgb, ${col} 40%, ${night})` : col}"></button>`;
    }).join('');
    const ax = [];
    tw.slots.forEach((s, i) => { if (i % 6 === 0) ax.push(`<span>${i === 0 ? 'jetzt' : fmtTime(s.t)}</span>`); });
    $('tlAxis').innerHTML = ax.join('');
    const s = tw.slots[selI];
    const verdict = s.pen < 0.7 ? 'gut' : s.pen < 1.8 ? 'geht' : 'ungünstig';
    $('slotInfo').innerHTML = s ? `<span><b>${selI === 0 ? 'Jetzt' : fmtDay(s.t) + fmtTime(s.t) + ' Uhr'}</b> · ${verdict}${selI === tw.best ? ' · beste Zeit' : ''}</span><span class="muted">${esc(C.slotReasons(s))}</span>` : '';
    $('nowBtn').hidden = !S.startT;

    // Matsch-Index
    const label = ex.scale.find((x) => ex.wetPct >= x.from && ex.wetPct < x.to + (x.to === 100 ? 1 : 0))?.label || '';
    $('mudGauge').innerHTML = `<div class="gauge-val"><b>${ex.wetPct}</b><span class="muted">${esc(label)}${c.snow > 0.05 ? ` · Schnee ${Math.round(c.snow * 100)}` : ''}</span></div>
      <div class="gauge-bar"><span class="gauge-mark" style="left:${C.clamp(ex.wetPct, 2, 98)}%"></span></div>
      <div class="gauge-scale">${ex.scale.map((x) => `<span>${x.label}</span>`).join('')}</div>`;
    $('mudParts').innerHTML = ex.parts.map((p) => `<li><span>${esc(p.label)}</span><b>${esc(p.value)}</b>${p.note ? `<small>${esc(p.note)}</small>` : ''}</li>`).join('')
      + '<li><span>Ab 45 meidet die App Erd- und Wiesenwege</span><b></b><small>darunter nur sehr weiche Wege leicht</small></li>';

    const day = R.wx.days.find((d) => d.sunset > c.startT) || R.wx.days[R.wx.days.length - 1];
    const sunTxt = c.dark ? `Aufgang ${fmtTime(day.sunrise)}` : `Untergang ${fmtTime(day.sunset)}`;
    const cells = [
      ['Regen 72 h', `${fmt1(c.p72)} mm`, `24 h: ${fmt1(c.p24)} mm`],
      c.snowDepthCm >= 0.5 ? ['Schnee', `${Math.round(c.snowDepthCm)} cm`, 'Schneehöhe'] : ['Boden', c.soil != null ? `${Math.round(c.soil * 100)} %` : '–', 'Feuchte oben'],
      ['Temperatur', `${Math.round(c.temp)} °C`, `gefühlt ${Math.round(c.feels ?? c.temp)} °C`],
      ['Wind', `${Math.round(c.windAvg)} km/h`, `aus ${compass(c.windDir)}, Böen ${Math.round(c.gustMax)}`],
      ['Licht', c.dark ? 'dunkel' : 'hell', sunTxt],
      ['Pollen · UV', c.pollen.level >= 2 ? 'erhöht' : c.pollen.level === 1 ? 'gering' : 'keine', `UV ${Math.round(c.uvMax)}${c.pollen.available && c.pollen.level ? ' · ' + c.pollen.text : ''}`],
    ];
    $('condGrid').innerHTML = cells.map(([k, v, sub]) => `<div class="tile"><small>${k}</small><b>${esc(v)}</b><span>${esc(sub)}</span></div>`).join('');
    $('warnList').innerHTML = c.warnings.map((w) => `<li class="${w.tone}">${esc(w.text)}</li>`).join('');
  }
  function setStartT(t) {
    S.startT = (R.tw && R.tw.slots[0] && t === R.tw.slots[0].t) ? null : t;
    refreshConditions();
  }

  // ---------- Einstellungen ----------
  function fillRange(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%'); }
  function renderSettings() {
    applyTheme();
    $('pFav').value = S.favWeight; $('oFav').textContent = S.favWeight + '%'; fillRange($('pFav'));
    $('srvInput').value = S.server || 'https://brouter.de';
    $('appVersion').textContent = 'Version ' + VERSION;
    renderFavs();
  }

  // ---------- Vorlieben ----------
  const PRESETS = [
    { k: 'park', e: '🌳', t: 'Park-Runde', s: 'so grün wie möglich', v: { park: true, green: 100, water: 40, quiet: 80, signals: 60 } },
    { k: 'water', e: '🌊', t: 'Am Wasser', s: 'Isar, Bäche, Seen', v: { park: false, green: 50, water: 100, quiet: 60, signals: 50 } },
    { k: 'quiet', e: '🤫', t: 'Ruhig', s: 'weg vom Verkehr', v: { park: false, green: 60, water: 30, quiet: 100, signals: 60 } },
    { k: 'fast', e: '⚡️', t: 'Zügig', s: 'wenig Ampeln', v: { park: false, green: 10, water: 0, quiet: 40, signals: 100 } },
  ];
  function presetOf(pr) {
    const all = PRESETS.concat([{ k: 'default', v: { park: false, ...DEF.prefs[S.sport] } }]);
    const hit = all.find((p) => Object.entries(p.v).every(([k, v]) => (k === 'park' ? !!pr.park === v : +pr[k] === v)));
    return hit ? hit.k : null;
  }
  const MUD_FOOT = {
    auto: 'Die App schaut aufs Wetter: Nach Regen meidet sie Erd- und Wiesenwege, wenn es trocken ist, nicht.',
    avoid: 'Erd-, Wald- und Wiesenwege werden immer gemieden, auch wenn es trocken ist. Gut für saubere Schuhe.',
    ignore: 'Der Untergrund spielt keine Rolle, auch nach Regen nicht. Matschige Stellen siehst du trotzdem auf der Karte.',
  };
  function prefsSummary() {
    const pr = S.prefs[S.sport], bits = [];
    const pk = presetOf(pr);
    if (pk && pk !== 'default') bits.push(PRESETS.find((p) => p.k === pk).t);
    else {
      if (pr.park) bits.push('So grün wie möglich'); else if (pr.green >= 70) bits.push('viel Grün');
      if (pr.water >= 70) bits.push('am Wasser');
      if (pr.quiet >= 80) bits.push('ruhig');
      if (pr.signals >= 80) bits.push('wenig Ampeln');
      if (!bits.length) bits.push(pk === 'default' ? 'Ausgewogen' : 'Eigene Mischung');
    }
    if (S.mud === 'avoid') bits.push('Matsch meiden'); else if (S.mud === 'ignore') bits.push('Matsch egal');
    if (S.hills) bits.push('flach');
    if (S.lit) bits.push('beleuchtet');
    return bits.join(' · ');
  }
  function renderPrefs() {
    const pr = S.prefs[S.sport];
    $('prefSport').textContent = C.SPORTS[S.sport].label;
    const pk = presetOf(pr);
    $('presetChips').innerHTML = PRESETS.map((p) => `<button type="button" class="preset" data-preset="${p.k}" aria-pressed="${pk === p.k}"><span class="pe">${p.e}</span><b>${p.t}</b><span>${p.s}</span></button>`).join('')
      + `<button type="button" class="preset" data-preset="default" aria-pressed="${pk === 'default'}"><span class="pe">⚖️</span><b>Ausgewogen</b><span>Standard für ${esc(C.SPORTS[S.sport].label)}</span></button>`;
    $('mudSeg').querySelectorAll('[data-mud]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mud === S.mud)));
    $('mudFoot').textContent = MUD_FOOT[S.mud] || MUD_FOOT.auto;
    $('pPark').checked = !!pr.park;
    $('greenRow').classList.toggle('off', !!pr.park);
    [['pGreen', 'oGreen', 'green'], ['pWater', 'oWater', 'water'], ['pQuiet', 'oQuiet', 'quiet'], ['pSig', 'oSig', 'signals']].forEach(([i, o, k]) => { $(i).value = pr[k]; $(o).textContent = pr[k] + '%'; fillRange($(i)); });
    if (pr.park) $('oGreen').textContent = 'max';
    $('pHills').checked = !!S.hills; $('pLit').checked = !!S.lit; $('pVary').checked = !!S.vary; $('pWind').checked = !!S.wind; $('pDir').value = S.dir || '';
    $('prefsShort').textContent = prefsSummary();
  }
  function prefsChanged() { persist(); renderPrefs(); refreshConditions(); }
