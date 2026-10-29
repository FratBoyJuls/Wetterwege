  /* Teil 2: Routen berechnen, anzeigen, Detailseite, Wasser/WC, GPX */

  function recentCells() {
    const list = store.get('ww:recent', []);
    const foot = C.SPORTS[S.sport].foot;
    const set = new Set();
    list.filter((x) => (C.SPORTS[x.sport] || {}).foot === foot).slice(-10).forEach((x) => x.cells.forEach((c) => set.add(c)));
    return set;
  }
  const idealFor = (pr) => (S.sport === 'road' ? 1.2 : S.sport === 'gravel' ? 1.25 : 1.15) + 0.32 * greenParam(pr) + 0.22 * pr.water / 100 + 0.4 * pr.quiet / 100;

  function setBusy(on) {
    R.busy = on;
    ['goBtn', 'shapeGo', 'moreBtn'].forEach((id) => { $(id).disabled = on; });
    if (!on) updateMoreBtn();
  }

  async function generate() {
    if (R.busy) return;
    R.statusTo = 'plan';
    if (S.mode === 'ab' && !S.dest) { setStatus('Bitte ein Ziel suchen oder auf die Karte tippen.', true); $('destInput').focus(); return; }
    setBusy(true); setProgress(0.03);
    try {
      setStatus('Wetter wird geprüft…');
      if (!R.wx) await loadWeather(); else refreshConditions();
      const cond = R.cond || { wet: 0, snow: 0, profile: {}, warnings: [], windAvg: 0, windDir: 0 };
      const pr = S.prefs[S.sport];
      setStatus('Routing-Profil wird an das Wetter angepasst…'); setProgress(0.08);
      const prof = await getProfile(routeParams());
      R.profileKind = prof.kind;
      const route = makeRouter(prof);
      let routes;
      if (S.mode === 'loop') {
        const targetM = (+S.dist[S.sport] || 5) * 1000;
        let windW = 0;
        if (S.wind && cond.windAvg) {
          if (!isFoot()) windW = C.clamp((cond.windAvg - 8) / 20);
          else if (S.sport === 'run') windW = C.clamp((cond.windAvg - 12) / 25) * 0.6;
        }
        setStatus('Rundkurse werden berechnet…');
        R.loopOpts = {
          start: S.start, targetM, sport: S.sport, cond, route,
          dirPref: S.dir === '' ? null : +S.dir, recentCells: S.vary ? recentCells() : null,
          windFrom: cond.windDir, windWeight: windW, concurrency: 2, maxPick: 5, signalWeight: pr.signals / 100,
          fav: favIdx(), favWeight: favIdx() ? S.favWeight / 100 : 0, ideal: idealFor(pr), greenWeight: pr.park ? 1 : pr.green / 300,
        };
        const res = await C.generateLoops({
          ...R.loopOpts,
          onProgress: (f) => { setProgress(0.1 + f * 0.85); setStatus(`Rundkurse werden berechnet… ${Math.round(f * 100)} %`); },
        });
        routes = res.routes;
      } else {
        setStatus('Strecken werden berechnet…');
        const rc = S.vary ? recentCells() : null;
        const out = await C.pool([0, 1, 2], 2, async (alt) => {
          try {
            const geo = await route([S.start, S.dest], alt);
            const a = C.analyzeRoute(geo, cond);
            a.wind = C.windSplit(a, cond.windDir || 0);
            if (favIdx()) a.favShare = C.favShare(a, favIdx());
            return { a, geo, sc: C.scoreRoute(a, 0, S.sport, { recentShare: C.shareIn(a.cells, rc), signalWeight: pr.signals / 100, favWeight: favIdx() ? S.favWeight / 100 : 0, ideal: idealFor(pr), greenWeight: pr.park ? 1 : pr.green / 300 }) };
          } catch (e) { return { err: e }; } finally { setProgress(0.4 + Math.random() * 0.3); }
        });
        const ok = out.filter((x) => !x.err);
        if (!ok.length) throw out[0].err;
        ok.sort((x, y) => x.sc.total - y.sc.total);
        routes = [];
        ok.forEach((x) => { if (routes.every((p) => C.jaccard(p.a.cells, x.a.cells) < 0.8)) routes.push(x); });
        R.loopOpts = null;
      }
      if (!routes.length) throw new Error('Keine passende Runde gefunden. Startpunkt leicht verschieben oder andere Distanz probieren.');
      routes.forEach((r) => { r.sport = S.sport; r.kind = 'gen'; });
      R.routes = routes; R.source = 'gen'; R.moreRounds = 0;
      R.resTitle = S.mode === 'loop' ? `${fmtNum(+S.dist[S.sport])} km ${C.SPORTS[S.sport].label}` : `Nach ${(S.dest.name || 'Ziel').split(',')[0]}`;
      labelRoutes();
      setProgress(1);
      setStatus(prof.kind === 'builtin' ? 'Hinweis: Wetteranpassung im Routing war nicht verfügbar; das Wetter fließt nur in die Bewertung ein.' : '');
      showResults();
    } catch (e) {
      setStatus(e.message || String(e), true); setProgress(0);
    } finally {
      setBusy(false);
      setTimeout(() => { if (!R.busy) setProgress(0); }, 900);
    }
  }

  async function generateMore() {
    if (R.busy || !R.loopOpts || R.source !== 'gen') return;
    setBusy(true);
    $('moreBtn').textContent = 'Suche weitere Varianten…';
    try {
      R.moreRounds = (R.moreRounds || 0) + 1;
      const res = await C.generateLoops({
        ...R.loopOpts, seed: Math.floor(Math.random() * 1e9), maxPick: 3,
        excludeCells: R.routes.map((r) => r.a.cells),
        onProgress: (f) => { $('moreBtn').textContent = `Suche weitere Varianten… ${Math.round(f * 100)} %`; },
      });
      const fresh = res.routes.filter((x) => R.routes.every((p) => C.jaccard(p.a.cells, x.a.cells) < 0.55));
      if (!fresh.length) { toast('Keine deutlich anderen Runden gefunden. Startpunkt verschieben oder Richtung vorgeben hilft.'); return; }
      fresh.forEach((r) => { r.sport = S.sport; r.kind = 'gen'; });
      const first = R.routes.length;
      R.routes = R.routes.concat(fresh).slice(0, LETTERS.length);
      labelRoutes();
      toast(`${fresh.length} weitere ${fresh.length === 1 ? 'Variante' : 'Varianten'} gefunden`);
      selectRoute(Math.min(first, R.routes.length - 1));
    } catch (e) {
      toast(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function labelRoutes() {
    const labels = C.variantLabels(R.routes, R.cond);
    R.routes.forEach((r, i) => { r.labels = labels[i]; r.dir = C.loopDirection(r.a); });
  }

  // ---------- Ergebnis-Seite ----------
  const TAB_NAME = { plan: 'Runde', shape: 'Form', library: 'Gespeichert' };
  function showResults(selIdx = 0) {
    pushView('results');
    selectRoute(selIdx, true);
    $('resBody').scrollTop = 0;
    setTimeout(() => { const r = R.routes[R.sel]; if (r) fitRoute(r); }, isMobile() ? 450 : 30);
    renderHomeExtras();
  }
  function renderResultsHead() {
    const r = R.routes[R.sel];
    $('resBack').textContent = TAB_NAME[S.tab] || 'Zurück';
    $('resTitle').textContent = r && r.libId ? r.name : R.resTitle || 'Vorschläge';
    $('renameBtn').hidden = !(r && r.libId);
    $('deleteBtn').hidden = !(r && r.libId);
    $('saveIcon').setAttribute('href', r && r.libId ? '#i-bookmark-fill' : '#i-bookmark');
    $('saveBtn').classList.toggle('on', !!(r && r.libId));
    $('saveBtn').setAttribute('aria-label', r && r.libId ? 'Gespeichert, zum Entfernen tippen' : 'Speichern');
    $('variantsWrap').hidden = R.routes.length < 2 && R.source !== 'gen';
    $('shapeBox').hidden = R.source !== 'shape';
  }

  const STATE_COL = () => ({ ok: cssVar('--route'), soft: cssVar('--teal'), mud1: cssVar('--orange'), mud2: cssVar('--brown'), snow: cssVar('--cyan'), dark: cssVar('--indigo') });
  const STATE_NAME = { ok: 'gut', soft: 'unbefestigt, ok', mud1: 'etwas Matsch', mud2: 'viel Matsch', snow: 'Schnee', dark: 'unbeleuchtet' };
  const SURF_COL = ['#8e8e93', '#b8a58c', '#e0b95c', '#b0926a', '#8a5a36', '#4fa24a'];
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const NODE_META = { signal: { l: '', n: 'Ampel' }, risk: { l: '!', n: 'Querung ohne Ampel' }, barrier: { l: '×', n: 'Sperre/Poller' } };
  const WAY_NAMES = { footway: 'Fußweg', path: 'Weg', track: 'Feldweg', cycleway: 'Radweg', residential: 'Wohnstraße', living_street: 'Spielstraße', service: 'Zufahrt', pedestrian: 'Fußgängerzone', unclassified: 'Nebenstraße', tertiary: 'Straße', secondary: 'Hauptstraße', primary: 'Hauptstraße', trunk: 'Schnellstraße', steps: 'Treppe', bridleway: 'Reitweg' };

  function ring(pct, size = 40) {
    const r = size * 0.38, c = 2 * Math.PI * r, col = pct >= 75 ? cssVar('--green') : pct >= 50 ? cssVar('--yellow') : cssVar('--orange');
    const h = size / 2, w = size * 0.1;
    return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${cssVar('--fill-2')}" stroke-width="${w}"/><circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(c * pct) / 100} ${c}"/></svg><b>${pct}</b>`;
  }

  function variantSub(r) {
    const a = r.a, bits = [];
    if (r.kind === 'shape') {
      bits.push(`<span class="strong">Formtreue ${Math.round(r.fid * 100)} %</span>`);
      bits.push(`↑ ${a.asc} m`, fmtDur(durationMin(a.length / 1000, a.asc, r.sport)));
      return bits.join(' · ');
    }
    const strengths = (r.labels || []).filter((l) => l !== 'beste Gesamtwertung');
    if (strengths.length) bits.push(`<span class="strong">${esc(strengths[0])}</span>`);
    bits.push(`↑ ${a.asc} m`, fmtDur(durationMin(a.length / 1000, a.asc, r.sport)));
    if (a.signalsN != null) bits.push(`${a.signalsN} Ampel${a.signalsN === 1 ? '' : 'n'}`);
    if (a.mudM > 300) bits.push(`<span class="warn">${fmtKm(a.mudM)} km Matsch</span>`);
    return bits.join(' · ');
  }

  function renderVariants() {
    $('variants').innerHTML = R.routes.map((r, i) => {
      const a = r.a;
      const q = r.kind === 'shape' ? Math.round(r.fid * 100) : r.sc ? C.qualityPct(r.sc) : null;
      const head = r.kind === 'shape' ? r.sizeLabel || '' : r.dir ? `${r.dir}-Runde` : r.name || '';
      return `<button type="button" class="variant" data-i="${i}" aria-pressed="${i === R.sel}" aria-label="Variante ${LETTERS[i]}, ${fmtKm(a.length)} Kilometer">
        <span class="badge">${LETTERS[i]}</span>
        <span class="title"><b>${fmtKm(a.length)} km</b><span>${esc(head)}</span></span>
        ${q != null ? `<span class="ring" title="${r.kind === 'shape' ? 'Formtreue' : 'Qualität'} ${q} von 100">${ring(q)}</span>` : '<span></span>'}
        <span class="sub">${variantSub(r)}</span>
      </button>`;
    }).join('');
    updateMoreBtn();
  }

  function updateMoreBtn() {
    $('moreBtn').hidden = !(R.source === 'gen' && R.loopOpts && R.routes.length);
    $('moreBtn').textContent = R.routes.length >= LETTERS.length ? 'Maximale Anzahl erreicht' : 'Weitere Varianten suchen';
    $('moreBtn').disabled = R.busy || R.routes.length >= LETTERS.length;
  }

  function drawRoutes() {
    routeGroup.clearLayers(); shapeGroup.clearLayers();
    const col = STATE_COL();
    const muted = '#8e8e93';
    R.routes.forEach((r, i) => {
      if (i === R.sel || R.source === 'shape') return;
      const ll = r.a.pts.map((p) => [p.lat, p.lon]);
      L.polyline(ll, { color: '#ffffff', weight: 6, opacity: 0.5, interactive: false }).addTo(routeGroup);
      const line = L.polyline(ll, { color: muted, weight: 3.5, opacity: 0.7 }).addTo(routeGroup);
      line.on('click', (e) => { L.DomEvent.stopPropagation(e); selectRoute(i); });
      line.bindTooltip(`Variante ${LETTERS[i]} · ${fmtKm(r.a.length)} km`, { sticky: true, className: 'ww-tip' });
    });
    const r = R.routes[R.sel]; if (!r) return;
    const a = r.a;
    // Soll-Form gestrichelt darunter
    if (r.target) {
      L.polyline(r.target.map((p) => [p.lat, p.lon]), { color: cssVar('--purple'), weight: 3, opacity: 0.85, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(shapeGroup);
    }
    L.polyline(a.pts.map((p) => [p.lat, p.lon]), { color: '#ffffff', weight: 10, opacity: 0.95, interactive: false }).addTo(routeGroup);
    const bySurf = S.colorBy === 'surface';
    a.segs.forEach((s) => {
      const ll = a.pts.slice(s.i0, s.i1 + 1).map((p) => [p.lat, p.lon]);
      if (ll.length < 2) return;
      const sc = C.surfClass(s.tags);
      const info = s.surfInfo || C.surfaceInfo(s.tags);
      const surfTxt = s.tags.surface ? `Untergrund ${s.tags.surface}` : s.tags.tracktype ? `Feldweg ${s.tags.tracktype}` : info === 'roadGuess' ? 'Untergrund nicht erfasst (Straße, vermutlich Asphalt)' : 'Untergrund nicht erfasst, geschätzt';
      const tip = `${bySurf ? C.SURF_NAMES[sc] : STATE_NAME[s.state] || ''} · ${esc(WAY_NAMES[s.tags.highway] || s.tags.highway || 'Weg')} · ${esc(surfTxt)}`;
      const style = bySurf
        ? { color: SURF_COL[sc], weight: 6, opacity: 1, dashArray: info === 'pathGuess' ? '3 7' : null, lineCap: info === 'pathGuess' ? 'butt' : 'round' }
        : { color: col[s.state] || col.ok, weight: 6, opacity: 1 };
      L.polyline(ll, style).bindTooltip(tip, { sticky: true, className: 'ww-tip' }).addTo(routeGroup);
    });
    (a.nodes || []).forEach((n) => {
      if (n.kind === 'crossing') return;
      const p = a.pts[n.i]; if (!p) return;
      const m = NODE_META[n.kind];
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="ww-node ww-node-${n.kind}" aria-hidden="true">${m.l}</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .bindTooltip(`${m.n}${n.kind === 'risk' ? ` (Risiko ${n.level} von 6)` : n.barrier ? ` (${esc(n.barrier)})` : ''} · km ${fmt1(n.d / 1000)}`, { className: 'ww-tip' }).addTo(routeGroup);
    });
    const step = a.length > 40000 ? 10000 : a.length > 15000 ? 5000 : 1000;
    for (let d = step; d < a.length - step * 0.3; d += step) {
      let j = 0; while (j < a.cum.length - 1 && a.cum[j] < d) j++;
      const p = a.pts[j];
      L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="ww-km">${Math.round(d / 1000)}</span>`, iconSize: null }) }).addTo(routeGroup);
    }
    if (a.pts.length > 10) {
      const p0 = a.pts[0], p1 = a.pts[Math.min(a.pts.length - 1, 8)];
      const b = C.bearing(p0, p1);
      L.marker([p1.lat, p1.lon], { interactive: false, icon: L.divIcon({ className: '', html: `<svg width="20" height="20" viewBox="0 0 18 18" style="width:20px;height:20px;transform:rotate(${b}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M9 1.5l5.8 13.5L9 11.6 3.2 15z" fill="#fff"/><path d="M9 4l4 9.4L9 11 5 13.4z" fill="${col.ok}"/></svg>`, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(routeGroup);
    }
    // Legende mit Umschalter
    let items;
    if (bySurf) {
      items = a.surf.map((m, k) => (m > 50 ? `<span><i style="background:${SURF_COL[k]}"></i>${C.SURF_NAMES[k]}</span>` : '')).join('');
      if ((a.surfData || {}).pathGuess > 50) items += '<span><i class="dashed"></i>nicht erfasst</span>';
    } else {
      items = Object.keys(STATE_NAME).filter((k) => a.states[k] > 50).map((k) => `<span><i style="background:${col[k]}"></i>${STATE_NAME[k]}</span>`).join('');
      if (favIdx() && S.favShow) items += `<span><i style="background:${cssVar('--purple')};opacity:.6"></i>Lieblingswege</span>`;
    }
    if (r.target) items += `<span><i style="background:repeating-linear-gradient(90deg, ${cssVar('--purple')} 0 3px, transparent 3px 7px)"></i>Soll-Form</span>`;
    const nodeKinds = [...new Set((a.nodes || []).map((n) => n.kind))].filter((k) => k !== 'crossing');
    items += nodeKinds.map((k) => `<span><b class="ww-node ww-node-${k}">${NODE_META[k].l}</b>${NODE_META[k].n}</span>`).join('');
    $('mapLegend').innerHTML = `<div class="seg mini" role="group" aria-label="Linienfarbe"><button type="button" data-color="state" aria-pressed="${!bySurf}">Zustand</button><button type="button" data-color="surface" aria-pressed="${bySurf}">Untergrund</button></div>${items}`;
    $('mapLegend').hidden = false;
  }

  function selectRoute(i, keepView) {
    R.sel = i;
    renderResultsHead();
    renderVariants();
    drawRoutes();
    const r = R.routes[i];
    if (!r) return;
    if (!keepView) fitRoute(r);
    renderDetail();
    if (R.source === 'shape') renderShapeBox();
    loadPois(r);
  }
  function fitRoute(r) {
    const pts = r.a.pts.map((p) => [p.lat, p.lon]);
    if (r.target) r.target.forEach((p) => pts.push([p.lat, p.lon]));
    fitBounds(L.latLngBounds(pts));
  }

  function renderDetail() {
    const r = R.routes[R.sel]; if (!r) return;
    const a = r.a;
    const sport = r.sport || S.sport;
    renderResultsHead();
    const dur = durationMin(a.length / 1000, a.asc, sport);
    const g = a.length ? Math.round((a.greenM / a.length) * 100) : 0;
    const durTxt = fmtDur(dur).replace(' h', '<span>h</span>').replace(' min', '<span>min</span>');
    const perKm = Math.max(0.5, a.length / 1000);
    $('detailKv').innerHTML = [
      ['Distanz', `${fmtKm(a.length)}<span>km</span>`], ['Dauer', durTxt], ['Anstieg', `${a.asc}<span>m</span>`], ['Im Grünen', `${g}<span>%</span>`],
      ['Ampeln', String(a.signalsN ?? '–'), a.signalsN / perKm > 1], ['Querungen', String(a.riskN ?? '–'), a.riskN > 0],
      ['Abbiegen', a.turnsPerKm != null ? `${fmt1(a.turnsPerKm)}<span>/km</span>` : '–', a.turnsPerKm > 5],
      a.favShare != null ? ['Favoriten', `${Math.round(a.favShare * 100)}<span>%</span>`] : ['Doppelt', `${Math.round(a.overlap * 100)}<span>%</span>`, a.overlap > 0.06],
    ].map(([k, v, warn]) => `<div class="stat${warn ? ' warn' : ''}"${k === 'Querungen' ? ' title="Querungen größerer Straßen ohne Ampel"' : ''}><small>${k}</small><b>${v}</b></div>`).join('');

    const tot = a.surf.reduce((s, x) => s + x, 0) || 1;
    $('surfStack').innerHTML = a.surf.map((m, k) => m > 0 ? `<i style="width:${(m / tot) * 100}%;background:${SURF_COL[k]}" title="${C.SURF_NAMES[k]}: ${fmtKm(m)} km"></i>` : '').join('');
    $('surfLegend').innerHTML = a.surf.map((m, k) => m / tot > 0.02 ? `<span><i style="background:${SURF_COL[k]}"></i>${C.SURF_NAMES[k]} ${Math.round((m / tot) * 100)} %</span>` : '').join('');
    const sd = a.surfData;
    if (sd) {
      const st2 = sd.known + sd.roadGuess + sd.pathGuess || 1;
      const known = Math.round(((sd.known + sd.roadGuess * 0.8) / st2) * 100);
      $('surfQuality').textContent = `${known} % sicher erfasst`;
      $('surfQuality').className = 'mini-aside ' + (known >= 80 ? 'good' : 'warn');
      $('surfQuality').title = `${Math.round((sd.known / st2) * 100)} % mit Angabe in OpenStreetMap, ${Math.round((sd.roadGuess / st2) * 100)} % Straßen ohne Angabe (vermutlich Asphalt), ${Math.round((sd.pathGuess / st2) * 100)} % Wege ohne Angabe (geschätzt, auf der Karte gestrichelt)`;
    } else $('surfQuality').textContent = '';

    const checks = C.plausibility(a, { targetM: r.kind === 'gen' && S.mode === 'loop' ? (+S.dist[S.sport] || 0) * 1000 : 0 });
    const okN = checks.filter((c) => c.ok).length;
    $('checkSum').innerHTML = `<span class="ck-badge${okN < checks.length ? ' warn' : ''}"><svg><use href="#i-${okN < checks.length ? 'excl' : 'check'}"/></svg></span>Plausibilität: ${okN} von ${checks.length} Prüfungen ok`;
    $('checkList').innerHTML = checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><span aria-hidden="true"><svg><use href="#i-${c.ok ? 'check' : 'excl'}"/></svg></span>${esc(c.text)}</li>`).join('');

    const col = STATE_COL();
    const st = a.states; const stot = Object.values(st).reduce((s, x) => s + x, 0) || 1;
    $('stateStack').innerHTML = Object.keys(STATE_NAME).map((k) => st[k] > 0 ? `<i style="width:${(st[k] / stot) * 100}%;background:${col[k]}"></i>` : '').join('');
    $('stateLegend').innerHTML = Object.keys(STATE_NAME).map((k) => st[k] / stot > 0.02 ? `<span><i style="background:${col[k]}"></i>${STATE_NAME[k]} ${fmtKm(st[k])} km</span>` : '').join('');
    renderElevation(a);

    const notes = [];
    const c = R.cond;
    if (a.mudM > 150) notes.push({ tone: a.mudM / a.length > 0.25 ? 'bad' : 'warn', text: `${fmtKm(a.mudM)} km auf Wegen, die bei der aktuellen Nässe matschig sein dürften (auf der Karte orange und braun).` });
    if (a.snowM > 150) notes.push({ tone: 'warn', text: `${fmtKm(a.snowM)} km auf Wegen, die bei Schnee meist nicht geräumt werden.` });
    if (a.unlitM > 150) notes.push({ tone: 'warn', text: `${fmtKm(a.unlitM)} km ohne bekannte Beleuchtung im Dunkeln.` });
    if (a.wind && c && c.windAvg >= 10) {
      if (a.wind.first > 0.12 && a.wind.second < -0.05) notes.push({ tone: 'good', text: `Erst gegen den Wind (aus ${compass(c.windDir)}, ${Math.round(c.windAvg)} km/h), zurück mit Rückenwind.` });
      else if (a.wind.second - a.wind.first > 0.25) notes.push({ tone: 'warn', text: `Der Rückweg geht eher gegen den Wind (aus ${compass(c.windDir)}, ${Math.round(c.windAvg)} km/h). Umkehren hilft.` });
    }
    if (a.busyM > 300) notes.push({ tone: 'warn', text: `${fmtKm(a.busyM)} km entlang größerer Straßen.` });
    if (a.stepsN && !isFoot(sport)) notes.push({ tone: 'warn', text: `${a.stepsN}× Treppen auf der Strecke: kurz schieben oder tragen.` });
    if (r.sc && r.sc.parts.dist > 0.3 && r.kind === 'gen' && S.mode === 'loop') notes.push({ tone: 'warn', text: `Weicht von der Wunschdistanz ab (${fmtKm(a.length)} statt ${fmtNum(+S.dist[S.sport])} km). Die Wege hier geben keine passendere Runde her.` });
    if (R.profileKind === 'builtin' && r.kind !== 'saved') notes.push({ tone: 'warn', text: 'Berechnet mit einem Standardprofil, Matsch und Schnee wurden nur in der Bewertung berücksichtigt.' });
    if (r.kind === 'saved' && c) notes.unshift({ tone: 'good', text: `Gespeicherte Route, bewertet mit dem Wetter von ${S.startT ? fmtTime(S.startT) + ' Uhr' : 'jetzt'}.` });
    $('routeNotes').innerHTML = notes.map((w) => `<li class="${w.tone}">${esc(w.text)}</li>`).join('');
  }

  function renderElevation(a) {
    const svg = $('elev');
    const n = a.pts.length;
    if (!n || a.pts[0].ele == null || isNaN(a.pts[0].ele)) { svg.innerHTML = ''; return; }
    const W = 600, H = 110, padL = 34, padB = 16, padT = 6;
    const step = Math.max(1, Math.floor(n / 300));
    const pts = [];
    for (let i = 0; i < n; i += step) pts.push([a.cum[i], a.pts[i].ele]);
    pts.push([a.cum[n - 1], a.pts[n - 1].ele]);
    let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
    if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
    const x = (d) => padL + (d / a.length) * (W - padL - 4);
    const y = (e) => padT + (1 - (e - lo) / (hi - lo)) * (H - padT - padB);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    const area = `${line}L${x(a.length).toFixed(1)},${H - padB}L${padL},${H - padB}Z`;
    const acc = cssVar('--green'), lineC = cssVar('--sep');
    const km = a.length / 1000;
    const ticks = [0, km / 2, km];
    svg.innerHTML = `
      <line x1="${padL}" y1="${y(hi)}" x2="${W}" y2="${y(hi)}" stroke="${lineC}" stroke-width="1"/>
      <line x1="${padL}" y1="${y(lo)}" x2="${W}" y2="${y(lo)}" stroke="${lineC}" stroke-width="1"/>
      <path d="${area}" fill="${acc}" fill-opacity="0.16"/>
      <path d="${line}" fill="none" stroke="${acc}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <text x="2" y="${y(hi) + 4}">${Math.round(hi)} m</text>
      <text x="2" y="${y(lo) + 4}">${Math.round(lo)} m</text>
      ${ticks.map((t, i) => `<text x="${i === 0 ? padL : i === 2 ? W - 2 : x(t * 1000)}" y="${H - 2}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${fmt1(t)} km</text>`).join('')}`;
  }

  // ---------- Wasser, WC, Biergarten ----------
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  async function overpass(q) {
    let last;
    for (const u of OVERPASS) {
      try {
        const r = await fetchT(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }, 25000);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) { last = e; }
    }
    throw last;
  }
  async function loadPois(r) {
    const a = r.a;
    const key = C.hashStr(a.samples.filter((_, i) => i % 20 === 0).map((p) => p.lat.toFixed(4) + p.lon.toFixed(4)).join());
    $('poiHint').textContent = 'wird geladen…';
    $('poiList').innerHTML = '';
    poiGroup.clearLayers();
    try {
      if (!R.pois[key]) {
        let s = 90, w = 180, n = -90, e = -180;
        a.pts.forEach((p) => { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); });
        const pad = 0.002; const bb = `${(s - pad).toFixed(5)},${(w - pad).toFixed(5)},${(n + pad).toFixed(5)},${(e + pad).toFixed(5)}`;
        const walkish = (r.sport || S.sport) === 'walk' || (r.sport || S.sport) === 'run';
        const q = `[out:json][timeout:25];(node["amenity"="drinking_water"](${bb});node["amenity"="fountain"]["drinking_water"="yes"](${bb});node["man_made"="water_tap"]["drinking_water"="yes"](${bb});node["amenity"="toilets"](${bb});way["amenity"="toilets"](${bb});${walkish ? `node["amenity"="biergarten"](${bb});way["amenity"="biergarten"](${bb});` : ''});out center tags;`;
        const j = await overpass(q);
        R.pois[key] = (j.elements || []).map((el) => {
          const t = el.tags || {};
          const kind = t.amenity === 'toilets' ? 'wc' : t.amenity === 'biergarten' ? 'beer' : 'water';
          return { lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon, kind, tags: t, name: t.name || '' };
        }).filter((p) => p.lat != null);
      }
      if (R.routes[R.sel] !== r) return;
      const near = C.nearRoute(a, R.pois[key].filter((p) => p.kind !== 'beer'), 120).concat(C.nearRoute(a, R.pois[key].filter((p) => p.kind === 'beer'), 150)).sort((x, y) => x.at - y.at);
      r.pois = near;
      renderPois(r);
    } catch (e) {
      $('poiHint').textContent = 'gerade nicht verfügbar';
    }
  }
  const POI_META = { water: { l: '💧', c: '#32ade6', n: 'Trinkwasser' }, wc: { l: 'WC', c: '#8e8e93', n: 'Toilette' }, beer: { l: '🍺', c: '#ff9500', n: 'Biergarten' } };
  function poiStatus(p) {
    const t = p.tags;
    if (p.kind === 'water') {
      if (t.operational_status === 'closed' || t.disused === 'yes') return { txt: 'laut Karte außer Betrieb', off: true };
      const s = C.fountainSeason(R.cond ? R.cond.startT : Date.now(), t);
      return { txt: s.text, off: s.on === false };
    }
    if (p.kind === 'wc') return { txt: [t.fee === 'yes' ? 'kostenpflichtig' : t.fee === 'no' ? 'kostenlos' : '', t.opening_hours ? t.opening_hours.slice(0, 40) : ''].filter(Boolean).join(' · ') };
    if (p.kind === 'beer') return { txt: t.opening_hours ? t.opening_hours.slice(0, 40) : 'saisonal geöffnet' };
    return { txt: '' };
  }
  function renderPois(r) {
    const list = r.pois || [];
    poiGroup.clearLayers();
    const water = list.filter((p) => p.kind === 'water');
    $('poiHint').textContent = list.length ? `${water.length}× Wasser, ${list.filter((p) => p.kind === 'wc').length}× WC` : '';
    $('poiList').innerHTML = list.slice(0, 14).map((p) => {
      const m = POI_META[p.kind], st = poiStatus(p);
      return `<li><span class="ic" style="background:${m.c};${st.off ? 'opacity:.45' : ''}">${m.l}</span><span>${esc(p.name || m.n)}${st.txt ? ` <small>· ${esc(st.txt)}</small>` : ''}</span><small>km ${fmt1(p.at / 1000)}</small></li>`;
    }).join('') || '<li class="empty">Keine Trinkbrunnen oder WCs innerhalb von 120 m.</li>';
    list.forEach((p) => {
      const m = POI_META[p.kind], st = poiStatus(p);
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="ww-poi" style="background:${m.c};${st.off ? 'opacity:.5' : ''}">${m.l}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .bindTooltip(`${esc(p.name || m.n)} · km ${fmt1(p.at / 1000)}${st.txt ? ' · ' + esc(st.txt) : ''}`, { className: 'ww-tip' }).addTo(poiGroup);
    });
  }

  // ---------- GPX und Umkehren ----------
  const SLUG = { run: 'lauf', walk: 'spaziergang', road: 'rennrad', gravel: 'gravel', mtb: 'mtb' };
  function downloadText(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  const useShare = () => !!navigator.share && matchMedia('(pointer: coarse)').matches;
  function exportGPX() {
    const r = R.routes[R.sel]; if (!r) return;
    const a = r.a;
    const sport = r.sport || S.sport;
    const km = fmtKm(a.length);
    const name = r.libId ? r.name : `Wetterwege ${C.SPORTS[sport].label} ${km} km`;
    const d = new Date();
    const desc = `${C.SPORTS[sport].label}, ${km} km, ${a.asc} hm, erstellt ${d.toLocaleDateString('de-DE')}${R.cond ? ' · Boden: ' + R.cond.ground.label : ''}`;
    const wpts = $('gpxWpts').checked ? (r.pois || []).filter((p) => p.kind !== 'beer').map((p) => ({ lat: p.lat, lon: p.lon, name: `${p.kind === 'wc' ? 'WC' : 'Wasser'} km ${fmt1(p.at / 1000)}` })) : [];
    const g = C.buildGPX(a.pts, { name, desc, waypoints: wpts });
    const base = r.libId ? r.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) : `wetterwege-${SLUG[sport]}-${km.replace(',', '-')}km`;
    const file = `${base || 'wetterwege'}-${d.toISOString().slice(0, 10)}.gpx`;
    rememberExport(sport, a);
    if (r.libId) touchLib(r.libId);
    if (useShare()) {
      try {
        const f = new File([g.xml], file, { type: 'application/gpx+xml' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: name }).then(() => toast('Geteilt. In der COROS-App auf die Uhr übertragen.')).catch((e) => {
            if (e && e.name === 'AbortError') return;
            downloadText(file, g.xml, 'application/gpx+xml'); toast(`${file} gespeichert.`);
          });
          return;
        }
      } catch (e) { /* Download als Ersatz */ }
    }
    downloadText(file, g.xml, 'application/gpx+xml');
    toast(`${file} gespeichert. In der COROS-App als Route importieren.`);
  }
  function rememberExport(sport, a) {
    const recent = store.get('ww:recent', []);
    recent.push({ sport, t: Date.now(), cells: [...a.cells] });
    store.set('ww:recent', recent.slice(-15));
  }
  function reverseSel() {
    const r = R.routes[R.sel]; if (!r) return;
    r.a = C.reverseAnalysis(r.a);
    r.reversed = !r.reversed;
    if (R.cond) r.a.wind = C.windSplit(r.a, R.cond.windDir);
    if (r.pois) r.pois = r.pois.map((p) => ({ ...p, at: r.a.length - p.at })).sort((x, y) => x.at - y.at);
    if (r.target) r.target = r.target.slice().reverse();
    selectRoute(R.sel, true);
    if (r.pois) renderPois(r);
    toast('Richtung umgekehrt');
  }
