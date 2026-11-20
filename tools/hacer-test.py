# Regenera test.html (copia local de pruebas) a partir de index.html conservando el bloque inicial de pruebas.
import os
r = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
t = open(os.path.join(r, 'test.html'), encoding='utf-8').read()
i = open(os.path.join(r, 'index.html'), encoding='utf-8').read()
head = t[:t.index('<meta charset')]
open(os.path.join(r, 'test.html'), 'w', encoding='utf-8').write(head + i[i.index('<meta charset'):])
print('test.html regenerado')
