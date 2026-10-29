// Oberflächen-Test mit Playwright und Schein-Diensten (kein Netz, erfundene Daten).
// Einmalig:  cd test && npm install   ·   Start:  node test/ui.test.js   (Bilder landen in test/out/)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { mockWeather, mockRoute } = require('./helpers.js');
const HTML = path.join(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'out');
process.chdir(__dirname);
const sh = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') });
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ['--headless=new'] } : {});
  const errors = []; const out = {};
  const g = mockRoute([{lat:48.1374,lon:11.5755},{lat:48.15,lon:11.59},{lat:48.155,lon:11.57},{lat:48.1374,lon:11.5755}]).features[0].geometry.coordinates;
  fs.writeFileSync('fav.gpx', `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Isar-Runde</name><trkseg>${g.map(p=>`<trkpt lat="${p[1]}" lon="${p[0]}"/>`).join('')}</trkseg></trk></gpx>`);
  const runs = [
    { name:'desk', vp:{width:1366,height:860}, scheme:'light' },
    { name:'phone', vp:{width:390,height:844}, scheme:'light', mobile:true },
    { name:'phoneDark', vp:{width:390,height:844}, scheme:'dark', mobile:true },
  ].filter(r => !process.env.ONLY || r.name === process.env.ONLY);
  for (const run of runs) {
    const ctx = await browser.newContext({ viewport: run.vp, colorScheme: run.scheme, acceptDownloads: true, hasTouch: !!run.mobile, isMobile: !!run.mobile, deviceScaleFactor: run.mobile ? 2 : 1 });
    const page = await ctx.newPage();
    const N = (s) => run.name + '-' + s;
    page.on('pageerror', e => errors.push(run.name+': '+e.message + ' ' + (e.stack||'').split('\n')[1]));
    page.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errors.push(run.name+' console: '+m.text()); });
    await page.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith('file:') || u.startsWith('data:')) return route.continue();
      if (u.includes('api.open-meteo.com')) return route.fulfill({ json: mockWeather({ rain: 1.2 }) });
      if (u.includes('air-quality')) return route.fulfill({ json: { error: true, reason: 'test' } });
      if (u.includes('/brouter/profile')) { (out[run.name+'-profileGreen'] = out[run.name+'-profileGreen'] || []).push((route.request().postData()||'').match(/c_green = [0-9.]+/)?.[0] + ' ' + (route.request().postData()||'').match(/c_wet = [0-9.]+/)?.[0] + ' ' + (route.request().postData()||'').match(/c_storm = \w+/)?.[0]); return route.fulfill({ json: { profileid: 'custom_123' } }); }
      if (u.includes('brouter.de/brouter?')) { const q=new URL(u).searchParams.get('lonlats').split('|').map(s=>{const [lon,lat]=s.split(',').map(Number);return{lat,lon}}); return route.fulfill({ json: mockRoute(q) }); }
      if (u.includes('interpreter')) return route.fulfill({ json: { elements: [{type:'node',lat:48.1376,lon:11.5757,tags:{amenity:'drinking_water',name:'Fischbrunnen'}},{type:'node',lat:48.1378,lon:11.5759,tags:{amenity:'toilets',fee:'no'}}] } });
      if (u.includes('photon')) return route.fulfill({ json: { features: [] } });
      if (u.match(/tile|arcgisonline/)) return route.fulfill({ status: 200, contentType: 'image/png', path: path.join(__dirname, 'tile.png') });
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto('file://' + HTML);
    await page.waitForTimeout(900);
    await sh(page, N('01-home'));
    out[N('wxcard')] = await page.textContent('#wxCard');
    // Vorlieben
    await page.click('#prefsRow'); await page.waitForTimeout(400);
    if (run.mobile) { await page.evaluate(() => window.WW.setSheet('full')); await page.waitForTimeout(500); }
    await sh(page, N('01b-prefs'));
    await page.click('[data-preset="park"]'); await page.click('[data-mud="avoid"]'); await page.waitForTimeout(200);
    await sh(page, N('01c-prefs-park'));
    await page.click('#v-prefs [data-back]'); await page.waitForTimeout(400);
    out[N('prefsShort')] = await page.textContent('#prefsShort');
    // Runden
    await page.click('#distPlus');
    out[N('dist')] = await page.inputValue('#dist');
    await page.click('#goBtn');
    await page.waitForFunction(() => !window.WW.R.busy && window.WW.curView()==='results', null, { timeout: 100000 });
    await page.waitForTimeout(700);
    await sh(page, N('02-results'));
    out[N('variants')] = await page.$$eval('.variant', l => l.map(x=>x.innerText.replace(/\s+/g,' ')));
    // speichern
    await page.click('#saveBtn');
    await page.fill('#dlgInput', 'Testrunde Isar');
    await page.click('#dlgOk');
    await page.waitForTimeout(400);
    out[N('saved')] = await page.textContent('#resTitle');
    if (run.mobile) { await page.evaluate(() => window.WW.setSheet('full')); await page.waitForTimeout(500); }
    await sh(page, N('03-detail'));
    await page.evaluate(() => { const b=document.getElementById('resBody'); b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(300);
    await sh(page, N('04-detail-bottom'));
    const [dl] = await Promise.all([page.waitForEvent('download', {timeout: 8000}).catch(()=>null), page.click('#gpxBtn')]);
    out[N('gpx')] = dl ? dl.suggestedFilename() : 'kein Download';
    // zurück, Wetter
    await page.click('#v-results [data-back]');
    await page.waitForTimeout(400);
    await page.click('#wxCard');
    await page.waitForTimeout(500);
    if (run.mobile) { await page.evaluate(() => window.WW.setSheet('full')); await page.waitForTimeout(500); }
    await sh(page, N('05-weather'));
    await page.evaluate(() => { const b=document.querySelector('#v-weather .vbody'); b.scrollTop = 600; });
    await page.waitForTimeout(300);
    await sh(page, N('06-weather2'));
    await page.click('#v-weather [data-back]'); await page.waitForTimeout(400);
    // Einstellungen + Fav
    await page.click('#settingsBtn'); await page.waitForTimeout(400);
    await page.setInputFiles('#favFile', 'fav.gpx'); await page.waitForTimeout(300);
    const [bk] = await Promise.all([page.waitForEvent('download', {timeout: 8000}).catch(()=>null), page.click('#dataExport')]);
    if (bk) { await bk.saveAs('backup.json'); const j = JSON.parse(fs.readFileSync('backup.json','utf8')); out[N('backup')] = [j.format, j.routes.length, Object.keys(j.data)];
      // als Format 1 (0.2.0) umbauen und in frischem Kontext einspielen, siehe unten
      fs.writeFileSync('backup-v1.json', JSON.stringify({ app:'wetterwege', format:1, data:{ 'ww:v1': j.data['ww:v1'], 'ww:favs': j.data['ww:favs'], 'ww:saved': j.routes.map(r=>({id:'old'+r.id, name:'Alt: '+r.name, sport:r.sport, km:r.km, asc:r.asc, t:r.created, start:r.start, reversed:false, geo:r.geo})) } })); }
    await sh(page, N('07-settings'));
    await page.click('#v-settings [data-back]'); await page.waitForTimeout(400);
    // Gespeichert
    await page.click('[data-tab="library"]'); await page.waitForTimeout(500);
    await sh(page, N('08-library'));
    out[N('lib')] = await page.$$eval('#libList li', l => l.map(x=>x.innerText.replace(/\s+/g,' ')));
    await page.click('#libList [data-open]'); await page.waitForTimeout(800);
    out[N('openSaved')] = await page.textContent('#resTitle');
    await sh(page, N('09-saved-open'));
    await page.click('#v-results [data-back]'); await page.waitForTimeout(400);
    // Form
    await page.click('[data-tab="shape"]'); await page.waitForTimeout(300);
    await page.click('#shapeChips [data-word="Herz"]'); await page.waitForTimeout(600);
    await sh(page, N('10-shape-herz'));
    out[N('shapeCap')] = await page.textContent('#shapeCaption');
    await page.click('#shapeGo');
    await page.waitForFunction(() => !window.WW.R.busy && window.WW.curView()==='results', null, { timeout: 150000 });
    await page.waitForTimeout(700);
    await sh(page, N('11-shape-result'));
    out[N('shapeBox')] = await page.textContent('#shapeBox');
    out[N('shapeVariants')] = await page.$$eval('.variant', l => l.map(x=>x.innerText.replace(/\s+/g,' ')));
    await page.click('#v-results [data-back]'); await page.waitForTimeout(400);
    for (const w of ['Hippo', 'MUC']) {
      await page.fill('#shapeInput', w); await page.press('#shapeInput', 'Enter'); await page.waitForTimeout(500);
      out[N('shape_'+w)] = [await page.textContent('#shapeTitle'), await page.textContent('#shapeCaption'), await page.$$eval('#shapeKind button', l=>l.map(x=>x.textContent))];
      await sh(page, N('12-shape-'+w));
    }
    // Zeichnen
    await page.click('#drawBtn'); await page.waitForTimeout(300);
    const box = await page.locator('#drawCanvas').boundingBox();
    const cx = box.x + box.width/2, cy = box.y + box.height/2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let i=0;i<=40;i++){ const a=i/40*Math.PI*2; await page.mouse.move(cx+Math.sin(a)*90, cy-Math.cos(a)*60+60); }
    await page.mouse.up();
    await sh(page, N('13-draw'));
    await page.click('#drawDone'); await page.waitForTimeout(500);
    out[N('drawn')] = await page.textContent('#shapeCaption');
    await sh(page, N('14-drawn'));
    out[N('hOverflow')] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    out[N('bodyH')] = await page.evaluate(() => [document.body.getBoundingClientRect().height, innerHeight, getComputedStyle(document.documentElement).getPropertyValue('--app-h')]);
    await page.click('#layerBtn'); await page.waitForTimeout(200);
    await sh(page, N('15-layers'));
    await ctx.close();
    if (run.name === 'desk') {
      const c2 = await browser.newContext({ viewport: run.vp }); const p2 = await c2.newPage();
      p2.on('pageerror', e => errors.push('import: '+e.message));
      await p2.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.fulfill({status:204, body:''}));
      await p2.goto('file://' + HTML); await p2.waitForTimeout(600);
      await p2.click('#settingsBtn'); await p2.waitForTimeout(300);
      await p2.setInputFiles('#dataImport', 'backup-v1.json'); await p2.waitForTimeout(2500);
      await p2.click('[data-tab="library"]'); await p2.waitForTimeout(600);
      out['import-v1-lib'] = await p2.$$eval('#libList li', l => l.map(x=>x.innerText.replace(/\s+/g,' ')));
      out['import-v1-prefs'] = await p2.textContent('#prefsShort');
      await c2.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
  const fails = [...errors];
  for (const k of Object.keys(out)) if (/hOverflow/.test(k) && out[k] !== 0) fails.push(k + ' = ' + out[k]);
  if (!(out['import-v1-lib'] || []).some((x) => /Alt:/.test(x))) fails.push('Sicherung aus 0.2.0 wurde nicht übernommen');
  ['fav.gpx', 'backup.json', 'backup-v1.json'].forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* egal */ } });
  if (fails.length) { console.error('FEHLER', fails); process.exit(1); }
  console.log('Oberflächen-Test ok, Bilder in test/out/');
})();
