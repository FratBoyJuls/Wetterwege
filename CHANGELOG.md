# Änderungen

## 0.3.1 · 02.11.2026
- Behoben: Schlug das Laden des Wetters einmal fehl (z. B. beim Öffnen aus dem Hintergrund), blieb „Wetter nicht
  erreichbar“ stehen. Jetzt versucht die App es automatisch erneut (nach 10 s, 30 s, dann jede Minute), beim
  Zurückkehren in die App und per Tippen auf die Wetterkarte. Der Grund wird angezeigt.
- Behoben: leerer Streifen unter dem Panel am iPhone

## 0.3.0 · 29.10.2026
- Neu aufgebaut im Apple-Stil: Bereiche „Runde · Form · Gespeichert“, Seiten mit Zurück-Pfeil, Panel wie in Apple Karten
- Behoben: schwarzer Streifen unten in der Homescreen-App, ungewolltes Zoomen der Seite
- Neu: Vorlieben-Seite mit Schnellwahl (Park-Runde, Am Wasser, Ruhig, Zügig, Ausgewogen), „So grün wie möglich“,
  Matsch „nach Wetter / immer meiden / egal“, beleuchtete Wege bevorzugen
- Neu: klare Wetter-Ansage auf der Startseite („Achtung: in den letzten 4 Tagen … mm Regen“ oder „Alles easy“)
  und die Seite „Bedingungen“, die erklärt, wie der Matsch-Index entsteht und was die App deshalb macht
- Neu: Formen-Routen (Herz, Stern, Tiere per Emoji, Buchstaben und Zahlen, selbst gezeichnet) mit Größenempfehlung
  und Formtreue; Stichwege zu Punkten neben der Straße werden automatisch entfernt
- Neu: „Gespeichert“ mit Suche, Filter, Sortierung, Vorschaubildern, Umbenennen und Löschen
- „Daten sichern“ nimmt jetzt auch gespeicherte Routen mit; Sicherungen aus 0.2.0 lassen sich weiter einspielen
- Quellcode, Bauskript und Tests liegen wieder im Repository

## 0.2.0 · 24.10.2026
- Neu: „Daten sichern“ und „Sicherung einspielen“ für Lieblingswege, gemerkte Routen und Einstellungen
  (für den Umzug auf eine neue Adresse oder ein neues Gerät)
- Versionsnummer unten in der Seitenleiste
- Vorbereitet für Cloudflare (`.assetsignore`)

## 0.1.0 · 21.10.2026
- Apple-Stil, Lieblingswege per GPX, Senden an COROS, als App installierbar
