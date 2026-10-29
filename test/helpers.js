// Erfundene Testdaten: synthetisches Wetter und ein Schein-Router. Keine echten Daten, kein Netz.
const C = require('../src/core.js');

/** Open-Meteo-Antwort nachbauen. rain = mm pro Stunde im Regenfenster der letzten Tage */
function mockWeather({ rain = 0, soil = 0.22, past = 4 } = {}) {
  const now = new Date(); const t0 = new Date(now); t0.setHours(0, 0, 0, 0); t0.setDate(t0.getDate() - past);
  const n = (past + 3) * 24;
  const time = [], T = [], P = [], SD = [], SM = [], D = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(t0.getTime() + i * 3600e3);
    time.push(new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16));
    T.push(8 + 5 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI));
    P.push(rain && i > 40 && i < 70 ? rain : 0);
    SD.push(0); SM.push(rain ? 0.36 : soil);
    D.push((i % 24) > 7 && (i % 24) < 18 ? 1 : 0);
  }
  const days = Array.from({ length: past + 3 }, (_, k) => { const d = new Date(t0.getTime() + k * 864e5); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); });
  return {
    utc_offset_seconds: -now.getTimezoneOffset() * 60,
    hourly: { time, temperature_2m: T, apparent_temperature: T.map((x) => x - 2), relative_humidity_2m: T.map(() => 80), precipitation: P, precipitation_probability: P.map((p) => (p ? 80 : 10)), snowfall: P.map(() => 0), snow_depth: SD, weather_code: P.map((p) => (p ? 61 : 3)), wind_speed_10m: T.map(() => 18), wind_direction_10m: T.map(() => 250), wind_gusts_10m: T.map(() => 35), soil_moisture_0_to_1cm: SM, et0_fao_evapotranspiration: T.map(() => 0.05), uv_index: T.map(() => 1), is_day: D },
    daily: { time: days, sunrise: days.map((d) => d + 'T07:30'), sunset: days.map((d) => d + 'T18:15') },
  };
}

/** Schein-Router: verbindet die Wegpunkte mit leichtem Zickzack, Wegtags abwechselnd Asphalt und Waldweg */
function mockRoute(wps) {
  const coords = []; const msgs = [['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy']];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1]; const n = 40;
    for (let k = 0; k < n; k++) {
      const f = k / n; const off = (k % 2 ? 1 : -1) * 0.00004 * Math.sin(Math.PI * f);
      const p = { lat: a.lat + (b.lat - a.lat) * f + off, lon: a.lon + (b.lon - a.lon) * f };
      coords.push([+p.lon.toFixed(6), +p.lat.toFixed(6), 520 + 10 * Math.sin(coords.length / 20)]);
      if (k % 10 === 9) msgs.push([String(Math.round(+p.lon.toFixed(6) * 1e6)), String(Math.round(+p.lat.toFixed(6) * 1e6)), '520', '100', '1500', '0', '0', '0', '0', k % 20 === 9 ? 'highway=path surface=ground estimated_forest_class=5' : 'highway=residential surface=asphalt lit=yes', k === 19 ? 'highway=crossing crossing=traffic_signals' : (k === 39 && i === 1 ? 'estimated_crossing_class=4' : '')]);
    }
  }
  const l = wps[wps.length - 1]; coords.push([+l.lon.toFixed(6), +l.lat.toFixed(6), 520]);
  let len = 0; for (let i = 1; i < coords.length; i++) len += C.dist({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'track-length': String(Math.round(len)), 'filtered ascend': '40', cost: String(Math.round(len * 1.5)), messages: msgs }, geometry: { type: 'LineString', coordinates: coords } }] };
}

module.exports = { mockWeather, mockRoute };
