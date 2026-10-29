/* Wetterwege – Oberfläche, Teil 1: Grundlagen, Karte, Wetter, Routing, Seiten und Sheet.
   Die Dateien app.js, routes.js, lib.js, shapeui.js und main.js teilen sich einen Gültigkeitsbereich:
   app.js öffnet ihn, main.js schließt ihn (build.py fügt sie zusammen). */
(function () {
  'use strict';
  const C = window.WWCore, P = window.WWProfile, SH = window.WWShape;
  const $ = (id) => document.getElementById(id);
  const fmt1 = (x) => (Math.round(x * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtKm = (m) => fmt1(m / 1000);
  const fmtNum = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
  const fmtTime = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (t) => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  const fmtDur = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const compass = (d) => COMPASS[Math.round(((d % 360) + 360) % 360 / 45) % 8];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const parseNum = (v) => parseFloat(String(v).replace(',', '.'));
  const VERSION = '0.3.0';

  // ---------- Speicher (kleine Einstellungen) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  const DEF = {
    sport: 'run', mode: 'loop', tab: 'plan',
    dist: { run: 10, walk: 5, road: 50, gravel: 40, mtb: 25 },
    pace: { run: '6:00', walk: '4,6', road: '25', gravel: '19', mtb: '14' },
    prefs: {
      run: { green: 50, water: 35, quiet: 60, signals: 60 }, walk: { green: 60, water: 40, quiet: 60, signals: 30 },
      road: { green: 0, water: 0, quiet: 60, signals: 60 }, gravel: { green: 35, water: 25, quiet: 60, signals: 50 }, mtb: { green: 40, water: 20, quiet: 50, signals: 30 },
    },
    hills: false, vary: true, wind: true, dir: '', favWeight: 50, favShow: true,
    start: { lat: 48.1374, lon: 11.5755, name: 'Marienplatz, München' }, dest: null, theme: '',
    server: 'https://brouter.de', colorBy: 'state',
    shapeDir: 'N', shapeAuto: true, libSort: 'new', libFilter: 'all',
    mud: 'auto', lit: false,
  };
  const saved0 = store.get('ww:v1', {});
  const S = Object.assign({}, DEF, saved0);
  ['dist', 'pace', 'prefs'].forEach((k) => { S[k] = Object.assign({}, DEF[k], saved0[k] || {}); });
  Object.keys(DEF.prefs).forEach((k) => { S.prefs[k] = Object.assign({}, DEF.prefs[k], S.prefs[k] || {}); });
  S.startT = null;
  const persist = () => { const { startT, ...rest } = S; void startT; store.set('ww:v1', rest); };

  const R = { wx: null, wxKey: '', wxErr: '', cond: null, tw: null, routes: [], sel: -1, busy: false, profiles: {}, pois: {}, source: null, statusTo: 'plan' };

  // ---------- Bildschirmhöhe: kein schwarzer Rand, kein Zoomen ----------
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  function setAppH() {
    let h = window.innerHeight;
    // iOS-Homescreen-App: innerHeight ist dort manchmal zu klein, darunter bleibt ein schwarzer Streifen
    if (isIOS && standalone()) {
      const land = window.innerWidth > window.innerHeight;
      h = Math.max(h, land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height));
    }
    document.documentElement.style.setProperty('--app-h', h + 'px');
  }
  setAppH();
  window.addEventListener('resize', setAppH);
  window.addEventListener('orientationchange', () => setTimeout(setAppH, 350));
  // Ganze Seite nie zoomen (Karte zoomt selbst)
  ['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.scale !== undefined && e.scale !== 1 && !e.target.closest('#map')) e.preventDefault(); }, { passive: false });

  // ---------- Theme ----------
  function applyTheme() {
    if (S.theme) document.documentElement.setAttribute('data-theme', S.theme); else document.documentElement.removeAttribute('data-theme');
    document.querySelectorAll('#themeSeg [data-theme-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeV === (S.theme || ''))));
    const dark = isDarkTheme();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', dark ? '#000000' : '#f2f2f7'); m.removeAttribute('media'); });
  }
  const isDarkTheme = () => S.theme ? S.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  applyTheme();

  // ---------- Sportarten ----------
  const ICONS = {
    run: '<circle cx="15" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6 12l3-4 4 1 3 4h3M13 9l-2 6"/>',
    walk: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21l2-7 3 3v4M9 12l2-4 3 1 2 4M12 8l-1 6"/>',
    road: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h6l2 8M10 8l3 8h5M14 5h3"/>',
    gravel: '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M6 15l4-7h6l2 7M10 8l3 7h5M14 5h3"/><path d="M3 22h2M9 22h2M15 22h2M20 22h1"/>',
    mtb: '<circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="M6 17l4-7h6l2 7M10 10l3 7h5"/><path d="M2 8l4-5 3 3 3-4 4 6"/>',
  };
  const DIST_CHIPS = { run: [5, 8, 10, 15, 21.1], walk: [3, 5, 8, 12], road: [30, 50, 80, 120], gravel: [25, 40, 60, 90], mtb: [15, 25, 40] };
  const isFoot = (s = S.sport) => C.SPORTS[s].foot;
  const distStep = (v) => (isFoot() ? (v < 5 ? 0.5 : 1) : 5);
  const sportVerb = (s = S.sport) => (s === 'walk' ? 'Spaziergang' : s === 'run' ? 'Lauf' : 'Tour');

  function paceMinPerKm(sport = S.sport) {
    const v = String(S.pace[sport] || '').replace(',', '.').trim();
    if (sport === 'run') {
      const m = v.match(/^(\d+)(?::(\d{1,2}))?$/);
      if (m) return +m[1] + (m[2] ? +m[2] / 60 : 0);
      const f = parseFloat(v); return f > 2 && f < 20 ? f : 6;
    }
    const kmh = parseFloat(v) || C.SPORTS[sport].kmh;
    return 60 / Math.max(1, kmh);
  }
  function durationMin(km, asc = 0, sport = S.sport) {
    const climb = sport === 'walk' ? asc * 0.1 : sport === 'run' ? asc * 0.05 : asc * 0.06;
    return km * paceMinPerKm(sport) + climb;
  }
  function plannedDistKm() {
    if (S.tab === 'shape' && R.shape) return R.shape.km || 5;
    if (S.mode === 'loop') return +S.dist[S.sport] || 5;
    if (S.dest) return (C.dist(S.start, S.dest) * 1.3) / 1000;
    return 5;
  }

  // ---------- Karte ----------
  const map = L.map('map', { zoomControl: false, attributionControl: true, tapTolerance: 12 }).setView([S.start.lat, S.start.lon], 13);
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';
  const TILE = {
    osmde: { url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', o: { maxZoom: 19, attribution: OSM + ' · Kacheln: openstreetmap.de' } },
    cyclosm: { url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', o: { maxZoom: 20, subdomains: 'abc', attribution: OSM + ' · CyclOSM' } },
    topo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', o: { maxZoom: 17, subdomains: 'abc', attribution: OSM + ', SRTM · © OpenTopoMap (CC-BY-SA)' } },
    osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', o: { maxZoom: 19, attribution: OSM } },
    sat: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19, attribution: 'Luftbild © Esri, Maxar, Earthstar Geographics' } },
  };
  const LAYER_ORDER = ['osmde', 'osm', 'cyclosm', 'topo'];
  let tileLayer = null, layerName = store.get('ww:layer', 'osmde');
  function setLayer(n, auto) {
    layerName = TILE[n] ? n : 'osmde';
    if (tileLayer) map.removeLayer(tileLayer);
    const def = TILE[layerName];
    tileLayer = L.tileLayer(def.url, def.o).addTo(map);
    let ok = 0, bad = 0;
    tileLayer.on('tileload', () => { ok++; });
    tileLayer.on('tileerror', () => {
      bad++;
      if (bad >= 6 && ok === 0 && layerName !== 'sat') {
        const next = LAYER_ORDER[(LAYER_ORDER.indexOf(layerName) + 1) % LAYER_ORDER.length];
        if (!auto || next !== store.get('ww:layer', 'osmde')) { toast('Kartenserver nicht erreichbar, wechsle die Karte.'); setLayer(next, true); }
      }
    });
    $('layerSel').querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === layerName || (layerName === 'osm' && b.dataset.layer === 'osmde'))));
    $('mapWrap').classList.toggle('sat', layerName === 'sat');
    if (!auto) store.set('ww:layer', layerName);
  }
  setLayer(layerName);
  const pinIcon = (color) => L.divIcon({ className: '', html: `<div class="ww-pin" style="background:${color}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  const startMarker = L.marker([S.start.lat, S.start.lon], { draggable: true, icon: pinIcon(cssVar('--green')), title: 'Start', zIndexOffset: 1000 }).addTo(map);
  let destMarker = null;
  startMarker.on('dragend', () => { const p = startMarker.getLatLng(); setStart({ lat: p.lat, lon: p.lng }, true); });
  const favGroup = L.layerGroup().addTo(map);
  const routeGroup = L.layerGroup().addTo(map);
  const poiGroup = L.layerGroup().addTo(map);
  const shapeGroup = L.layerGroup().addTo(map);

  function setStart(p, reverse) {
    S.start = { lat: p.lat, lon: p.lon, name: p.name || '' };
    startMarker.setLatLng([p.lat, p.lon]);
    $('startInput').value = p.name || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    persist();
    if (reverse && !p.name) reverseName(p).then((n) => { if (n && S.start.lat === p.lat) { S.start.name = n; $('startInput').value = n; persist(); } });
    onStartChanged();
    loadWeather();
  }
  function setDest(p, reverse) {
    S.dest = p ? { lat: p.lat, lon: p.lon, name: p.name || '' } : null;
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    if (S.dest) {
      destMarker = L.marker([p.lat, p.lon], { draggable: true, icon: pinIcon(cssVar('--red')), title: 'Ziel', zIndexOffset: 1000 }).addTo(map);
      destMarker.on('dragend', () => { const q = destMarker.getLatLng(); setDest({ lat: q.lat, lon: q.lng }, true); });
      $('destInput').value = p.name || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
      if (reverse && !p.name) reverseName(p).then((n) => { if (n && S.dest && S.dest.lat === p.lat) { S.dest.name = n; $('destInput').value = n; persist(); } });
    } else $('destInput').value = '';
    persist(); refreshConditions();
  }

  // ---------- Suche (Photon) ----------
  function placeLabel(f) {
    const p = f.properties;
    const main = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city;
    const sub = [p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '', p.district || p.locality, p.city].filter(Boolean).join(', ');
    return { main, sub };
  }
  async function searchPlaces(q) {
    const c = map.getCenter();
    const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&limit=6&lang=de`;
    const r = await fetchT(u, {}, 10000); const j = await r.json();
    return (j.features || []).map((f) => ({ ...placeLabel(f), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
  }
  async function reverseName(p) {
    try {
      const r = await fetchT(`https://photon.komoot.io/reverse?lon=${p.lon}&lat=${p.lat}&lang=de&limit=1`, {}, 8000);
      const j = await r.json(); const f = j.features && j.features[0];
      if (!f) return '';
      const l = placeLabel(f); return [l.main, l.sub.split(', ').pop()].filter(Boolean).join(', ');
    } catch (e) { return ''; }
  }
  function wireSearch(inputId, boxId, onPick) {
    const inp = $(inputId), box = $(boxId);
    let tmr = null, items = [];
    const close = () => { box.hidden = true; };
    inp.addEventListener('focus', () => { inp.select(); });
    inp.addEventListener('input', () => {
      clearTimeout(tmr);
      const q = inp.value.trim();
      if (q.length < 3) { close(); return; }
      tmr = setTimeout(async () => {
        try {
          items = await searchPlaces(q);
          box.innerHTML = items.length ? items.map((it, i) => `<button type="button" data-i="${i}">${esc(it.main)}<small>${esc(it.sub)}</small></button>`).join('') : '<button type="button" disabled>Nichts gefunden</button>';
          box.hidden = false;
        } catch (e) { box.innerHTML = '<button type="button" disabled>Suche gerade nicht erreichbar</button>'; box.hidden = false; }
      }, 300);
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (items[0] && !box.hidden) pick(0); else inp.blur(); } if (e.key === 'Escape') close(); });
    box.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) pick(+b.dataset.i); });
    document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== inp) close(); });
    function pick(i) {
      const it = items[i]; if (!it) return;
      close(); inp.blur();
      const name = [it.main, (it.sub || '').split(', ').pop()].filter(Boolean).join(', ');
      onPick({ lat: it.lat, lon: it.lon, name });
      map.setView([it.lat, it.lon], Math.max(map.getZoom(), 14));
      if (isMobile()) setSheet('mid');
    }
  }

  // ---------- Netzwerk ----------
  async function fetchT(url, opts = {}, ms = 30000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ac.signal }); }
    catch (e) { if (e.name === 'AbortError') throw new Error('Zeitüberschreitung bei ' + new URL(url).host); throw new Error('Keine Verbindung zu ' + new URL(url).host); }
    finally { clearTimeout(t); }
  }

  // ---------- Wetter ----------
  async function loadWeather(force) {
    const key = S.start.lat.toFixed(2) + ',' + S.start.lon.toFixed(2);
    if (!force && R.wx && R.wxKey === key && Date.now() - R.wx.fetched < 20 * 60e3) { refreshConditions(); return R.wx; }
    const base = `latitude=${S.start.lat.toFixed(4)}&longitude=${S.start.lon.toFixed(4)}&timezone=auto`;
    const hv = 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,precipitation_probability,snowfall,snow_depth,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,soil_moisture_0_to_1cm,et0_fao_evapotranspiration,uv_index,is_day';
    const u1 = `https://api.open-meteo.com/v1/forecast?${base}&hourly=${hv}&daily=sunrise,sunset&past_days=4&forecast_days=3&wind_speed_unit=kmh`;
    const u2 = `https://air-quality-api.open-meteo.com/v1/air-quality?${base}&hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,ragweed_pollen&forecast_days=3`;
    try {
      const [r1, r2] = await Promise.allSettled([fetchT(u1, {}, 15000).then((r) => r.json()), fetchT(u2, {}, 15000).then((r) => r.json())]);
      if (r1.status !== 'fulfilled' || r1.value.error) throw new Error(r1.reason ? r1.reason.message : r1.value.reason);
      R.wx = C.parseWeather(r1.value, r2.status === 'fulfilled' && !r2.value.error ? r2.value : null);
      R.wxKey = key; R.wxErr = '';
    } catch (e) {
      R.wx = null; R.cond = null; R.wxErr = e.message || 'nicht erreichbar';
    }
    refreshConditions();
    return R.wx;
  }
  function wxIconKey(code, isDay) {
    if (code == null) return 'cloud';
    return code >= 95 ? 'bolt' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : code >= 51 ? 'rain' : code >= 45 ? 'fog' : code >= 2 ? 'cloud' : isDay === 0 ? 'moon' : 'sun';
  }
  function wxIcon(code, isDay) {
    const k = wxIconKey(code, isDay);
    return `<svg class="wx-${k === 'fog' ? 'cloud' : k}" aria-hidden="true"><use href="#i-${k}"/></svg>`;
  }
  const WMO = (c) => c == null ? '' : c === 0 ? 'klar' : c <= 2 ? 'leicht bewölkt' : c === 3 ? 'bedeckt' : c <= 48 ? 'Nebel' : c <= 57 ? 'Niesel' : c <= 67 ? 'Regen' : c <= 77 ? 'Schnee' : c <= 82 ? 'Schauer' : c <= 86 ? 'Schneeschauer' : 'Gewitter';
  const TONE_ICON = { good: 'ok', warn: 'mud', bad: 'rain', snow: 'snow' };

  function refreshConditions() {
    if (!R.wx) { R.cond = null; R.tw = null; renderWxSummary(); return; }
    if (S.startT && S.startT < Date.now() - 45 * 60e3) S.startT = null;
    const t = S.startT || Date.now();
    const dur = durationMin(plannedDistKm());
    R.cond = C.computeConditions(R.wx, t, dur, S.sport);
    R.tw = C.timeWindows(R.wx, Date.now(), dur, S.sport);
    R.explain = C.explainConditions(R.cond, R.tw, S.sport, { mud: S.mud, park: !!S.prefs[S.sport].park, lit: !!S.lit });
    renderWxSummary();
    if (curView() === 'weather') renderWeather();
    if (curView() === 'results' && R.sel >= 0) renderDetail();
  }

  function renderWxSummary() {
    const pill = $('wxPill'), c = R.cond;
    if (!R.wx || !c) {
      pill.innerHTML = '<span class="wx-temp">–</span>';
      $('wxCardIcon').className = 'wx-card-icon';
      $('wxCardIcon').innerHTML = '<svg><use href="#i-cloud"/></svg>';
      $('wxCardTitle').textContent = R.wxErr ? 'Wetter nicht erreichbar' : 'Wetter wird geladen…';
      $('wxCardSub').textContent = R.wxErr ? 'Routen werden ohne Wetteranpassung berechnet.' : '';
      $('whenShort').textContent = 'jetzt';
      return;
    }
    const h = R.wx.hours[C.hourIndex(R.wx, Date.now())];
    pill.innerHTML = `${wxIcon(h.code, h.isDay)}<span class="wx-temp">${Math.round(h.temp)}°</span>`;
    pill.setAttribute('aria-label', `Jetzt ${Math.round(h.temp)} Grad, ${WMO(h.code)}. Bedingungen anzeigen`);
    const ex = R.explain;
    $('wxCardIcon').className = 'wx-card-icon tone-' + ex.headline.tone;
    $('wxCardIcon').innerHTML = `<svg><use href="#i-${TONE_ICON[ex.tone] || 'ok'}"/></svg>`;
    $('wxCardTitle').textContent = ex.title;
    $('wxCardSub').textContent = ex.headline.text;
    const tw = R.tw, b = tw && tw.slots[tw.best];
    $('whenShort').textContent = S.startT ? `${fmtDay(S.startT)}${fmtTime(S.startT)} Uhr` : (b && tw.best > 0 ? `jetzt · besser ${fmtTime(b.t)}` : 'jetzt');
  }
  function fmtDay(t) {
    const d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return '';
    const tm = new Date(n); tm.setDate(n.getDate() + 1);
    return d.toDateString() === tm.toDateString() ? 'morgen ' : d.toLocaleDateString('de-DE', { weekday: 'short' }) + ' ';
  }

  // ---------- Routing ----------
  // brouter.de ist ein freier, spendenfinanzierter Server mit Anfragelimit (etwa 24 Anfragen am Stück).
  const serverUrl = () => (S.server || 'https://brouter.de').replace(/\/+$/, '').replace(/\/brouter$/, '');
  const isPublic = () => /(^|\/\/)brouter\.de/.test(serverUrl());
  const callLog = [];
  async function takeSlot() {
    if (!isPublic()) return;
    for (;;) {
      const now = Date.now();
      while (callLog.length && now - callLog[0] > 60000) callLog.shift();
      const last = callLog[callLog.length - 1] || 0;
      if (callLog.length < 20 && now - last >= 300) { callLog.push(now); return; }
      const wait = callLog.length >= 20 ? callLog[0] + 60000 - now + 50 : 300 - (now - last);
      if (wait > 2500) setStatus(`Kurze Pause wegen Anfragelimit des freien Routing-Servers (${Math.ceil(wait / 1000)} s)…`);
      await sleep(Math.min(wait, 1000));
    }
  }
  async function brouterFetch(url, opts, ms) {
    for (let attempt = 0; ; attempt++) {
      await takeSlot();
      const r = await fetchT(url, opts, ms);
      if (r.status === 403 || r.status === 429) {
        const tx = await r.text();
        if (attempt < 3 && /retry later|too many/i.test(tx)) {
          for (let k = 32; k > 0; k--) { setStatus(`Der freie Routing-Server bremst kurz (Anfragelimit). Weiter in ${k} s…`); await sleep(1000); }
          setStatus('Routen werden weiter berechnet…');
          continue;
        }
        return { ok: false, status: r.status, text: async () => tx };
      }
      return r;
    }
  }
  const BUILTIN = { run: 'hiking-mountain', walk: 'hiking-mountain', road: 'fastbike', gravel: 'trekking', mtb: 'trekking' };
  async function uploadProfile(text) {
    const h = C.hashStr(serverUrl() + text);
    if (R.profiles[h]) return R.profiles[h];
    const r = await brouterFetch(serverUrl() + '/brouter/profile', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text }, 20000);
    const tx = await r.text();
    let j;
    try { j = JSON.parse(tx); } catch (e) { throw new Error(brouterError(tx)); }
    if (j.error) throw Object.assign(new Error(j.error), { profileError: true });
    R.profiles[h] = j.profileid;
    return j.profileid;
  }
  async function getProfile(params) {
    try { return { id: await uploadProfile(P.buildProfile(params)), kind: 'custom', params }; }
    catch (e) {
      if (e.profileError) {
        try { return { id: await uploadProfile(P.buildProfile({ ...params, lite: true })), kind: 'lite', params: { ...params, lite: true } }; } catch (e2) { /* weiter */ }
        return { id: BUILTIN[params.sport], kind: 'builtin', params };
      }
      throw e;
    }
  }
  function brouterError(t) {
    const s = String(t || '');
    if (/not mapped|position not mapped/i.test(s)) return 'Ein Punkt liegt zu weit von einem Weg entfernt.';
    if (/target island|island/i.test(s)) return 'Ein Punkt ist von hier aus nicht erreichbar (abgeschlossenes Gelände?).';
    if (/timeout|time.?out/i.test(s)) return 'Der Routing-Server hat zu lange gebraucht.';
    if (/operation killed|busy|too many|retry later/i.test(s)) return 'Der freie Routing-Server ist gerade ausgelastet oder hat das Anfragelimit erreicht. In einer Minute nochmal versuchen.';
    return s.slice(0, 160) || 'Unbekannter Routing-Fehler';
  }
  function makeRouter(prof) {
    let cur = prof;
    return async function route(wps, alt = 0) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const ll = wps.map((p) => p.lon.toFixed(6) + ',' + p.lat.toFixed(6)).join('|');
        const u = `${serverUrl()}/brouter?lonlats=${ll}&profile=${encodeURIComponent(cur.id)}&alternativeidx=${alt}&format=geojson&timode=0`;
        const r = await brouterFetch(u, {}, 60000);
        const tx = await r.text();
        if (r.ok && tx.trim().startsWith('{')) return JSON.parse(tx);
        if (attempt === 0 && cur.kind !== 'builtin' && /profile|custom_|file/i.test(tx)) {
          R.profiles = {};
          cur = await getProfile(cur.params);
          continue;
        }
        throw Object.assign(new Error(brouterError(tx)), { raw: tx });
      }
      throw new Error('Routing fehlgeschlagen');
    };
  }
  /** Grün-Gewicht fürs Routing: „So grün wie möglich“ wirkt etwa viermal so stark wie der Regler auf 100 % */
  const greenParam = (pr) => (pr.park ? 2.5 : pr.green / 100);
  function routeParams(extra = {}) {
    const cond = R.cond || { profile: {} };
    const pr = S.prefs[S.sport];
    const wx = { ...(cond.profile || {}) };
    if (S.mud === 'avoid') wx.wet = Math.max(wx.wet || 0, 0.65);
    if (S.mud === 'ignore') wx.wet = 0;
    if (S.lit) wx.dark = true;
    return { sport: S.sport, ...wx, green: greenParam(pr), water: pr.water / 100, quiet: pr.quiet / 100, signals: pr.signals / 100, avoidHills: !!S.hills, ...extra };
  }

  // Status und Fortschritt gehen an den gerade aktiven Bereich (Runde oder Form)
  function statusEls() { return R.statusTo === 'shape' ? [$('shapeStatus'), $('shapeProg')] : [$('status'), $('prog')]; }
  function setProgress(f) { const el = statusEls()[1]; el.style.width = Math.round(f * 100) + '%'; el.parentElement.classList.toggle('on', f > 0); }
  function setStatus(t, err) { const el = statusEls()[0]; el.textContent = t || ''; el.classList.toggle('err', !!err); }

  // ---------- Seiten (Navigation wie in iOS) ----------
  const stack = ['home'];
  const curView = () => stack[stack.length - 1];
  function showView(name, back) {
    document.querySelectorAll('#views .view').forEach((v) => { v.hidden = v.dataset.view !== name; });
    const v = $('v-' + name);
    v.classList.remove('enter', 'enter-back'); void v.offsetWidth; v.classList.add(back ? 'enter-back' : 'enter');
  }
  function pushView(name) {
    if (curView() === name) { onViewShown(name); return; }
    const prev = curView();
    stack.push(name);
    showView(name);
    onViewLeft(prev, name);
    onViewShown(name);
  }
  function popView() {
    if (stack.length < 2) return;
    const leaving = stack.pop();
    showView(curView(), true);
    onViewLeft(leaving, curView());
    onViewShown(curView());
  }
  function popToHome() { while (stack.length > 1) popView(); }
  function onViewShown(name) {
    if (name === 'weather') renderWeather();
    if (name === 'settings') renderSettings();
    if (name === 'prefs') renderPrefs();
    if (name === 'home') { renderHomeExtras(); if (S.tab === 'library') renderLib(); }
    const body = $('v-' + name).querySelector('.vbody'); if (body && name !== 'home') body.scrollTop = 0;
    requestAnimationFrame(() => { if (isMobile()) setSheet(name === 'results' ? 'mid' : sheetState === 'peek' ? 'mid' : sheetState); });
  }
  function onViewLeft(name, to) {
    if (name === 'results' && to === 'home') clearRouteLayers();
  }
  function clearRouteLayers() {
    routeGroup.clearLayers(); poiGroup.clearLayers(); shapeGroup.clearLayers();
    $('mapLegend').hidden = true;
    R.sel = -1;
    if (S.tab === 'shape') drawShapeGhost();
  }

  // ---------- Bottom-Sheet (Handy) ----------
  const sheet = $('sheet');
  const mq = matchMedia('(max-width: 760px)');
  const isMobile = () => mq.matches;
  let sheetState = 'mid', sheetY = 0;
  function detents() {
    const H = sheet.offsetHeight;
    const v = $('v-' + curView());
    const head = v.querySelector('.vhead');
    let vis = 20 + (head ? head.offsetHeight : 52);
    if (curView() === 'home') vis += v.querySelector('.tabs-wrap').offsetHeight + 4;
    else vis += 64;
    vis = Math.min(vis, H * 0.45);
    return { full: 0, mid: Math.round(H * 0.48), peek: Math.round(H - vis), H };
  }
  function applySheetY(y, animate = true) {
    sheetY = y;
    sheet.classList.toggle('dragging', !animate);
    const st = document.documentElement.style;
    st.setProperty('--sheet-y', y + 'px');
    st.setProperty('--sheet-pad', (isMobile() ? Math.max(0, y) : 0) + 'px');
    st.setProperty('--map-bottom', isMobile() ? Math.max(0, detents().H - y) + 'px' : '0px');
  }
  function setSheet(state) {
    if (!isMobile()) return;
    sheetState = state;
    document.documentElement.classList.toggle('sheet-full', state === 'full');
    applySheetY(detents()[state]);
  }
  function sheetVisible() { return isMobile() ? detents().H - sheetY : 0; }
  function snapSheet(vel) {
    const d = detents();
    const target = sheetY + vel * 200;
    let best = 'full';
    ['full', 'mid', 'peek'].forEach((k) => { if (Math.abs(d[k] - target) < Math.abs(d[best] - target)) best = k; });
    setSheet(best);
  }
  function initSheet() {
    // 1) Ziehen am Griff und an den Kopfzeilen
    let startY = 0, startSheet = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, moved = false, fromGrab = false;
    const begin = (e) => {
      if (!isMobile() || e.button > 0) return;
      dragging = true; moved = false; fromGrab = e.currentTarget.id === 'grabber';
      startY = lastY = e.clientY; lastT = performance.now(); startSheet = sheetY; vel = 0;
    };
    const move = (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) > 6) { moved = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ok */ } }
      if (!moved) return;
      const now = performance.now();
      vel = (e.clientY - lastY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
      let y = startSheet + dy;
      if (y < 0) y = y / 3;
      applySheetY(Math.min(detents().peek + 30, y), false);
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) { if (fromGrab) setSheet(sheetState === 'peek' ? 'mid' : sheetState === 'mid' ? 'full' : 'mid'); return; }
      snapSheet(vel);
    };
    const handles = [$('grabber'), ...document.querySelectorAll('#views .vhead, .tabs-wrap')];
    handles.forEach((el) => {
      el.addEventListener('pointerdown', begin);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      // Nach dem Ziehen keinen Knopf auslösen
      el.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    });
    $('grabber').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(sheetState === 'full' ? 'mid' : 'full'); } });

    // 2) Wie in Apple Karten: Inhalt nach oben wischen vergrößert erst das Sheet, ganz oben nach unten wischen verkleinert es
    document.querySelectorAll('#views .vbody').forEach((body) => {
      let y0 = 0, x0 = 0, decided = false, sheetDrag = false, s0 = 0, ly = 0, lt = 0, v = 0;
      body.addEventListener('touchstart', (e) => {
        if (!isMobile() || e.touches.length !== 1) return;
        const t = e.touches[0]; y0 = ly = t.clientY; x0 = t.clientX; lt = performance.now(); decided = false; sheetDrag = false; s0 = sheetY; v = 0;
        if (e.target.closest('input[type=range], .timeline, .size-chart, .sports, .chips.filter, .sugg')) decided = true;
      }, { passive: true });
      body.addEventListener('touchmove', (e) => {
        if (!isMobile() || e.touches.length !== 1) return;
        const t = e.touches[0], dy = t.clientY - y0, dx = t.clientX - x0;
        if (!decided) {
          if (Math.abs(dy) < 7 && Math.abs(dx) < 7) return;
          decided = true;
          if (Math.abs(dy) > Math.abs(dx)) {
            if (dy < 0 && sheetState !== 'full') sheetDrag = true;
            else if (dy > 0 && body.scrollTop <= 0) sheetDrag = true;
          }
          if (sheetDrag) { y0 = t.clientY; s0 = sheetY; }
        }
        if (!sheetDrag) return;
        e.preventDefault();
        const now = performance.now(); v = (t.clientY - ly) / Math.max(1, now - lt); ly = t.clientY; lt = now;
        let y = s0 + (t.clientY - y0);
        if (y < 0) y = y / 3;
        applySheetY(Math.min(detents().peek + 30, y), false);
      }, { passive: false });
      const fin = () => { if (sheetDrag) { sheetDrag = false; snapSheet(v); } };
      body.addEventListener('touchend', fin);
      body.addEventListener('touchcancel', fin);
    });

    // Eingabe angetippt: Sheet ganz öffnen, damit die Tastatur nichts verdeckt
    sheet.addEventListener('focusin', (e) => { if (isMobile() && e.target.matches('input[type=text], input[type=search]') && sheetState !== 'full') setSheet('full'); });
    const onResize = () => { if (isMobile()) setSheet(sheetState); else { document.documentElement.classList.remove('sheet-full'); applySheetY(0, false); } };
    mq.addEventListener?.('change', onResize);
    window.addEventListener('resize', onResize);
    if (isMobile()) setSheet('mid'); else applySheetY(0, false);
  }
  function fitBounds(b, maxZoom = 16) {
    if (isMobile()) map.fitBounds(b, { paddingTopLeft: [24, 70], paddingBottomRight: [24, sheetVisible() + 20], maxZoom });
    else map.fitBounds(b, { paddingTopLeft: [sheet.offsetWidth + 40, 40], paddingBottomRight: [80, 40], maxZoom });
  }
  function panIntoView(latlng) {
    // Punkt im sichtbaren Kartenteil halten
    const pt = map.latLngToContainerPoint(latlng), sz = map.getSize();
    const left = isMobile() ? 0 : sheet.offsetWidth + 24, bottom = sz.y - sheetVisible();
    if (pt.x < left + 30 || pt.x > sz.x - 30 || pt.y < 60 || pt.y > bottom - 30) {
      const tx = (left + sz.x) / 2, ty = (60 + bottom) / 2;
      map.panBy([pt.x - tx, pt.y - ty]);
    }
  }

  let toastT = null;
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3600);
  }

  // ---------- Dialog im iOS-Stil ----------
  function ask({ title, text = '', value = null, ok = 'OK', danger = false }) {
    return new Promise((resolve) => {
      $('dlgTitle').textContent = title; $('dlgText').textContent = text; $('dlgText').hidden = !text;
      const inp = $('dlgInput'); inp.hidden = value === null; inp.value = value ?? '';
      $('dlgOk').textContent = ok; $('dlgOk').classList.toggle('danger', danger);
      $('dlg').hidden = false;
      if (value !== null) setTimeout(() => { inp.focus(); inp.select(); }, 60);
      const done = (v) => { $('dlg').hidden = true; $('dlgForm').onsubmit = null; $('dlgCancel').onclick = null; $('dlg').onclick = null; resolve(v); };
      $('dlgForm').onsubmit = (e) => { e.preventDefault(); done(value === null ? true : inp.value.trim()); };
      $('dlgCancel').onclick = () => done(null);
      $('dlg').onclick = (e) => { if (e.target === $('dlg')) done(null); };
    });
  }
