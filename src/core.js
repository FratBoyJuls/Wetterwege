/* Wetterwege – Kernlogik ohne UI: Wettermodell, Geometrie, Rundkurs-Generator, Bewertung, GPX. */
(function (root) {
  'use strict';

  // ---------- Hilfen ----------
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

  function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  function destination(p, brg, d) {
    const δ = d / R, θ = rad(brg), φ1 = rad(p.lat), λ1 = rad(p.lon);
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: deg(φ2), lon: ((deg(λ2) + 540) % 360) - 180 };
  }
  const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  // ---------- Sportarten ----------
  const SPORTS = {
    run:    { label: 'Laufen',    foot: true,  kmh: 10,  tempIdeal: [6, 16],  green: 0.5, water: 0.35, quiet: 0.6, heatAt: 24 },
    walk:   { label: 'Spazieren', foot: true,  kmh: 4.6, tempIdeal: [10, 22], green: 0.6, water: 0.4,  quiet: 0.6, heatAt: 28 },
    road:   { label: 'Rennrad',   foot: false, kmh: 25,  tempIdeal: [13, 24], green: 0,   water: 0,    quiet: 0.6, heatAt: 30 },
    gravel: { label: 'Gravel',    foot: false, kmh: 19,  tempIdeal: [10, 22], green: 0.35, water: 0.25, quiet: 0.6, heatAt: 29 },
    mtb:    { label: 'MTB',       foot: false, kmh: 14,  tempIdeal: [8, 22],  green: 0.4, water: 0.2,  quiet: 0.5, heatAt: 29 },
  };

  // ---------- Wetter ----------
  /** Open-Meteo-Antwort in Stundenliste mit Epoch-Zeiten umwandeln */
  function parseWeather(j, aq) {
    const off = (j.utc_offset_seconds || 0) * 1000;
    const H = j.hourly, n = H.time.length;
    const hours = [];
    const aqMap = {};
    if (aq && aq.hourly) {
      const aoff = (aq.utc_offset_seconds || 0) * 1000;
      aq.hourly.time.forEach((t, i) => {
        const e = Date.parse(t + 'Z') - aoff;
        aqMap[e] = {
          alder: aq.hourly.alder_pollen?.[i], birch: aq.hourly.birch_pollen?.[i], grass: aq.hourly.grass_pollen?.[i],
          mugwort: aq.hourly.mugwort_pollen?.[i], ragweed: aq.hourly.ragweed_pollen?.[i],
        };
      });
    }
    for (let i = 0; i < n; i++) {
      const t = Date.parse(H.time[i] + 'Z') - off;
      hours.push({
        t,
        temp: H.temperature_2m?.[i], feels: H.apparent_temperature?.[i], rh: H.relative_humidity_2m?.[i],
        precip: H.precipitation?.[i] || 0, prob: H.precipitation_probability?.[i], snowfall: H.snowfall?.[i] || 0,
        snowDepth: H.snow_depth?.[i] || 0, code: H.weather_code?.[i], wind: H.wind_speed_10m?.[i] || 0,
        windDir: H.wind_direction_10m?.[i] || 0, gust: H.wind_gusts_10m?.[i] || 0,
        soil: H.soil_moisture_0_to_1cm?.[i], et0: H.et0_fao_evapotranspiration?.[i] || 0,
        uv: H.uv_index?.[i], isDay: H.is_day?.[i], pollen: aqMap[t] || null,
      });
    }
    const days = (j.daily?.time || []).map((d, i) => ({
      date: d,
      sunrise: Date.parse(j.daily.sunrise[i] + 'Z') - off,
      sunset: Date.parse(j.daily.sunset[i] + 'Z') - off,
    }));
    return { hours, days, fetched: Date.now() };
  }

  function hourIndex(wx, t) {
    let best = 0, bd = Infinity;
    wx.hours.forEach((h, i) => { const d = Math.abs(h.t - t); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  function isDark(wx, t) {
    const ds = new Date(t).toDateString();
    const day = wx.days.find((d) => new Date(d.sunrise).toDateString() === ds);
    if (!day) { const h = wx.hours[hourIndex(wx, t)]; return !!h && h.isDay === 0; }
    return t < day.sunrise - 20 * 60e3 || t > day.sunset + 20 * 60e3;
  }

  /**
   * Bedingungen für einen geplanten Start berechnen.
   * Liefert Profilparameter (wet, snow, icy, dark, storm, heat) und Klartext.
   */
  function computeConditions(wx, startT, durMin, sport) {
    const sp = SPORTS[sport] || SPORTS.run;
    const i0 = hourIndex(wx, startT);
    const nAct = Math.max(1, Math.ceil(durMin / 60));
    const act = wx.hours.slice(i0, i0 + nAct);
    const H = wx.hours;
    const h0 = H[i0];

    // Regen der Vergangenheit, gewichtet (Halbwertszeit ~21 h)
    let pw = 0, p24 = 0, p72 = 0, p96 = 0, p12 = 0, et24 = 0, tmin36 = Infinity, sfall12 = 0, dryH = 0, dryRun = true;
    for (let k = 1; k <= 96; k++) {
      const h = H[i0 - k]; if (!h) break;
      p96 += h.precip;
      if (dryRun && h.precip < 0.1) dryH++; else dryRun = false;
      if (k > 72) continue;
      pw += h.precip * Math.exp(-k / 30);
      p72 += h.precip;
      if (k <= 24) { p24 += h.precip; et24 += h.et0; }
      if (k <= 12) { p12 += h.precip; sfall12 += h.snowfall; }
      if (k <= 36 && h.temp != null) tmin36 = Math.min(tmin36, h.temp);
    }
    const pAct = act.reduce((s, h) => s + h.precip, 0);
    const soil = h0.soil;
    const rainTerm = clamp((pw - 0.5 * et24 + pAct * 1.2) / 8);
    const soilTerm = soil == null ? rainTerm : clamp((soil - 0.2) / 0.15);
    let wet = clamp(0.6 * rainTerm + 0.4 * soilTerm);
    if (pw < 0.3 && pAct < 0.1) wet = Math.min(wet, 0.25 + 0.35 * soilTerm);

    const tNow = h0.temp ?? 10;
    const tMinAct = Math.min(...act.map((h) => h.temp ?? tNow));
    const tMaxFeels = Math.max(...act.map((h) => h.feels ?? h.temp ?? tNow));
    let frozen = false, thaw = false;
    let mean24 = 0, c24 = 0;
    for (let k = 0; k < 24; k++) { const h = H[i0 - k]; if (h && h.temp != null) { mean24 += h.temp; c24++; } }
    mean24 = c24 ? mean24 / c24 : tNow;
    if (tNow < -1 && mean24 < 0) { frozen = true; wet *= 0.25; }
    else if (tmin36 < -1 && tNow > 1) { thaw = true; wet = clamp(Math.max(wet, 0.45) + 0.2); }

    const sd = h0.snowDepth || 0; // m
    let snow = clamp(sd / 0.1);
    snow = Math.max(snow, clamp(sfall12 / 5) * 0.6);
    if (snow > 0.2) wet *= 0.6;

    const icy = tMinAct <= 2 && tMinAct >= -8 && (p12 > 0.2 || sd > 0.005 || ((h0.rh || 0) > 90 && tmin36 < 0));
    const endT = startT + durMin * 60e3;
    let dark = false;
    for (let t = startT; t <= endT; t += 10 * 60e3) if (isDark(wx, t)) { dark = true; break; }
    const gustMax = Math.max(...act.map((h) => h.gust));
    const storm = gustMax >= 60;
    const heat = tMaxFeels >= sp.heatAt;
    const uvMax = Math.max(...act.map((h) => h.uv ?? 0));
    const windAvg = act.reduce((s, h) => s + h.wind, 0) / act.length;
    // Windrichtung als Vektormittel
    let wx_ = 0, wy_ = 0;
    act.forEach((h) => { wx_ += Math.sin(rad(h.windDir)) * h.wind; wy_ += Math.cos(rad(h.windDir)) * h.wind; });
    const windDir = (deg(Math.atan2(wx_, wy_)) + 360) % 360;

    let ground;
    if (snow > 0.25) ground = { key: 'snow', label: 'Schnee auf Wegen', tone: 'snow' };
    else if (frozen) ground = { key: 'frozen', label: 'Boden gefroren', tone: 'snow' };
    else if (thaw) ground = { key: 'thaw', label: 'Tauwetter, sehr matschig', tone: 'bad' };
    else if (wet < 0.2) ground = { key: 'dry', label: 'Trocken', tone: 'good' };
    else if (wet < 0.45) ground = { key: 'damp', label: 'Leicht feucht', tone: 'good' };
    else if (wet < 0.7) ground = { key: 'wet', label: 'Feucht, Erdwege matschig', tone: 'warn' };
    else ground = { key: 'mud', label: 'Nass, viel Matsch', tone: 'bad' };

    const pollen = summarizePollen(act);
    const warnings = [];
    if (storm) warnings.push({ tone: 'bad', text: `Sturmböen bis ${Math.round(gustMax)} km/h: Wald und Parks mit altem Baumbestand meiden (Astbruch).` });
    else if (gustMax >= 45) warnings.push({ tone: 'warn', text: `Kräftige Böen bis ${Math.round(gustMax)} km/h.` });
    if (icy) warnings.push({ tone: 'bad', text: 'Glättegefahr: Brücken, Holzstege, Pflaster und Treppen können überfroren sein.' });
    if (dark) warnings.push({ tone: 'warn', text: 'Teile der Strecke liegen in der Dunkelheit. Stirnlampe oder Licht einpacken; beleuchtete Wege werden bevorzugt.' });
    if (heat) warnings.push({ tone: 'warn', text: `Gefühlt bis ${Math.round(tMaxFeels)} °C: Schatten und Wasser werden bevorzugt, genug trinken.` });
    if (uvMax >= 6) warnings.push({ tone: 'warn', text: `UV-Index bis ${Math.round(uvMax)}: Sonnenschutz.` });
    if (pAct >= 1) warnings.push({ tone: 'warn', text: `Während der Aktivität ca. ${pAct.toFixed(1)} mm Regen erwartet.` });
    if (thaw) warnings.push({ tone: 'warn', text: 'Tauwetter nach Frost: Erd- und Wiesenwege sind jetzt besonders weich.' });
    if (pollen.level >= 2) warnings.push({ tone: 'warn', text: `Pollenflug ${pollen.text}.` });

    return {
      startT, durMin, wet, snow, icy, dark, storm, heat, frozen, thaw, ground, warnings,
      pw, et24, rainTerm, soilTerm, tmin36: isFinite(tmin36) ? tmin36 : null, p12, sfall12,
      temp: tNow, feels: h0.feels, tMaxFeels, tMinAct, p24, p72, p96, dryH, pAct, soil, snowDepthCm: sd * 100,
      gustMax, windAvg, windDir, uvMax, pollen, code: h0.code, prob: h0.prob,
      profile: { wet, snow, icy, dark, storm, heat },
    };
  }

  /**
   * Klartext für die Oberfläche: Urteil, was die App deswegen tut, und woraus der Matsch-Index besteht.
   */
  function explainConditions(c, tw, sport, opts = {}) {
    const sp = SPORTS[sport] || SPORTS.run;
    const effects = [];
    const wetPct = Math.round(c.wet * 100);
    const mud = opts.mud || 'auto';
    if (mud === 'ignore') effects.push({ icon: 'ok', text: 'Du hast „Matsch egal“ eingestellt: Die Wege werden nicht nach Nässe ausgewählt.' });
    else if (mud === 'avoid') effects.push({ icon: 'mud', text: 'Du hast „Matsch immer meiden“ eingestellt: Erd-, Wald- und Wiesenwege werden gemieden, egal wie trocken es ist.' });
    else if (c.snow > 0.25) effects.push({ icon: 'snow', text: 'Geräumte Straßen und Radwege werden bevorzugt, Wald- und Wiesenwege gemieden.' });
    else if (c.wet >= 0.45) effects.push({ icon: 'mud', text: 'Erd-, Wald- und Wiesenwege werden gemieden, Asphalt und fester Kies bevorzugt.' });
    else if (c.wet >= 0.2) effects.push({ icon: 'mud', text: 'Sehr weiche Wege (Wiese, Erde) werden leicht gemieden.' });
    else effects.push({ icon: 'ok', text: 'Alle Wege sind gut nutzbar, keine Einschränkung beim Untergrund.' });
    if (opts.park) effects.push({ icon: 'ok', text: '„So grün wie möglich“ ist an: Parks, Wald und Grünzüge werden stark bevorzugt, auch wenn die Runde dafür Umwege macht.' });
    if (opts.lit && !c.dark) effects.push({ icon: 'dark', text: 'Beleuchtete Wege werden bevorzugt (deine Einstellung).' });
    if (c.icy) effects.push({ icon: 'ice', text: 'Brücken, Holzstege, Pflaster und Treppen werden wegen Glätte gemieden.' });
    if (c.dark) effects.push({ icon: 'dark', text: 'Beleuchtete Wege werden bevorzugt, dunkle Waldstücke gemieden.' });
    if (c.storm) effects.push({ icon: 'wind', text: 'Wald und Parks mit alten Bäumen werden wegen Astbruch gemieden.' });
    if (c.heat) effects.push({ icon: 'heat', text: 'Schatten und Wege am Wasser werden stärker bevorzugt.' });

    let title, tone;
    const best = tw && tw.slots[tw.best];
    const later = tw && tw.best > 0 && best;
    if (c.storm) { title = 'Sturm: lieber später'; tone = 'bad'; }
    else if (c.pAct >= 2) { title = 'Regen während der Runde'; tone = 'bad'; }
    else if (c.snow > 0.25) { title = 'Schnee auf den Wegen'; tone = 'snow'; }
    else if (c.icy) { title = 'Vorsicht, glatt'; tone = 'warn'; }
    else if (c.thaw || c.wet >= 0.7) { title = 'Wege sehr matschig'; tone = 'warn'; }
    else if (c.wet >= 0.45) { title = 'Wege teils matschig'; tone = 'warn'; }
    else if (c.dark) { title = 'Trocken, aber dunkel'; tone = 'warn'; }
    else if (c.heat) { title = 'Heiß: Schatten suchen'; tone = 'warn'; }
    else { title = `Gut zum ${sport === 'walk' ? 'Spazieren' : sport === 'run' ? 'Laufen' : 'Radfahren'}`; tone = 'good'; }

    const parts = [
      { label: 'Regen der letzten 4 Tage', value: `${(Math.round((c.p96 ?? c.p72) * 10) / 10).toLocaleString('de-DE')} mm`, note: 'jüngerer Regen zählt stärker' },
      { label: 'Verdunstung seit gestern', value: `${(Math.round(c.et24 * 10) / 10).toLocaleString('de-DE')} mm`, note: 'trocknet die Wege ab' },
      { label: 'Bodenfeuchte (oberste cm)', value: c.soil != null ? `${Math.round(c.soil * 100)} %` : 'keine Daten', note: 'ab etwa 30 % weich' },
      { label: 'Frost oder Tauwetter', value: c.frozen ? 'Boden gefroren' : c.thaw ? 'Tauwetter' : 'nein', note: c.thaw ? 'macht Erdwege besonders weich' : c.frozen ? 'gefrorener Boden ist fest' : '' },
    ];
    if (c.snowDepthCm >= 0.5) parts.push({ label: 'Schneehöhe', value: `${Math.round(c.snowDepthCm)} cm`, note: '' });
    const scale = [
      { from: 0, to: 20, label: 'trocken' }, { from: 20, to: 45, label: 'feucht' },
      { from: 45, to: 70, label: 'matschig' }, { from: 70, to: 100, label: 'sehr matschig' },
    ];
    return { title, tone, wetPct, effects, parts, scale, betterAt: later ? best.t : null, idealTemp: sp.tempIdeal, headline: headline(c) };
  }

  /** Ein Satz, der sagt, worauf man heute achten sollte */
  function headline(c) {
    const mm = (x) => `${(Math.round(x * 10) / 10).toLocaleString('de-DE')} mm`;
    const days = Math.max(1, Math.floor((c.dryH || 0) / 24));
    if (c.storm) return { tone: 'bad', text: `Sturmböen bis ${Math.round(c.gustMax)} km/h: Wald und Parks mit alten Bäumen heute lieber meiden.` };
    if (c.snow > 0.25) return { tone: 'snow', text: `Schnee auf den Wegen${c.snowDepthCm >= 1 ? ` (${Math.round(c.snowDepthCm)} cm)` : ''}: Geräumte Straßen und Radwege sind heute die sichere Wahl.` };
    if (c.icy) return { tone: 'warn', text: 'Glättegefahr: Brücken, Holzstege und Pflaster können rutschig sein. Lieber etwas langsamer.' };
    if (c.thaw) return { tone: 'warn', text: 'Tauwetter: Der Boden taut auf, Erd- und Waldwege werden heute besonders weich und rutschig.' };
    if (c.pAct >= 2) return { tone: 'bad', text: `Während deiner Runde soll es regnen (etwa ${mm(c.pAct)}). Später starten oder Regenjacke einpacken.` };
    if (c.p96 >= 25 || c.wet >= 0.7) return { tone: 'bad', text: `Achtung: In den letzten 4 Tagen hat es ${mm(c.p96)} geregnet. Wald- und Wiesenwege sind heute richtig matschig.` };
    if (c.wet >= 0.45) return { tone: 'warn', text: `In den letzten Tagen hat es geregnet (${mm(c.p96)} in 4 Tagen). Erdwege sind teils matschig, Asphalt und Kies sind gut.` };
    if (c.frozen) return { tone: 'good', text: 'Der Boden ist gefroren und damit fest. Auf Brücken und Pflaster trotzdem auf Glätte achten.' };
    if (c.p96 < 1 && c.wet < 0.2) return { tone: 'good', text: `Alles easy: ${days >= 4 ? 'seit mindestens 4 Tagen' : days === 1 ? 'seit gestern' : `seit ${days} Tagen`} trocken, alle Wege sind gut nutzbar.` };
    if (c.wet < 0.2) return { tone: 'good', text: `Kaum Regen in den letzten Tagen (${mm(c.p96)}), die Wege sind gut nutzbar.` };
    return { tone: 'good', text: `Etwas Regen in den letzten Tagen (${mm(c.p96)}), nur sehr weiche Wege können feucht sein.` };
  }

  /** Warum ist eine Stunde gut oder schlecht? */
  function slotReasons(s) {
    const r = [];
    if (s.precip > 0.05) r.push(`${(Math.round(s.precip * 10) / 10).toLocaleString('de-DE')} mm Regen`);
    else r.push('trocken');
    if (s.dark) r.push('dunkel'); else r.push('hell');
    if (s.temp != null) r.push(`${Math.round(s.temp)} °C`);
    return r.join(' · ');
  }

  const POLLEN = {
    alder: { name: 'Erle', lv: [10, 50] }, birch: { name: 'Birke', lv: [15, 90] }, grass: { name: 'Gräser', lv: [10, 50] },
    mugwort: { name: 'Beifuß', lv: [5, 15] }, ragweed: { name: 'Ambrosia', lv: [3, 10] },
  };
  function summarizePollen(act) {
    let level = 0; const parts = [];
    let any = false;
    for (const [k, def] of Object.entries(POLLEN)) {
      const v = Math.max(0, ...act.map((h) => (h.pollen && h.pollen[k] != null ? h.pollen[k] : 0)));
      if (act.some((h) => h.pollen && h.pollen[k] != null)) any = true;
      const l = v >= def.lv[1] ? 3 : v >= def.lv[0] ? 2 : v >= 1 ? 1 : 0;
      if (l > 0) parts.push({ name: def.name, l });
      level = Math.max(level, l);
    }
    const word = ['keine', 'gering', 'mittel', 'hoch'];
    parts.sort((a, b) => b.l - a.l);
    const text = parts.length ? parts.slice(0, 3).map((p) => `${p.name} ${word[p.l]}`).join(', ') : any ? 'keine relevante Belastung' : 'keine Daten';
    return { level, text, available: any };
  }

  /** Bewertung jeder Startstunde der nächsten 24 h (niedriger = besser) */
  function timeWindows(wx, nowT, durMin, sport) {
    const sp = SPORTS[sport] || SPORTS.run;
    const i0 = hourIndex(wx, nowT);
    const nAct = Math.max(1, Math.ceil(durMin / 60));
    const out = [];
    for (let k = 0; k < 24; k++) {
      const i = i0 + k; const hs = wx.hours.slice(i, i + nAct); if (hs.length < nAct) break;
      let pen = 0;
      hs.forEach((h) => {
        pen += h.precip * 3 + ((h.prob || 0) / 100) * 1.2;
        if (h.gust >= 50) pen += 1.5; else if (h.gust >= 35) pen += 0.4;
        const t = h.feels ?? h.temp ?? 12;
        if (t < sp.tempIdeal[0]) pen += (sp.tempIdeal[0] - t) * 0.08;
        if (t > sp.tempIdeal[1]) pen += (t - sp.tempIdeal[1]) * 0.12;
        if (h.isDay === 0) pen += 1.6;
        if (h.temp != null && h.temp <= 1 && h.precip > 0) pen += 1.5;
      });
      pen /= hs.length;
      out.push({ t: wx.hours[i].t, pen, temp: wx.hours[i].temp, precip: hs.reduce((s, h) => s + h.precip, 0), dark: wx.hours[i].isDay === 0, code: wx.hours[i].code });
    }
    let best = 0;
    out.forEach((o, i) => { if (o.pen < out[best].pen - 0.05) best = i; });
    return { slots: out, best };
  }

  // ---------- Wege-Tags ----------
  function parseTags(s) {
    const o = {};
    (s || '').split(' ').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1); });
    return o;
  }
  const PAVED = /^(asphalt|paved|concrete|paving_stones|metal)$/;
  function surfClass(t) {
    const s = t.surface;
    if (s) {
      if (PAVED.test(s)) return 0;
      if (/^(sett|cobblestone|grass_paver)$/.test(s)) return 1;
      if (/^(compacted|fine_gravel)$/.test(s)) return 2;
      if (/^(gravel|pebblestone|unpaved|rock|stone)$/.test(s)) return 3;
      if (/^(ground|earth|dirt|wood)$/.test(s)) return 4;
      if (/^(grass|mud|clay|sand)$/.test(s)) return 5;
      return 3;
    }
    if (t.highway === 'track') return ({ grade1: 0, grade2: 2, grade3: 3, grade4: 4, grade5: 5 })[t.tracktype] ?? 3;
    if (t.highway === 'path') return 3;
    if (t.highway === 'bridleway') return 4;
    return 0;
  }
  function mudSus(t) {
    const s = t.surface;
    if (s) {
      if (PAVED.test(s)) return 0;
      const m = { sett: 0.05, cobblestone: 0.05, grass_paver: 0.05, compacted: 0.15, fine_gravel: 0.2, gravel: 0.25, pebblestone: 0.25,
        rock: 0.1, stone: 0.1, wood: 0.1, sand: 0.2, unpaved: 0.55, ground: 0.8, earth: 0.8, dirt: 0.85, grass: 0.9, mud: 1, clay: 1 };
      return m[s] ?? 0.4;
    }
    if (t.highway === 'track') return ({ grade1: 0.05, grade2: 0.25, grade3: 0.5, grade4: 0.8, grade5: 0.9 })[t.tracktype] ?? 0.5;
    if (t.highway === 'path') return 0.55;
    if (t.highway === 'bridleway') return 0.7;
    if (t.highway === 'footway') return 0.15;
    return 0;
  }
  const MAINROAD = /^(residential|living_street|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link)$/;
  const BUSY = /^(secondary|secondary_link|primary|primary_link|trunk|trunk_link)$/;
  const SURF_NAMES = ['Asphalt & Platten', 'Pflaster', 'Feinkies & fest', 'Schotter', 'Erde & Waldboden', 'Wiese, Sand, Matsch'];

  /** Wie stark ein Weg bei Schnee betroffen ist (gleiches Modell wie im Routing-Profil) */
  function snowSus(t) {
    const hw = t.highway || '';
    const sc = surfClass(t);
    if (MAINROAD.test(hw)) return 0.05;
    if (hw === 'cycleway') return sc < 1 ? 0.35 : 0.8;
    if (t.footway === 'sidewalk') return 0.3;
    if (hw === 'footway' || hw === 'pedestrian') return sc < 1 ? 0.45 : 0.85;
    if (hw === 'steps') return 1;
    if (sc > 3) return 1;
    return 0.8;
  }

  /** Zustand eines Abschnitts für die Kartenfarbe */
  function segState(t, cond) {
    const mud = mudSus(t) * (cond.wet || 0);
    const sc = surfClass(t);
    const plowed = MAINROAD.test(t.highway || '');
    if ((cond.snow || 0) > 0.25 && snowSus(t) * cond.snow >= 0.4) return 'snow';
    if (mud >= 0.5) return 'mud2';
    if (mud >= 0.28) return 'mud1';
    if (cond.dark && !/^(yes|24\/7|automatic|sunset-sunrise)$/.test(t.lit || '') && !plowed && t.highway !== 'pedestrian' && t.footway !== 'sidewalk') return 'dark';
    return sc >= 2 ? 'soft' : 'ok';
  }

  /** Ist der Untergrund in OSM erfasst, oder geschätzt (Straße vs. Weg)? */
  function surfaceInfo(t) {
    if (t.surface) return 'known';
    if (t.highway === 'track' && t.tracktype) return 'known';
    if (MAINROAD.test(t.highway || '') || t.footway === 'sidewalk' || t.highway === 'pedestrian') return 'roadGuess';
    return 'pathGuess';
  }

  /** Ampeln, riskante Querungen und Sperren entlang der Route; nahe Ampelknoten (eine Kreuzung) zusammenfassen */
  function nodeEvents(raw, cum) {
    const out = [];
    raw.forEach((n) => {
      const t = n.tags, d = cum[n.i] || 0;
      let kind = null, level = 0;
      if (t.highway === 'traffic_signals' || t.crossing === 'traffic_signals') kind = 'signal';
      else if (+t.estimated_crossing_class >= 3) { kind = 'risk'; level = +t.estimated_crossing_class; }
      else if (/^(gate|bollard|cycle_barrier|stile|kissing_gate|turnstile|lift_gate|chain)$/.test(t.barrier || '')) kind = 'barrier';
      else if (/^(zebra|marked|uncontrolled)$/.test(t.crossing || '')) kind = 'crossing';
      if (!kind) return;
      const last = out.filter((o) => o.kind === kind).pop();
      if (last && d - last.d < (kind === 'signal' ? 60 : 25)) { last.level = Math.max(last.level, level); return; }
      out.push({ i: n.i, d, kind, level, barrier: t.barrier || '' });
    });
    return out;
  }

  /** Richtungswechsel über 55° (geglättet), mindestens 60 m auseinander */
  function countTurns(samples) {
    let n = 0, last = -1e9;
    for (let i = 2; i < samples.length - 2; i++) {
      const b1 = bearing(samples[i - 2], samples[i]);
      const b2 = bearing(samples[i], samples[i + 2]);
      if (angDiff(b1, b2) > 55 && samples[i].d - last > 60) { n++; last = samples[i].d; }
    }
    return n;
  }

  // ---------- Route auswerten ----------
  function analyzeRoute(geo, cond, opts = {}) {
    const feat = geo.features ? geo.features[0] : geo;
    const coords = feat.geometry.coordinates;
    const pts = coords.map((c) => ({ lon: c[0], lat: c[1], ele: c[2] }));
    const P = feat.properties || {};
    const msgs = P.messages || [];
    const head = msgs[0] || [];
    const iLon = head.indexOf('Longitude'), iLat = head.indexOf('Latitude'), iDist = head.indexOf('Distance'),
      iTags = head.indexOf('WayTags'), iCost = head.indexOf('CostPerKm'), iNode = head.indexOf('NodeTags');
    const segs = [];
    const rawNodes = [];
    let idx = 0, prev = 0;
    const key = (c) => Math.round(c[0] * 1e6) + ',' + Math.round(c[1] * 1e6);
    for (let r = 1; r < msgs.length; r++) {
      const row = msgs[r];
      const k = row[iLon] + ',' + row[iLat];
      let j = idx;
      while (j < coords.length && key(coords[j]) !== k) j++;
      if (j >= coords.length) continue;
      const tags = parseTags(row[iTags]);
      if (j > prev) segs.push({ i0: prev, i1: j, tags, costPerKm: +row[iCost] || 0, node: row[iNode] || '' });
      if (iNode >= 0 && row[iNode]) rawNodes.push({ i: j, tags: parseTags(row[iNode]) });
      prev = j; idx = j;
    }
    if (prev < coords.length - 1) segs.push({ i0: prev, i1: coords.length - 1, tags: segs.length ? segs[segs.length - 1].tags : {}, costPerKm: 0 });

    // Längen
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const length = cum[cum.length - 1] || +P['track-length'] || 0;

    const surf = [0, 0, 0, 0, 0, 0];
    const surfData = { known: 0, roadGuess: 0, pathGuess: 0 };
    let mudM = 0, snowM = 0, unlitM = 0, greenM = 0, busyM = 0, stepsN = 0;
    const states = { ok: 0, soft: 0, mud1: 0, mud2: 0, snow: 0, dark: 0 };
    segs.forEach((s) => {
      const L = cum[s.i1] - cum[s.i0];
      s.len = L;
      const t = s.tags;
      surf[surfClass(t)] += L;
      s.surfInfo = surfaceInfo(t);
      surfData[s.surfInfo] += L;
      s.state = segState(t, cond);
      states[s.state] += L;
      if (s.state === 'mud1' || s.state === 'mud2') mudM += L;
      if (s.state === 'snow') snowM += L;
      if (s.state === 'dark') unlitM += L;
      if (+t.estimated_forest_class >= 3) greenM += L;
      if (BUSY.test(t.highway || '') && t.sidewalk !== 'separate') busyM += L;
      if (t.highway === 'steps') stepsN++;
    });

    // Höhenmeter (geglättet)
    let asc = 0, desc = 0;
    if (pts.length && pts[0].ele != null) {
      let ref = pts[0].ele;
      for (const p of pts) {
        if (p.ele == null) continue;
        const d = p.ele - ref;
        if (d >= 3) { asc += d; ref = p.ele; } else if (d <= -3) { desc -= d; ref = p.ele; }
      }
    }
    const samples = resample(pts, cum, 15);
    const ov = overlapStats(samples);
    const uturns = countUturns(samples);
    const cells = cellSet(samples, 50);
    const cost = +P.cost || 0;
    const nodes = nodeEvents(rawNodes, cum);
    return {
      pts, cum, segs, length, asc: Math.round(+P['filtered ascend'] || asc), desc: Math.round(desc), cost,
      avgCost: length ? cost / length : 0, surf, surfData, mudM, snowM, unlitM, greenM, busyM, stepsN, states,
      overlap: ov, uturns, cells, samples, nodes,
      signalsN: nodes.filter((n) => n.kind === 'signal').length,
      riskN: nodes.filter((n) => n.kind === 'risk').length,
      barrierN: nodes.filter((n) => n.kind === 'barrier').length,
      turnsPerKm: length ? countTurns(samples) / (length / 1000) : 0,
    };
  }

  function resample(pts, cum, step) {
    const out = [];
    if (!pts.length) return out;
    let j = 0;
    const total = cum[cum.length - 1];
    for (let d = 0; d <= total; d += step) {
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const seg = cum[j + 1] - cum[j] || 1;
      const f = clamp((d - cum[j]) / seg);
      const a = pts[j], b = pts[j + 1] || a;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, d });
    }
    return out;
  }

  function cellKey(p, size) {
    const ky = Math.floor(p.lat / (size / 111320));
    const kx = Math.floor(p.lon / (size / (111320 * Math.cos(rad(48.1)))));
    return [kx, ky];
  }

  /** Anteil der Strecke, der denselben Weg ein zweites Mal nutzt */
  function overlapStats(samples) {
    const size = 18;
    const first = new Map();
    const flag = new Array(samples.length).fill(false);
    samples.forEach((s, i) => {
      const [kx, ky] = cellKey(s, size);
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) {
        const f = first.get((kx + dx) + ':' + (ky + dy));
        if (f != null && s.d - f > 150) hit = true;
      }
      flag[i] = hit;
      const k = kx + ':' + ky;
      if (!first.has(k)) first.set(k, s.d);
    });
    // kurze Treffer (Kreuzungen) ignorieren
    let run = 0, count = 0;
    for (let i = 0; i <= flag.length; i++) {
      if (i < flag.length && flag[i]) run++;
      else { if (run >= 5) count += run; run = 0; }
    }
    return samples.length ? count / samples.length : 0;
  }

  function countUturns(samples) {
    let n = 0, last = -1e9;
    const w = 3;
    for (let i = w; i < samples.length - w; i++) {
      if (samples[i].d < 120 || samples[samples.length - 1].d - samples[i].d < 120) continue;
      const b1 = bearing(samples[i - w], samples[i]);
      const b2 = bearing(samples[i], samples[i + w]);
      if (angDiff(b1, b2) > 150 && samples[i].d - last > 120) { n++; last = samples[i].d; }
    }
    return n;
  }

  function cellSet(samples, size) {
    const s = new Set();
    samples.forEach((p) => { const [x, y] = cellKey(p, size); s.add(x + ':' + y); });
    return s;
  }
  function jaccard(a, b) {
    let inter = 0;
    a.forEach((k) => { if (b.has(k)) inter++; });
    return inter / (a.size + b.size - inter || 1);
  }
  function shareIn(a, b) {
    if (!b || !b.size) return 0;
    let inter = 0;
    a.forEach((k) => { if (b.has(k)) inter++; });
    return inter / (a.size || 1);
  }

  /** Umwege an Zwischenpunkten erkennen: Strecke 350 m vor/nach dem Punkt im Verhältnis zur Luftlinie */
  function viaDetour(a, wps) {
    const s = a.samples, out = [];
    if (!s.length || !wps || wps.length < 3) return out;
    wps.slice(1, -1).forEach((w) => {
      let bi = 0, bd = Infinity;
      s.forEach((p, i) => { const d = dist(p, w); if (d < bd) { bd = d; bi = i; } });
      const d0 = s[bi].d;
      const pa = s.find((p) => p.d >= d0 - 350) || s[0];
      const pb = s.find((p) => p.d >= d0 + 350) || s[s.length - 1];
      const st = dist(pa, pb);
      out.push({ ratio: (pb.d - pa.d) / Math.max(st, 1), at: d0, off: bd, base: { lat: (pa.lat + pb.lat) / 2, lon: (pa.lon + pb.lon) / 2 } });
    });
    return out;
  }

  // ---------- Lieblingswege ----------
  /** Index über importierte Strecken: Rasterzellen (~25 m) für den Anteil, Punkte (~60 m Abstand) zum Andocken */
  function favIndex(tracks) {
    const cells = new Set(), snapPts = [];
    tracks.forEach((t) => {
      const pts = t.pts.map(([lat, lon]) => ({ lat, lon }));
      if (pts.length < 2) return;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
      resample(pts, cum, 10).forEach((p, i) => {
        const [x, y] = cellKey(p, 25); cells.add(x + ':' + y);
        if (i % 6 === 0) snapPts.push(p);
      });
    });
    return { cells, snapPts, size: tracks.length };
  }
  /** Anteil der Route auf Lieblingswegen (0..1) */
  function favShare(a, idx) {
    if (!idx || !idx.cells.size || !a.samples.length) return 0;
    let hit = 0;
    a.samples.forEach((p) => {
      const [x, y] = cellKey(p, 25);
      let ok = false;
      for (let dx = -1; dx <= 1 && !ok; dx++) for (let dy = -1; dy <= 1 && !ok; dy++) if (idx.cells.has((x + dx) + ':' + (y + dy))) ok = true;
      if (ok) hit++;
    });
    return hit / a.samples.length;
  }
  /** Nächstgelegenen Punkt auf einem Lieblingsweg innerhalb eines Radius finden */
  function favSnap(idx, p, radius) {
    if (!idx || !idx.snapPts.length) return null;
    let best = null, bd = radius;
    const dLat = radius / 111320;
    for (const q of idx.snapPts) {
      if (Math.abs(q.lat - p.lat) > dLat) continue;
      const d = dist(p, q);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  // ---------- Bewertung ----------
  const IDEAL_COST = { run: 1.15, walk: 1.15, road: 1.2, gravel: 1.25, mtb: 1.2 };
  function scoreRoute(a, targetM, sport, extra = {}) {
    const parts = {};
    if (targetM) {
      const e = Math.abs(a.length - targetM) / targetM;
      parts.dist = e < 0.04 ? 0 : (e - 0.04) * 14;
    } else parts.dist = 0;
    parts.cost = Math.max(0, a.avgCost - (extra.ideal || IDEAL_COST[sport] || 1.15)) * 1.6;
    parts.overlap = a.overlap * (sport === 'walk' ? 3.5 : 5.5);
    parts.uturn = a.uturns * 0.45;
    parts.recent = (extra.recentShare || 0) * 2.5;
    parts.wind = extra.windPen || 0;
    const km = Math.max(0.5, a.length / 1000);
    parts.signals = ((a.signalsN || 0) / km) * 0.35 * (extra.signalWeight == null ? 0.5 : extra.signalWeight);
    parts.risk = Math.min(1.5, (a.riskN || 0) * 0.25);
    parts.turns = Math.max(0, (a.turnsPerKm || 0) - 4) * (sport === 'walk' ? 0.03 : 0.08);
    parts.fav = -(a.favShare || 0) * 1.6 * (extra.favWeight || 0);
    parts.green = -(a.length ? a.greenM / a.length : 0) * 2.4 * (extra.greenWeight || 0);
    parts.detour = Math.min(2, (a.detour || []).reduce((t, v) => t + Math.max(0, v.ratio - 1.9) * 0.6, 0));
    const total = Object.values(parts).reduce((s, x) => s + x, 0);
    return { total, parts, quality: total - parts.dist };
  }

  /** Wofür steht jede Variante? Stärken relativ zu den anderen angezeigten Varianten */
  function variantLabels(routes, cond) {
    const labels = routes.map(() => []);
    if (routes.length < 2) return labels;
    const metrics = [
      { name: 'am grünsten', v: (r) => r.a.greenM / r.a.length, best: 'max', min: 0.08 },
      { name: 'wenigste Ampeln', v: (r) => r.a.signalsN / (r.a.length / 1000), best: 'min', min: 0.4 },
      { name: 'flachste', v: (r) => r.a.asc / (r.a.length / 1000), best: 'min', min: 2 },
      { name: 'am trockensten', v: (r) => (r.a.mudM + r.a.snowM) / r.a.length, best: 'min', min: 0.05, only: () => cond && (cond.wet > 0.35 || cond.snow > 0.25) },
      { name: 'meist befestigt', v: (r) => (r.a.surf[0] + r.a.surf[1]) / r.a.length, best: 'max', min: 0.08 },
      { name: 'meist naturbelassen', v: (r) => (r.a.surf[2] + r.a.surf[3] + r.a.surf[4]) / r.a.length, best: 'max', min: 0.08 },
      { name: 'ruhigste', v: (r) => r.a.busyM / r.a.length, best: 'min', min: 0.05 },
      { name: 'meist Lieblingswege', v: (r) => r.a.favShare || 0, best: 'max', min: 0.08 },
    ];
    metrics.forEach((m) => {
      if (m.only && !m.only()) return;
      const vals = routes.map(m.v);
      const sorted = vals.slice().sort((x, y) => (m.best === 'max' ? y - x : x - y));
      if (Math.abs(sorted[0] - sorted[1]) < m.min) return; // kein klarer Unterschied
      const i = vals.indexOf(sorted[0]);
      if (labels[i].length < 2) labels[i].push(m.name);
    });
    labels.forEach((l, i) => { if (!l.length && i === 0) l.push('beste Gesamtwertung'); });
    return labels;
  }

  /** Kompass-Richtung der Runde vom Start aus */
  function loopDirection(a) {
    const s = a.samples; if (!s.length) return '';
    let lat = 0, lon = 0; s.forEach((p) => { lat += p.lat; lon += p.lon; });
    const c = { lat: lat / s.length, lon: lon / s.length };
    if (dist(s[0], c) < 300) return '';
    const names = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'];
    return names[Math.round(bearing(s[0], c) / 45) % 8];
  }

  /** Prüfliste: ergibt die Route Sinn? */
  function plausibility(a, opts = {}) {
    const km = a.length / 1000;
    const checks = [];
    if (opts.targetM) {
      const e = Math.abs(a.length - opts.targetM) / opts.targetM;
      checks.push({ ok: e <= 0.06, text: e <= 0.06 ? 'Distanz passt' : `Distanz weicht ${Math.round(e * 100)} % ab` });
    }
    const worstDet = Math.max(0, ...(a.detour || []).map((d) => d.ratio));
    checks.push({ ok: worstDet <= 3 && a.uturns === 0, text: worstDet <= 3 && a.uturns === 0 ? 'Keine Stichwege oder Wendepunkte' : `${Math.max(a.uturns, 1)}× Stichweg oder Wendepunkt` });
    checks.push({ ok: a.overlap <= 0.06, text: a.overlap <= 0.06 ? 'Kaum doppelte Abschnitte' : `${Math.round(a.overlap * 100)} % der Strecke doppelt` });
    checks.push({ ok: a.signalsN / km <= 1, text: `${a.signalsN} Ampel${a.signalsN === 1 ? '' : 'n'} (${fmtNum(a.signalsN / km)} pro km)` });
    checks.push({ ok: a.riskN === 0, text: a.riskN ? `${a.riskN}× Querung einer größeren Straße ohne Ampel` : 'Keine ungesicherten Querungen großer Straßen' });
    const sd = a.surfData || { known: 0, roadGuess: 0, pathGuess: 0 };
    const known = a.length ? (sd.known + sd.roadGuess) / a.length : 0;
    checks.push({ ok: sd.pathGuess / Math.max(1, a.length) < 0.15, text: `Untergrund zu ${Math.round(known * 100)} % sicher bekannt` });
    checks.push({ ok: a.turnsPerKm <= 5, text: `${fmtNum(a.turnsPerKm)} Abbiegungen pro km` });
    return checks;
  }
  const fmtNum = (x) => (Math.round(x * 10) / 10).toLocaleString('de-DE');

  /** Qualitätslabel 0..100 für die Anzeige */
  function qualityPct(score) { return Math.min(100, Math.round(100 * Math.exp(-Math.max(0, score.quality) / 2.2))); }

  // ---------- Rundkurse ----------
  function loopWaypoints(start, brg, r, cw, seed, nVia = 3) {
    const rnd = mulberry32(seed);
    const center = destination(start, brg, r);
    const base = brg + 180;
    const sign = cw ? 1 : -1;
    const vias = [];
    for (let i = 1; i <= nVia; i++) {
      const a = base + sign * (i * 360) / (nVia + 1) + (rnd() - 0.5) * 24;
      vias.push(destination(center, a, r * (0.9 + rnd() * 0.22)));
    }
    return [start, ...vias, start];
  }

  async function pool(items, n, fn) {
    const res = new Array(items.length);
    let k = 0;
    const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
      while (k < items.length) { const i = k++; res[i] = await fn(items[i], i); }
    });
    await Promise.all(workers);
    return res;
  }

  /**
   * Rundkurse erzeugen.
   * opts: { start, targetM, sport, cond, route(lonlatPts) -> geojson, dirPref (deg|null), recentCells (Set), onProgress, seed }
   */
  async function generateLoops(opts) {
    const { start, targetM, sport, cond, route, onProgress = () => {} } = opts;
    const seed0 = opts.seed ?? Math.floor(Math.random() * 1e9);
    const rnd = mulberry32(seed0);
    let r0 = targetM / 7.0;
    const cands = [];
    const windW = opts.windWeight || 0;
    if (opts.dirPref == null && windW > 0) {
      // Bei Wind: Schleifen, deren Mitte gegen den Wind liegt (erst Gegenwind, heim mit Rückenwind)
      [-50, -15, 20, 55, 150].forEach((o) => cands.push({ brg: opts.windFrom + o + (rnd() - 0.5) * 10, cw: rnd() < 0.5, seed: Math.floor(rnd() * 1e9), r: r0 }));
    } else if (opts.dirPref == null) {
      const o = rnd() * 72;
      for (let i = 0; i < 5; i++) cands.push({ brg: o + i * 72, cw: rnd() < 0.5, seed: Math.floor(rnd() * 1e9), r: r0 });
    } else {
      const d = opts.dirPref;
      [[-30, true], [0, false], [30, false], [0, true]].forEach(([o, cw]) => cands.push({ brg: d + o, cw, seed: Math.floor(rnd() * 1e9), r: r0 }));
    }
    let calls = 0, done = 0;
    const totalPlanned = cands.length + 3;
    const conc = opts.concurrency || 2;
    const tryOne = async (c) => {
      let wps = loopWaypoints(start, c.brg, c.r, c.cw, c.seed);
      // Zwischenpunkte auf nahe Lieblingswege legen
      if (opts.fav && (opts.favWeight || 0) >= 0.25) {
        const rad = Math.min(700, c.r * 0.4) * (0.5 + opts.favWeight);
        wps = wps.map((p, i) => (i === 0 || i === wps.length - 1 ? p : favSnap(opts.fav, p, rad) || p));
      }
      calls++;
      try {
        let usedWps = wps;
        let geo = await route(wps);
        let a = analyzeRoute(geo, cond);
        a.detour = viaDetour(a, wps);
        // Stichweg oder Schleife um einen Zwischenpunkt? Erst den Punkt an den Fuß des Umwegs verlegen,
        // hilft das nicht, den Punkt weglassen.
        const worst = (x) => Math.max(0, ...x.detour.map((d) => d.ratio));
        const bad = a.detour.map((d, i) => (d.ratio > 3 ? i + 1 : 0)).filter(Boolean);
        if (bad.length) {
          const tries = [wps.map((p, i) => (bad.includes(i) ? a.detour[i - 1].base : p))];
          if (wps.length - bad.length >= 4) tries.push(wps.filter((_, i) => !bad.includes(i)));
          for (const w2 of tries) {
            try {
              const g2 = await route(w2);
              const a2 = analyzeRoute(g2, cond);
              a2.detour = viaDetour(a2, w2);
              if (worst(a2) < worst(a) - 0.3) { geo = g2; a = a2; usedWps = w2; }
              if (worst(a) <= 3) break;
            } catch (e) { /* nächste Variante */ }
          }
        }
        if (opts.fav) a.favShare = favShare(a, opts.fav);
        let windPen = 0, wind = null;
        if (windW > 0) { wind = windSplit(a, opts.windFrom); windPen = Math.max(0, wind.second - wind.first) * 0.5 * windW; }
        const sc = scoreRoute(a, targetM, sport, { recentShare: shareIn(a.cells, opts.recentCells), windPen, ideal: opts.ideal, signalWeight: opts.signalWeight, favWeight: opts.favWeight, greenWeight: opts.greenWeight });
        a.wind = wind;
        return { ...c, wps: usedWps, a, sc, geo };
      } catch (e) {
        return { ...c, wps, err: e };
      } finally {
        done++; onProgress(Math.min(0.95, done / totalPlanned));
      }
    };
    let results = await pool(cands, conc, tryOne);
    // Fehlgeschlagene einmal mit kleinerem Radius versuchen
    const failed = results.filter((x) => x.err);
    if (failed.length && failed.length < results.length + 1) {
      const retry = await pool(failed.slice(0, 2).map((c) => ({ ...c, r: c.r * 0.8, seed: c.seed + 7, err: undefined })), conc, tryOne);
      results = results.filter((x) => !x.err).concat(retry.filter((x) => !x.err));
    } else results = results.filter((x) => !x.err);
    if (!results.length) {
      const errs = failed.map((f) => String(f.err && f.err.message || f.err));
      throw new Error(errs[0] || 'Keine Route gefunden');
    }
    // Kalibrieren: Radius an Ziellänge anpassen
    for (let round = 0; round < 2; round++) {
      results.sort((x, y) => x.sc.total - y.sc.total);
      // nur die vielversprechendsten nachjustieren, die noch nicht passen
      const good = results.filter((x) => Math.abs(x.a.length - targetM) / targetM <= 0.06);
      if (good.length >= 4) break;
      results.sort((x, y) => x.sc.quality - y.sc.quality);
      const todo = results.filter((x) => Math.abs(x.a.length - targetM) / targetM > 0.06 && !x.tuned).slice(0, round === 0 ? 3 : 2);
      if (!todo.length) break;
      todo.forEach((x) => { x.tuned = true; });
      const refined = await pool(todo.map((x) => ({ brg: x.brg, cw: x.cw, seed: x.seed, r: x.r * clamp(targetM / x.a.length, 0.55, 1.7) })), conc, tryOne);
      refined.forEach((nr) => { if (!nr.err) results.push(nr); });
    }
    results.sort((x, y) => x.sc.total - y.sc.total);
    const picked = [];
    const best = results[0].sc.total;
    const maxPick = opts.maxPick || 5;
    const exclude = opts.excludeCells || [];
    // Nur Runden anbieten, die zur gewählten Distanz passen (±8 %); notfalls ±15 %
    const within = (x, tol) => Math.abs(x.a.length - targetM) / targetM <= tol;
    const tol = results.filter((x) => within(x, 0.08)).length >= 2 ? 0.08 : 0.15;
    for (const x of results) {
      if (picked.length && !within(x, tol)) continue;
      if (picked.length && x.sc.total > best + 2.5) break; // deutlich schlechtere Varianten nicht anbieten
      if (exclude.some((c) => jaccard(c, x.a.cells) >= 0.55)) continue;
      if (picked.every((p) => jaccard(p.a.cells, x.a.cells) < 0.55)) picked.push(x);
      if (picked.length === maxPick) break;
    }
    onProgress(1);
    return { routes: picked, calls, all: results.length };
  }

  /** Wind: Gegenwindanteil erste vs. zweite Hälfte */
  function windSplit(a, windFrom) {
    const half = a.length / 2;
    let h1 = 0, l1 = 0, h2 = 0, l2 = 0;
    for (let i = 1; i < a.pts.length; i++) {
      const L = a.cum[i] - a.cum[i - 1]; if (L < 1) continue;
      const head = Math.cos(rad(angDiff(bearing(a.pts[i - 1], a.pts[i]), windFrom)));
      if (a.cum[i] <= half) { h1 += head * L; l1 += L; } else { h2 += head * L; l2 += L; }
    }
    return { first: l1 ? h1 / l1 : 0, second: l2 ? h2 / l2 : 0 };
  }

  /** Route in Gegenrichtung (für Wind) */
  function reverseAnalysis(a) {
    const n = a.pts.length;
    const pts = a.pts.slice().reverse();
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const segs = a.segs.slice().reverse().map((s) => ({ ...s, i0: n - 1 - s.i1, i1: n - 1 - s.i0 }));
    const samples = resample(pts, cum, 15);
    const nodes = (a.nodes || []).map((x) => ({ ...x, i: n - 1 - x.i, d: cum[n - 1 - x.i] })).reverse();
    return { ...a, pts, cum, segs, samples, nodes, asc: a.desc, desc: a.asc, reversed: !a.reversed };
  }

  // ---------- Vereinfachen & GPX ----------
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const lat0 = rad(pts[0].lat);
    const xy = pts.map((p) => [rad(p.lon) * Math.cos(lat0) * R, rad(p.lat) * R]);
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let md = 0, mi = -1;
      const [x1, y1] = xy[s], [x2, y2] = xy[e];
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
      for (let i = s + 1; i < e; i++) {
        const [x, y] = xy[i];
        let t = L2 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0; t = clamp(t);
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

  function buildGPX(pts, { name, desc, waypoints = [], maxPts = 3000 }) {
    let tol = 1.5, sp = simplify(pts, tol);
    while (sp.length > maxPts && tol < 50) { tol *= 1.5; sp = simplify(pts, tol); }
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const L = [];
    L.push('<?xml version="1.0" encoding="UTF-8"?>');
    L.push('<gpx version="1.1" creator="Wetterwege" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
    L.push(`  <metadata><name>${xmlEsc(name)}</name>${desc ? `<desc>${xmlEsc(desc)}</desc>` : ''}<time>${now}</time></metadata>`);
    waypoints.forEach((w) => L.push(`  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}"><name>${xmlEsc(w.name)}</name></wpt>`));
    L.push(`  <trk><name>${xmlEsc(name)}</name>${desc ? `<desc>${xmlEsc(desc)}</desc>` : ''}<trkseg>`);
    sp.forEach((p) => L.push(`    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele != null ? `<ele>${(+p.ele).toFixed(1)}</ele>` : ''}</trkpt>`));
    L.push('  </trkseg></trk>');
    L.push('</gpx>');
    return { xml: L.join('\n') + '\n', count: sp.length };
  }

  /** Punkte, die nahe an der Route liegen (für Wasser/WC) */
  function nearRoute(a, pois, maxD = 120) {
    const out = [];
    pois.forEach((p) => {
      let best = Infinity, bestD = 0;
      for (const s of a.samples) {
        if (Math.abs(s.lat - p.lat) > 0.003) continue;
        const d = dist(s, p);
        if (d < best) { best = d; bestD = s.d; }
      }
      if (best <= maxD) out.push({ ...p, off: best, at: bestD });
    });
    out.sort((x, y) => x.at - y.at);
    // Dubletten im Umkreis von 40 m entfernen
    return out.filter((p, i) => !out.slice(0, i).some((q) => q.kind === p.kind && dist(p, q) < 40));
  }

  function fountainSeason(dateT, tags = {}) {
    if (tags.seasonal === 'no') return { on: true, text: 'ganzjährig' };
    const d = new Date(dateT);
    const m = d.getMonth() + 1, day = d.getDate();
    if (m >= 5 && m <= 9) return { on: true, text: 'in Betrieb (Saison)' };
    if ((m === 10 && day <= 15) || m === 4) return { on: null, text: 'Saisonübergang, evtl. abgestellt' };
    if (m === 10) return { on: null, text: 'Saisonende, oft schon abgestellt' };
    return { on: false, text: 'im Winter meist abgestellt' };
  }

  const api = {
    dist, bearing, destination, angDiff, clamp, mulberry32, hashStr,
    SPORTS, SURF_NAMES, parseWeather, hourIndex, isDark, computeConditions, explainConditions, headline, slotReasons, timeWindows, summarizePollen,
    parseTags, surfClass, mudSus, snowSus, segState, analyzeRoute, resample, overlapStats, countUturns, cellSet, jaccard, shareIn,
    scoreRoute, qualityPct, viaDetour, favIndex, favShare, favSnap, variantLabels, loopDirection, plausibility, surfaceInfo, nodeEvents, countTurns, loopWaypoints, generateLoops, pool, windSplit, reverseAnalysis, simplify, buildGPX, nearRoute, fountainSeason,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WWCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
