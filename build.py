"""Baut die App: fügt src/ und Leaflet zu einer einzigen index.html im Hauptordner zusammen.
Aufruf:  python3 build.py
Die Dateien im Hauptordner (index.html, sw.js, manifest, Icons) sind das, was Cloudflare veröffentlicht."""
import pathlib, re
root = pathlib.Path(__file__).parent
src = root / 'src'
JS = ['profile.js', 'core.js', 'shape.js', 'app.js', 'routes.js', 'lib.js', 'shapeui.js', 'main.js']
html = (src / 'index.html').read_text()
css = (src / 'style.css').read_text()
js = '\n'.join((src / f).read_text() for f in JS)
version = re.search(r"const VERSION = '([\d.]+)'", js).group(1)
lcss = (root / 'vendor/leaflet.css').read_text()
ljs = (root / 'vendor/leaflet.js').read_text()
for ph in ['/*CSS*/', '/*JS*/', '/*LEAFLETCSS*/', '/*LEAFLETJS*/']:
    assert ph in html, ph
html = (html.replace('/*LEAFLETCSS*/', lcss)
            .replace('/*CSS*/', css)
            .replace('/*LEAFLETJS*/', '/* Leaflet 1.9.4, BSD-2-Clause, (c) Volodymyr Agafonkin, CloudMade */\n' + ljs.replace('</script>', '<\\/script>'))
            .replace('/*JS*/', js.replace('</script>', '<\\/script>')))
(root / 'index.html').write_text(html)
# Neuer Cache-Name je Version, damit installierte Apps das Update sicher holen
sw = root / 'sw.js'
sw.write_text(re.sub(r"const CACHE = '[^']*';", f"const CACHE = 'wetterwege-{version}';", sw.read_text()))
(root / 'LICENSE-leaflet.txt').write_text((root / 'vendor/LICENSE').read_text())
print(f'Wetterwege {version}: index.html mit {len(html):,} Zeichen gebaut')
