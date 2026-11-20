# Publica una versión nueva de la app con un solo comando:
#   python tools/publicar.py "Qué cambia"
# 1) pruebas de cifras y de pantallas  2) marca la versión  3) commit y subida a GitHub  4) espera a que esté en la web.
# Si una prueba falla, no se publica nada.
import json, os, subprocess, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
WEB = 'https://carlosruizaliaga-glitch.github.io/cartera/version.json'
COAUTOR = os.environ.get('COAUTOR', 'Claude <noreply@anthropic.com>')


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, **kw)


def main():
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        sys.exit('Uso: python tools/publicar.py "qué cambia"')
    mensaje = sys.argv[1].strip()

    for nombre, cmd in (('pruebas de cifras', ['node', 'tools/test-cifras.cjs']),
                        ('pruebas de pantallas', ['node', 'tools/test-pantallas.mjs'])):
        print(f'\n== {nombre} ==', flush=True)
        if run(cmd).returncode != 0:
            sys.exit(f'Publicación cancelada: fallan las {nombre}.')

    print('\n== marcar versión ==', flush=True)
    if run([sys.executable, 'tools/bump.py']).returncode != 0:
        sys.exit('Publicación cancelada: no se pudo marcar la versión.')
    version = json.load(open(os.path.join(ROOT, 'version.json'), encoding='utf-8'))['v']

    print('\n== subir a GitHub ==', flush=True)
    run(['git', 'add', '-A'], check=True)
    run(['git', 'commit', '-q', '-m', f'{mensaje}\n\nCo-Authored-By: {COAUTOR}'], check=True)
    run(['git', 'push', '-q'], check=True)

    print(f'\n== esperando a que {version} esté en la web (hasta 12 min) ==', flush=True)
    fin = time.time() + 12 * 60
    while time.time() < fin:
        try:
            with urllib.request.urlopen(f'{WEB}?x={int(time.time())}', timeout=15) as r:
                if version in r.read().decode('utf-8'):
                    print(f'Publicada: {version}')
                    return
        except Exception:
            pass
        time.sleep(20)
    print(f'Subida hecha, pero {version} todavía no aparece en la web. GitHub puede tardar; vuelve a mirar en unos minutos.')


if __name__ == '__main__':
    main()
