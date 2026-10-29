  /* Teil 5: Startseite, Ereignisse, Start der App. Schließt den gemeinsamen Gültigkeitsbereich. */

  function renderSports() {
    $('sports').innerHTML = Object.entries(C.SPORTS).map(([k, s]) =>
      `<button type="button" data-sport="${k}" aria-pressed="${S.sport === k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${s.label}</button>`).join('');
  }
  function renderPlan() {
    renderSports();
    const loop = S.mode === 'loop';
    $('modeSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    $('distRow').hidden = !loop;
    $('chipsRow').hidden = !loop;
    $('destField').hidden = loop;
    $('dist').value = fmtNum(+S.dist[S.sport]); sizeInput($('dist'));
    $('distChips').innerHTML = DIST_CHIPS[S.sport].map((d) => `<button type="button" class="chip" data-d="${d}" aria-pressed="${+S.dist[S.sport] === d}">${fmtNum(d)}</button>`).join('');
    $('paceLbl').firstChild.textContent = S.sport === 'run' ? 'Tempo' : 'Durchschnitt';
    $('paceUnit').textContent = S.sport === 'run' ? 'min/km' : 'km/h';
    $('pace').value = S.pace[S.sport];
    $('goBtn').textContent = loop ? 'Runden finden' : 'Strecken finden';
    updateDurHint();
  }
  function updateDurHint() {
    $('durHint').textContent = `ca. ${fmtDur(durationMin(+S.dist[S.sport] || 0))} bei deinem Tempo`;
    $('distChips').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.d === +S.dist[S.sport])));
  }
  function setDist(v) {
    if (!(v > 0)) return;
    S.dist[S.sport] = Math.min(300, Math.max(0.5, Math.round(v * 10) / 10));
    $('dist').value = fmtNum(S.dist[S.sport]); sizeInput($('dist'));
    persist(); updateDurHint();
  }
  function renderHomeExtras() {
    const home = curView() === 'home';
    $('lastBtn').hidden = !(home && R.routes.length && R.source !== 'shape');
    $('shapeLastBtn').hidden = !(home && R.routes.length && R.source === 'shape');
    if (R.source === 'saved' || R.source === 'fav') $('lastBtn').textContent = `„${R.resTitle}“ wieder anzeigen`;
    else $('lastBtn').textContent = 'Letzte Vorschläge wieder anzeigen';
  }
  function setTab(t) {
    S.tab = t; persist();
    $('tabs').querySelectorAll('[data-tab]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.tab === t)); b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    document.querySelectorAll('#homeBody > .tab').forEach((el) => { el.hidden = el.dataset.tab !== t; });
    $('homeBody').scrollTop = 0;
    if (t === 'library') renderLib();
    if (t === 'shape') { renderShapeTab(); drawShapeGhost(true); } else shapeGroup.clearLayers();
    renderHomeExtras();
    refreshConditions();
  }
  function onStartChanged() {
    drawShapeGhost();
    if (R.drawing) redrawDraw();
  }
  function reopenLast() {
    if (!R.routes.length) return;
    showResults(Math.max(0, R.sel));
  }

  // ---------- Ereignisse: Startseite ----------
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('sports').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sport]'); if (!b) return;
    S.sport = b.dataset.sport; persist(); renderPlan(); renderPrefs(); refreshConditions();
    if (R.shape && R.shape.unit && R.shape.kind !== 'drawn') { R.shape.rec = aprioriKm(R.shape.unit); R.shape.km = R.shape.rec; renderShapeTab(); drawShapeGhost(); }
  });
  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    S.mode = b.dataset.mode; persist(); renderPlan(); refreshConditions();
    if (S.mode === 'ab' && !S.dest) { R.pickDest = true; toast('Ziel suchen oder auf die Karte tippen'); }
  });
  $('distMinus').addEventListener('click', () => { const v = +S.dist[S.sport]; const st = distStep(v - 0.01); setDist(Math.max(st, Math.ceil(v / st) * st - st)); refreshConditions(); });
  $('distPlus').addEventListener('click', () => { const v = +S.dist[S.sport]; const st = distStep(v); setDist(Math.floor(v / st) * st + st); refreshConditions(); });
  $('dist').addEventListener('input', () => { sizeInput($('dist')); const v = parseNum($('dist').value); if (v > 0) { S.dist[S.sport] = Math.min(300, v); persist(); updateDurHint(); } });
  $('dist').addEventListener('change', () => { setDist(parseNum($('dist').value) || +S.dist[S.sport]); refreshConditions(); });
  $('dist').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dist').blur(); });
  $('distChips').addEventListener('click', (e) => { const c = e.target.closest('[data-d]'); if (!c) return; setDist(+c.dataset.d); refreshConditions(); });
  $('pace').addEventListener('change', () => { S.pace[S.sport] = $('pace').value.trim(); persist(); updateDurHint(); refreshConditions(); });
  $('pace').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pace').blur(); });
  wireSearch('startInput', 'startSugg', (p) => setStart(p, false));
  wireSearch('destInput', 'destSugg', (p) => setDest(p, false));
  $('destInput').addEventListener('focus', () => { R.pickDest = true; });
  $('startInput').addEventListener('focus', () => { R.pickDest = false; });
  $('whenRow').addEventListener('click', () => pushView('weather'));
  $('wxCard').addEventListener('click', () => pushView('weather'));
  $('wxPill').addEventListener('click', () => pushView('weather'));
  $('settingsBtn').addEventListener('click', () => pushView('settings'));
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', popView));
  $('goBtn').addEventListener('click', generate);
  $('lastBtn').addEventListener('click', reopenLast);
  $('shapeLastBtn').addEventListener('click', reopenLast);

  // ---------- Ergebnisse ----------
  $('moreBtn').addEventListener('click', generateMore);
  $('variants').addEventListener('click', (e) => { const v = e.target.closest('.variant'); if (v) selectRoute(+v.dataset.i); });
  $('mapLegend').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; S.colorBy = b.dataset.color; persist(); drawRoutes(); });
  $('gpxBtn').addEventListener('click', exportGPX);
  $('saveBtn').addEventListener('click', saveCurrent);
  $('revBtn').addEventListener('click', reverseSel);
  $('renameBtn').addEventListener('click', renameCurrent);
  $('deleteBtn').addEventListener('click', deleteCurrent);
  $('shapeBox').addEventListener('click', (e) => { const b = e.target.closest('[data-pick-km]'); if (b) pickShapeKm(+b.dataset.pickKm); });

  // ---------- Bedingungen ----------
  $('timeline').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) setStartT(+b.dataset.t); });
  $('nowBtn').addEventListener('click', () => { S.startT = null; refreshConditions(); });
  $('wxHero').addEventListener('click', (e) => { const b = e.target.closest('[data-set-t]'); if (b) setStartT(+b.dataset.setT); });

  // ---------- Einstellungen ----------
  $('themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-v]'); if (!b) return;
    S.theme = b.dataset.themeV; persist(); applyTheme();
    renderWxSummary();
    if (R.sel >= 0 && curView() === 'results') { drawRoutes(); renderDetail(); renderVariants(); }
  });
  [['pGreen', 'oGreen', 'green'], ['pWater', 'oWater', 'water'], ['pQuiet', 'oQuiet', 'quiet'], ['pSig', 'oSig', 'signals']].forEach(([i, o, k]) => {
    $(i).addEventListener('input', () => { S.prefs[S.sport] = { ...S.prefs[S.sport], [k]: +$(i).value }; $(o).textContent = $(i).value + '%'; fillRange($(i)); persist(); });
    $(i).addEventListener('change', () => { renderPrefs(); });
  });
  $('presetChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    const p = b.dataset.preset === 'default' ? { park: false, ...DEF.prefs[S.sport] } : PRESETS.find((x) => x.k === b.dataset.preset).v;
    S.prefs[S.sport] = { ...S.prefs[S.sport], ...p };
    prefsChanged();
  });
  $('mudSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-mud]'); if (!b) return; S.mud = b.dataset.mud; prefsChanged(); });
  $('pPark').addEventListener('change', () => { S.prefs[S.sport] = { ...S.prefs[S.sport], park: $('pPark').checked }; prefsChanged(); });
  $('pLit').addEventListener('change', () => { S.lit = $('pLit').checked; prefsChanged(); });
  $('prefsRow').addEventListener('click', () => pushView('prefs'));
  $('dataExport').addEventListener('click', exportAll);
  $('dataImport').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importAll(f); });
  $('pHills').addEventListener('change', () => { S.hills = $('pHills').checked; prefsChanged(); });
  $('pVary').addEventListener('change', () => { S.vary = $('pVary').checked; persist(); });
  $('pWind').addEventListener('change', () => { S.wind = $('pWind').checked; persist(); });
  $('pDir').addEventListener('change', () => { S.dir = $('pDir').value; persist(); });
  $('favFile').addEventListener('change', (e) => { const fl = [...e.target.files]; e.target.value = ''; if (fl.length) importFavs(fl); });
  $('favList').addEventListener('click', (e) => {
    const c = e.target.closest('[data-favcheck]'); if (c) { checkFav(c.dataset.favcheck); return; }
    const d = e.target.closest('[data-favdel]'); if (d) { store.set('ww:favs', getFavs().filter((x) => x.id !== d.dataset.favdel)); favCache = null; renderFavs(); }
  });
  $('pFav').addEventListener('input', () => { S.favWeight = +$('pFav').value; $('oFav').textContent = S.favWeight + '%'; fillRange($('pFav')); persist(); });
  $('favShow').addEventListener('change', () => { S.favShow = $('favShow').checked; persist(); renderFavs(); if (R.sel >= 0 && curView() === 'results') drawRoutes(); });
  $('srvInput').addEventListener('change', () => { S.server = $('srvInput').value.trim() || 'https://brouter.de'; $('srvInput').value = S.server; R.profiles = {}; persist(); toast('Routing-Server: ' + serverUrl()); });
  $('srvReset').addEventListener('click', () => { S.server = 'https://brouter.de'; $('srvInput').value = S.server; R.profiles = {}; persist(); toast('Routing-Server: brouter.de'); });
  document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    const gpx = files.filter((f) => /\.gpx$/i.test(f.name)); const json = files.find((f) => /\.json$/i.test(f.name));
    if (gpx.length) { e.preventDefault(); importFavs(gpx); } else if (json) { e.preventDefault(); importAll(json); }
  });

  // ---------- Form ----------
  let shapeT = null;
  $('shapeInput').addEventListener('input', () => { clearTimeout(shapeT); shapeT = setTimeout(onShapeInput, 280); });
  $('shapeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(shapeT); onShapeInput(); $('shapeInput').blur(); } });
  $('shapeChips').addEventListener('click', (e) => { const c = e.target.closest('[data-word]'); if (!c) return; $('shapeInput').value = c.dataset.word; onShapeInput(); });
  $('shapeKind').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) chooseShapeOpt(+b.dataset.k); });
  $('drawBtn').addEventListener('click', startDraw);
  $('shapeMinus').addEventListener('click', () => { if (!R.shape) return; const st = isFoot() ? 1 : 5; changeShapeKm(Math.max(st, Math.ceil(R.shape.km / st) * st - st)); });
  $('shapePlus').addEventListener('click', () => { if (!R.shape) return; const st = isFoot() ? 1 : 5; changeShapeKm(Math.floor(R.shape.km / st) * st + st); });
  $('shapeDist').addEventListener('input', () => sizeInput($('shapeDist')));
  $('shapeDist').addEventListener('change', () => { const v = parseNum($('shapeDist').value); if (v > 0) changeShapeKm(v); else renderShapeTab(); });
  $('shapeDist').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('shapeDist').blur(); });
  $('shapeDir').addEventListener('click', (e) => { const b = e.target.closest('[data-dir]'); if (!b) return; S.shapeDir = b.dataset.dir; persist(); renderShapeTab(); drawShapeGhost(true); });
  $('shapeAuto').addEventListener('change', () => { S.shapeAuto = $('shapeAuto').checked; persist(); });
  $('shapeGo').addEventListener('click', generateShape);

  // ---------- Gespeichert ----------
  $('libSearch').addEventListener('input', renderLib);
  $('libSort').addEventListener('change', () => { S.libSort = $('libSort').value; persist(); renderLib(); });
  $('libFilter').addEventListener('click', (e) => { const c = e.target.closest('[data-f]'); if (!c) return; S.libFilter = c.dataset.f; persist(); renderLib(); });
  $('libList').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openSaved(b.dataset.open); });
  $('libExport').addEventListener('click', exportAll);
  $('libImport').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importAll(f); });

  // ---------- Karte ----------
  map.on('click', (e) => {
    if (R.drawing || !$('layerMenu').hidden) return;
    if (isMobile() && sheetState === 'full') { setSheet('mid'); return; }
    if (curView() !== 'home' || S.tab === 'library') return;
    const p = { lat: e.latlng.lat, lon: e.latlng.lng };
    if (S.tab === 'plan' && S.mode === 'ab' && (R.pickDest || !S.dest)) { setDest(p, true); R.pickDest = false; return; }
    setStart(p, true);
  });
  map.on('moveend', () => { if (R.drawing) redrawDraw(); });
  $('layerSel').addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (b) setLayer(b.dataset.layer); });
  $('layerBtn').addEventListener('click', (e) => { e.stopPropagation(); const open = $('layerMenu').hidden; $('layerMenu').hidden = !open; $('layerBtn').setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', (e) => { if (!$('layerMenu').hidden && !$('layerMenu').contains(e.target) && !$('layerBtn').contains(e.target)) { $('layerMenu').hidden = true; $('layerBtn').setAttribute('aria-expanded', 'false'); } });
  $('locBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!navigator.geolocation) { toast('Standort ist in diesem Browser nicht verfügbar. Bitte auf die Karte tippen.'); return; }
    $('locBtn').disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      $('locBtn').disabled = false;
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setStart(p, true); map.setView([p.lat, p.lon], 15); panIntoView([p.lat, p.lon]);
      toast('Start auf deinen Standort gesetzt');
    }, () => { $('locBtn').disabled = false; toast('Standort nicht freigegeben. Bitte auf die Karte tippen oder suchen.'); }, { enableHighAccuracy: true, timeout: 10000 });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('dlg').hidden) { $('dlgCancel').click(); return; }
    if (R.drawing) { endDraw(); drawShapeGhost(); return; }
    if (!$('layerMenu').hidden) { $('layerMenu').hidden = true; return; }
    if (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    popView();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyTheme(); if (!S.theme && R.sel >= 0 && curView() === 'results') { drawRoutes(); renderVariants(); } });
  setInterval(() => { if (R.wx && Date.now() - R.wx.fetched > 25 * 60e3) loadWeather(true); else if (R.wx) refreshConditions(); }, 10 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && R.wx && Date.now() - R.wx.fetched > 25 * 60e3) loadWeather(true); });

  // ---------- Start ----------
  renderPlan();
  renderPrefs();
  renderShapeChips();
  wireDraw();
  $('startInput').value = S.start.name || `${S.start.lat.toFixed(5)}, ${S.start.lon.toFixed(5)}`;
  if (S.dest) setDest(S.dest, false);
  renderFavs();
  initSheet();
  setTab(S.tab === 'shape' || S.tab === 'library' ? S.tab : 'plan');
  $('gpxLabel').textContent = useShare() ? 'An COROS senden' : 'GPX laden';
  loadWeather();
  libLoad().catch(() => {});
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.WW = { S, R, generate, generateShape, map, setSheet, pushView, popView, setTab, openSaved, libLoad, chooseShapeOpt, onShapeInput, startDraw, curView };
})();
