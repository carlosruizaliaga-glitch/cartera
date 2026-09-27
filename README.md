# Cartera Carlos

App del móvil (PWA) para seguir mi cartera de bolsa (acciones y ETF) y cripto. Sustituye a la hoja "Cartera v3".

- **Dirección:** https://carlosruizaliaga-glitch.github.io/cartera/
- **Datos:** en la nube (Supabase, proyecto "Cartera") y copia en cada móvil. Funciona sin conexión y sincroniza al volver la red.
- **Acceso:** con mi código. Es el mismo en todos los móviles.

## Instalar en el móvil
- **iPhone (Safari):** abrir la dirección → botón Compartir → **Añadir a pantalla de inicio**.
- **Android (Chrome):** abrir la dirección → menú ⋮ → **Instalar app**.

Ábrela siempre desde el icono y escribe tu código la primera vez.

## Apuntar cosas (botón verde **+** de abajo)

**Compra**
1. **+** → **+ COMPRA**.
2. Escribe unas letras del ticker (p. ej. `ko`) y toca la empresa.
3. Pon las **acciones**. Fecha, precio, cambio del BCE y comisión vienen rellenos: cámbialos solo si no coinciden.
4. **+ GUARDAR COMPRA**.

**Venta**
1. **+** → **− VENTA** → elige la empresa (solo salen las que tienes).
2. Pon las acciones o pulsa **TODO**.
3. Antes de guardar verás la plusvalía FIFO y, si vendes con pérdida, el aviso de la **regla de los 2 meses**.
4. **− GUARDAR VENTA**.

**Dividendo**
- **Automático:** cuando pasa la fecha de pago, la app crea el dividendo como **pendiente**. En la pestaña **DIVIDENDOS** pulsa **✓ OK**, o **CORREGIR** para poner el neto que te llegó.
- **A mano:** **+** → **$ DIVIDENDO** → empresa → **neto recibido** (o toca "ESTIMADO… USAR") → **GUARDAR**.
- **Tipos:** dividendo, scrip cobrado en efectivo, o sustitución (préstamo de valores de DeGiro).

**Scrip (acciones gratis)**
- **+** → **⟳ SCRIP** → empresa → acciones recibidas → **GUARDAR**. Suman acciones a coste 0 y bajan tu precio medio.

**Empresa nueva**
- **+** → **◆ EMPRESA NUEVA** → ticker y mercado → **BUSCAR**.
- La app rellena nombre, sector, país, divisa y dividendo. Revísalo y **GUARDAR**.
- Queda en **SEGUIM.**, en la pestaña Cartera. Desde su ficha puedes comprar.

**Corregir o borrar**
- Abre la ficha de la empresa, toca la operación o el dividendo y cambia lo que haga falta, o pulsa **BORRAR** dos veces.

## Copia de seguridad
Ve a **⚙ (arriba a la derecha)** → **COPIA DE SEGURIDAD**:
- **EXCEL COMPLETO:** posiciones, operaciones, dividendos, plusvalías, empresas, gastos, brokers y retenciones.
- **CSV OPERACIONES / CSV DIVIDENDOS:** para abrir en cualquier hoja de cálculo.
- **COPIA PARA RESTAURAR:** archivo `.json` con todo. Se recupera con **RESTAURAR COPIA**.

Guarda una copia al mes en Drive o mándatela por email.

## Nota
El plan gratuito de Supabase pausa el proyecto si pasa una semana sin ningún uso. Si ocurre, entra en supabase.com → proyecto **Cartera** → **Restore**. Mientras tanto, la app sigue funcionando en el móvil y sube los cambios cuando se reactiva.
