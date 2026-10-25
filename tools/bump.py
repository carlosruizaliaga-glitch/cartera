# Marca una versión nueva de la app (hora de Madrid). Se ejecuta antes de cada publicación:
#   python tools/bump.py
# Escribe version.js (la versión que lleva la app) y version.json (la que la app consulta en internet).
import json, datetime as dt, os

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
v = dt.datetime.now().strftime('%Y-%m-%d %H:%M')
files = ['./', 'index.html', 'app.js', 'store.js', 'market.js', 'calc.js', 'forms.js', 'dividends.js', 'screens.js',
         'analysis.js', 'xlsx.js', 'settings.js', 'version.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png',
         'icon-512.png', 'icon-maskable.png']
open(os.path.join(root, 'version.js'), 'w', encoding='utf-8').write(
    f"window.APP_VERSION = {json.dumps(v)};\nwindow.APP_FILES = {json.dumps(files)};\n")
open(os.path.join(root, 'version.json'), 'w', encoding='utf-8').write(json.dumps({'v': v}) + '\n')
print('Versión', v)
