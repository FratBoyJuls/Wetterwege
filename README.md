# Wetterwege

Plant Lauf-, Spazier- und Radrunden in München, die zum Wetter passen: Nach Regen meidet die App matschige Erdwege,
bei Dunkelheit nimmt sie beleuchtete Wege, und auf Wunsch läuft man so viel wie möglich durchs Grüne.
Dazu Formen-Routen (Herz, Tiere, Schrift), GPX für die COROS-Uhr und eine Ablage für gute Runden.

**Adresse:** https://wetterwege.klaercreative.workers.dev · **Stand:** siehe `CHANGELOG.md`

## Für Julius
- **Aufs Handy:** Adresse in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
- **Updates** kommen von selbst: Sobald neuer Code auf `main` liegt, veröffentlicht Cloudflare ihn. Die App holt ihn
  beim nächsten Öffnen.
- **Daten** (gespeicherte Routen, Lieblingswege, Einstellungen) liegen nur auf dem jeweiligen Gerät. Vor einem
  Handywechsel oder Adresswechsel: Einstellungen → „Daten sichern“, auf dem neuen Gerät „Sicherung einspielen“.
- **Zurück zur letzten Version:** Cloudflare → Workers & Pages → wetterwege → „Deployments“ → beim älteren Eintrag
  „…“ → „Rollback“.
- **Wer sieht meine Daten?** Niemand außer dir. Alles liegt nur im Browser deines Geräts, nichts geht an einen Server.
  Wer die Adresse öffnet, bekommt eine leere App.

## Aufbau
```
Wetterwege/
├── index.html            gebaute App (von build.py erzeugt, nicht von Hand ändern)
├── sw.js, manifest.webmanifest, icon-*.png, _headers
├── build.py              fügt src/ und vendor/ zu index.html zusammen
├── src/
│   ├── index.html        Gerüst der Oberfläche
│   ├── style.css         Apple-Stil, hell und dunkel
│   ├── profile.js        Routing-Profile für BRouter (je Sportart, Wetter und Vorlieben)
│   ├── core.js           Wetter, Matsch-Index, Bewertung, Rundkurse, GPX
│   ├── shape.js          Formen-Routen: Umriss, Platzierung, Formtreue, Stichwege
│   ├── app.js            Grundlagen, Karte, Wetter laden, Routing, Seiten, Sheet
│   ├── routes.js         Routen berechnen und anzeigen, Details, GPX
│   ├── lib.js            Gespeichert, Sicherung, Lieblingswege, Bedingungen, Vorlieben
│   ├── shapeui.js        Form-Bereich und Zeichnen
│   └── main.js           Startseite, Ereignisse, Start
├── vendor/               Leaflet 1.9.4
└── test/
    ├── unit.test.js      schnelle Tests ohne Browser
    ├── ui.test.js        Oberfläche mit Playwright und Schein-Diensten
    └── helpers.js        erfundene Wetter- und Routendaten
```
Die JavaScript-Dateien in `src/` teilen sich einen Gültigkeitsbereich: `app.js` öffnet ihn, `main.js` schließt ihn.

## Bauen und testen
```
cd ~/Documents/Wetterwege
python3 build.py
node --test test/unit.test.js
cd test && npm install && node ui.test.js
```
Der Oberflächen-Test speichert Bildschirmfotos in `test/out/`.

## Dienste (alle ohne Konto)
Open-Meteo (Wetter, Pollen), BRouter auf brouter.de (Routing, eigene Profile werden hochgeladen), OpenStreetMap-Kacheln
(openstreetmap.de, CyclOSM, OpenTopoMap, Esri), Photon (Ortssuche), Overpass (Trinkbrunnen, WCs, Biergärten).
Diese Gratis-Dienste sind für kleine, private Nutzung gedacht. Für viele Nutzer braucht es eigene Anbieter.

## Veröffentlichung
Cloudflare Worker `wetterwege`, baut bei jedem Push auf `main`. Kein Build-Befehl (die gebaute `index.html` liegt im
Repository), Deploy `npx wrangler deploy --assets . --name wetterwege --compatibility-date 2026-10-01`.
Was nicht veröffentlicht wird, steht in `.assetsignore`.
