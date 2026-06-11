# Guía de Usuario · Apart Cba

Sistema de gestión (PMS) para departamentos temporales: reservas, unidades, huéspedes, limpieza, mantenimiento, caja y liquidaciones a propietarios. Esta guía es para vos: el dueño, el recepcionista, el encargado de limpieza o mantenimiento, o un propietario que entra a ver sus unidades.

---

## 1. Antes de empezar

### Acceso al sistema
- **URL del dashboard**: la que te pasó el administrador (algo como `https://apartcba.vercel.app`).
- **URL móvil**: la misma URL pero terminada en `/m`. Pensada para celular, para personal de campo (limpieza, mantenimiento, conserjería).
- **Login**: `/login` con tu email y contraseña.
- **Configuración inicial**: la primera vez que se instala el sistema, alguien entra a `/setup` y crea el superadmin. Después esa página se bloquea sola.

### Roles disponibles
Cada usuario tiene **un rol**, y el rol decide qué ve y qué puede hacer:

| Rol | Para quién | Qué puede hacer |
|---|---|---|
| **Administrador** | Dueño / gerente | Todo: ver, crear, editar y borrar en cualquier módulo. Configurar equipo y permisos. |
| **Recepción** | Personal de front-desk | Reservas, huéspedes, check-in/out, cobros, conserjería. Ve caja y liquidaciones (solo lectura). |
| **Mantenimiento** | Equipo técnico | Tickets de mantenimiento (crear, asignar, resolver). Ve unidades y limpieza. |
| **Limpieza** | Personal de housekeeping | Sus tareas de limpieza (marcar en progreso / completada). Ve unidades. |
| **Propietario** | Dueño de unidades | Solo lectura: sus unidades, sus reservas, sus liquidaciones. |

> El administrador da de alta a cada usuario desde **Configuración → Equipo y permisos** y le asigna el rol.

---

## 2. El menú lateral (sidebar)

El menú de la izquierda agrupa los módulos en cuatro bloques. Lo que cada usuario ve depende de su rol.

- **Operación**: Dashboard · Grid PMS · Unidades · Reservas · Huéspedes
- **Servicio**: Mantenimiento · Limpieza · Conserjería · Inventario
- **Finanzas**: Caja · Liquidaciones · Propietarios
- **Integraciones**: Channel Manager (sincronización con Airbnb / Booking)
- **Configuración** (solo admin): Equipo y permisos · General

El sidebar se puede colapsar para liberar pantalla.

---

## 3. Dashboard (página de inicio)

Es lo primero que ves al entrar. Te resume el estado del negocio en una pantalla.

### Lo que vas a encontrar

1. **Saludo + ocupación de los últimos 30 días**: porcentaje grande arriba a la derecha.
2. **Estado de las unidades**: cinco tarjetas con el conteo en cada estado:
   - 🟢 **Disponible** — lista para vender
   - 🟡 **Reservado** — con reserva próxima pero todavía vacía
   - 🔵 **Ocupado** — huésped adentro
   - 🩵 **Limpieza** — turnover en curso
   - 🟠 **Mantenimiento** — fuera de servicio
   - Click en cualquier tarjeta → te lleva al **Grid PMS**.
3. **Revenue 30 días**: gráfico de ingresos diarios, separado por moneda (ARS / USD).
4. **Atención requerida**: lista corta de cosas urgentes — tickets, limpiezas pendientes, pedidos de conserjería sin atender, montos por cobrar.
5. **Próximos check-in / check-out**: las próximas 5 entradas y salidas con la fecha y la unidad.

> Si algo en "Atención requerida" tiene número, hacé click — te lleva directo al módulo correspondiente.

---

## 4. Operación

### 4.1 Grid PMS (`/dashboard/unidades/kanban`)

Es la **vista calendario** estilo timeline: filas = unidades, columnas = días (≈90 días, 14 hacia atrás y 75 hacia adelante).

**Para qué sirve**: ver de un pantallazo qué unidades están libres, ocupadas o reservadas en cualquier fecha.

**Cómo se usa**:
- **Crear reserva**: hacé click en una celda vacía (unidad + día) y te abre el formulario de reserva con esos datos precargados.
- **Mover una reserva**: arrastrá la barrita de la reserva a otra unidad u otra fecha. El sistema valida que no haya conflicto y te avisa si choca con otra reserva.
- **Ver detalle**: click en la barra de una reserva → popover con huésped, monto, estado, fechas; desde ahí podés abrir el detalle completo.
- **Navegar fechas**: las flechas ⬅️ ➡️ mueven la ventana 7 días. El botón **Hoy** te lleva al presente.
- **Buscar**: el cuadro de búsqueda filtra unidades por nombre o código.

> Es la pantalla que más usás en el día a día.

### 4.2 Unidades (`/dashboard/unidades`)

Lista de tus departamentos. Para cada uno: código, nombre, dirección, capacidad, propietarios y estado actual.

- **Crear unidad**: botón **Nueva unidad** arriba. Cargás código (ej. `A-301`), nombre, dirección, dormitorios, capacidad, etc.
- **Editar / abrir detalle**: click en la fila → vas al detalle (`/dashboard/unidades/[id]`) donde podés:
  - Cambiar datos generales.
  - Asignar **propietarios** (una unidad puede tener varios, con porcentajes que tienen que sumar 100 %).
  - Subir fotos.
  - Configurar amenities.
- **Cambiar estado**: el estado se actualiza solo según las reservas y tareas, pero el admin puede forzarlo (ej. marcar como Mantenimiento si la unidad está fuera de servicio).

### 4.3 Reservas (`/dashboard/reservas`)

Listado de todas las reservas con filtros por estado, fecha y unidad.

**Estados de una reserva**:
- 🩶 **Pendiente** — reservada pero sin confirmar
- 🟢 **Confirmada** — paga / confirmada, esperando llegada
- 🔵 **Check-in** — huésped ingresó
- 🩵 **Check-out** — huésped salió, esperando cierre
- 🔴 **Cancelada**
- 🟣 **No-show** — no se presentó

**Origen de la reserva**: Directo · Airbnb · Booking · Expedia · VRBO · WhatsApp · Instagram · Otro.

**Cómo se usa**:
- **Nueva reserva**: botón **+ Reserva**. Elegís unidad, fechas, huésped (existente o nuevo), tarifa, moneda, origen.
- **Detalle de reserva** (`/dashboard/reservas/[id]`): podés:
  - **Hacer check-in** (cambia el estado y marca la unidad como Ocupada).
  - **Hacer check-out** (cierra la estadía, dispara la creación de la tarea de limpieza).
  - **Registrar pagos** parciales o totales.
  - **Cancelar** o marcar **no-show**.
  - Asignar amenities, ver huéspedes adicionales, agregar notas.

### 4.4 Huéspedes (`/dashboard/huespedes`)

Base de datos de personas. Se cargan al crear reservas o sueltos.

- Datos básicos: nombre, documento, email, teléfono, nacionalidad, fecha de nacimiento.
- Historial: todas sus reservas pasadas.
- **Tip**: antes de crear un huésped nuevo, buscá por documento o email — el sistema te lo trae si ya existe.

---

## 5. Servicio

### 5.1 Mantenimiento (`/dashboard/mantenimiento`)

Tickets para reportar y resolver problemas en las unidades (canilla rota, AC, manchas, etc.).

**Estados**:
🔴 Abierto · 🔵 En progreso · 🟡 Esperando repuesto · 🟢 Resuelto · 🩶 Cerrado

**Prioridad**: Baja · Media · Alta · 🔴 Urgente

**Cómo se usa**:
- **Crear ticket**: título, descripción, unidad, prioridad, asignado a (opcional), foto.
- **Asignar**: el admin o el responsable se asigna a sí mismo o a alguien del equipo.
- **Avanzar el ticket**: cambiá el estado a "En progreso" cuando empieces; "Esperando repuesto" si frenaste; "Resuelto" cuando esté listo.
- **Cerrar**: el admin cierra cuando confirma.

### 5.2 Limpieza (`/dashboard/limpieza`)

Tareas de turnover entre huéspedes.

**Estados**:
🩶 Pendiente · 🔵 En progreso · 🩵 Completada · 🟢 Verificada · 🔴 Cancelada

**Cómo se usa**:
- Las tareas se generan **automáticamente** cuando un huésped hace check-out.
- También podés crear manualmente (limpieza profunda, retoque, etc.).
- Asignás la tarea a una persona del equipo de limpieza.
- La persona la marca **En progreso** al empezar y **Completada** al terminar.
- El admin / recepción la pasa a **Verificada** después de revisar — recién ahí la unidad vuelve a quedar **Disponible**.

### 5.3 Conserjería (`/dashboard/conserjeria`)

Pedidos de los huéspedes durante su estadía: toallas extra, restaurantes, traslados, lo que sea.

- Cada pedido se registra con huésped, unidad, descripción y estado (pendiente / en progreso / resuelto).
- Útil para que recepción y el equipo no se pierdan ningún pedido.

### 5.4 Inventario (`/dashboard/inventario`)

Stock de amenities y consumibles (toallas, shampoo, café, etc.) por unidad o central.

- Sirve para saber qué reponer y qué se usó por reserva.

---

## 6. Finanzas

### 6.1 Caja (`/dashboard/caja`)

Cuentas de dinero y movimientos.

**Conceptos**:
- **Cuentas**: caja efectivo, banco ARS, banco USD, MercadoPago, etc. Cada una tiene moneda y saldo.
- **Movimientos**: ingresos y egresos. Los pagos de reservas entran acá automáticamente.
- **Transferencias**: mover plata entre cuentas (ej. depositar caja en banco).

**Cómo se usa**:
- **Nueva cuenta**: botón **+ Cuenta** (admin).
- **Movimiento manual**: para registrar un gasto operativo, una propina, un ingreso ajeno a reservas.
- **Transferencia**: elegís cuenta origen, destino, monto, tipo de cambio si es entre monedas distintas.

### 6.2 Liquidaciones (`/dashboard/liquidaciones`)

Cierres mensuales (o del período que elijas) para pagarle a cada propietario lo que le corresponde por sus unidades.

**Cómo se usa**:
- **Nueva liquidación**: elegís propietario, período (desde/hasta) y moneda.
- El sistema arma un **borrador** con todas las reservas confirmadas/cobradas en esas unidades, descuenta tu comisión y los gastos imputados a la unidad.
- **Detalle de liquidación** (`/dashboard/liquidaciones/[id]`): revisás item por item, ajustás si hace falta, y la podés:
  - **Aprobar** (la cierra y queda lista para pagar).
  - **Marcar como pagada** (registra el pago al propietario).
  - **Exportar a PDF** para mandarle al propietario.

### 6.3 Propietarios (`/dashboard/propietarios`)

Listado de los dueños de las unidades.

- Datos: nombre, documento, email, teléfono, CBU/cuenta para liquidar, comisión pactada.
- **Detalle del propietario** (`/dashboard/propietarios/[id]`): sus unidades, sus reservas, su histórico de liquidaciones.
- Si querés que el propietario se logee y vea sus números, lo invitás como usuario con rol **Propietario** desde Configuración → Equipo. Solo va a ver sus unidades y sus liquidaciones.

---

## 7. Integraciones

### Channel Manager (`/dashboard/channel-manager`)

Sincronización de calendarios con plataformas externas vía **iCal**.

**Cómo funciona**:
- **Importar (entrante)**: pegás la URL iCal de Airbnb / Booking de cada unidad. El sistema baja las reservas externas para que veas la disponibilidad real en el Grid PMS.
- **Exportar (saliente)**: cada unidad tuya tiene su propia URL iCal que pegás en Airbnb / Booking para que ellos vean tus reservas directas.
- **Sincronización automática**: corre **una vez por día a las 03:00 UTC** (configurado en Vercel). Si querés sincronizar al toque, el botón **Sincronizar ahora** lo dispara manualmente.

> No reemplaza un channel manager pago tipo Hostaway; sirve para evitar overbookings entre tus canales principales.

### ¿Y un sitio público tipo Booking / Airbnb dentro de Apart Cba?

**No, todavía no existe.** Apart Cba es un sistema de gestión interno (backoffice) — no tiene un storefront público donde un huésped externo entre, vea las unidades, mire disponibilidad y reserve solo. Las reservas llegan al sistema de tres formas:

1. **Plataformas externas** (Airbnb, Booking, Expedia, VRBO) → entran solas vía Channel Manager iCal.
2. **WhatsApp / Instagram / contacto directo** → recepción carga la reserva a mano, marca el origen y listo.
3. **Reserva interna del equipo** → desde el Grid PMS o Reservas.

Si querés ofrecer "reserva online directa" sin pasar por Airbnb/Booking, las opciones son:

- **Página de aterrizaje + WhatsApp**: una landing externa con fotos y precios que termina en un botón de WhatsApp; la reserva la cargás vos.
- **Integrar un motor de reservas externo** (Cloudbeds, Lodgify, etc.) que sincronice por iCal con Apart Cba.
- **Pedirlo como funcionalidad nueva** al equipo de desarrollo: implica construir un sitio público (`/r` o subdominio), buscador de fechas, página por unidad, checkout con pasarela de pago y conexión al motor de reservas interno.

---

## 8. Configuración (solo admin)

### 8.1 Equipo y permisos (`/dashboard/configuracion/equipo`)

- **Invitar usuario**: email + rol → le llega invitación para crear contraseña.
- **Cambiar rol**: desde la fila del usuario.
- **Suspender / dar de baja**: el usuario deja de poder logearse.

### 8.2 General

- Datos de la organización (nombre, logo).
- Moneda por defecto (ARS / USD).
- Reglas de check-in/out por defecto (horarios).
- Comisión genérica para liquidaciones (se puede sobrescribir por unidad/propietario).

---

## 9. App móvil (`/m`)

Cuando entrás desde un celular o vas directo a la URL `/m`, te encuentra una versión simplificada pensada para personal de campo.

**Pantalla principal** muestra:
- 🩵 **Mis tareas de limpieza** — solo las asignadas a vos, pendientes para hoy.
- 🟠 **Mis tickets asignados** — mantenimiento.
- 🟣 **Pedidos de huéspedes** — conserjería pendiente.
- Acceso al dashboard completo si necesitás ver más.

**Flujo típico** del personal de limpieza:
1. Abre `/m` en el celu apenas llega.
2. Ve sus tareas del día con la unidad y la dirección.
3. Marca **En progreso** al entrar a limpiar.
4. Marca **Completada** al terminar (puede sumar foto si el sistema lo pide).
5. El admin / recepción la pasa a **Verificada** desde el dashboard.

---

## 10. Flujos típicos de trabajo

### A) Llega un huésped nuevo (reserva directa)
1. **Reservas → + Reserva** o click en celda libre del **Grid PMS**.
2. Cargás huésped (o lo creás), unidad, fechas, monto, origen `Directo`.
3. Registrás la **seña** desde el detalle de la reserva (Caja se actualiza sola).
4. El día del check-in: detalle de reserva → **Check-in**.
5. Cobrás el saldo si queda algo pendiente.

### B) Sale un huésped
1. Detalle de reserva → **Check-out**.
2. Se crea automáticamente una tarea en **Limpieza** asignable.
3. El equipo de limpieza la toma desde `/m/limpieza`.
4. Recepción/admin verifica → la unidad vuelve a estar **Disponible**.

### C) Se rompe algo en una unidad
1. Recepción crea ticket en **Mantenimiento** (con foto si hace falta).
2. Si es **Urgente** y la unidad está vacía, se la marca como **Mantenimiento** para que no se pueda reservar.
3. Mantenimiento toma el ticket desde `/m/mantenimiento`, lo trabaja, lo cierra.
4. La unidad vuelve a **Disponible**.

### D) Cierre de mes con un propietario
1. **Liquidaciones → + Liquidación**.
2. Elegís propietario, período (1 al 30 del mes) y moneda.
3. Revisás el borrador, ajustás si falta sumar/restar algo.
4. **Aprobar → Exportar PDF** y se lo mandás.
5. Cuando hacés la transferencia, **Marcar como pagada**.

---

## 11. Buenas prácticas

- **Mantené el catálogo de unidades limpio**: códigos consistentes (`A-101`, `A-102`…), una sola entrada por unidad.
- **Cargá pagos al momento**: no los dejes para mañana, así Caja y liquidaciones cierran solos.
- **Asigná las tareas de limpieza**: una tarea sin asignar es invisible en `/m`.
- **Channel Manager**: cuando agregues una unidad nueva, configurá las URLs iCal en el día. Una sola sincronización olvidada puede generar overbooking.
- **Roles mínimos**: dale a cada usuario solo el rol que necesita. Recepción no necesita ser admin.
- **Backup de propietarios**: revisá una vez al mes que los porcentajes de propiedad sumen 100 %; si no, las liquidaciones salen mal.

---

## 12. Problemas frecuentes

| Síntoma | Causa probable | Cómo resolverlo |
|---|---|---|
| No veo un módulo en el menú | Tu rol no tiene permiso | Pedile al admin que te cambie el rol o ajuste permisos |
| El Grid PMS no me deja arrastrar una reserva | Hay conflicto de fechas con otra reserva | Movela a otra unidad o ajustá fechas |
| Una unidad quedó en "Limpieza" después de horas | Tarea de limpieza sin verificar | Andá a Limpieza, verificala manualmente |
| El channel manager no trae reservas nuevas | Cron diario aún no corrió | Botón **Sincronizar ahora** en Channel Manager |
| Una liquidación sale en cero | Reservas no estaban cobradas en el período elegido | Revisá fechas y estados de pago |
| No me llegó la invitación por email | Spam o email mal escrito | Admin la reenvía desde Equipo |

---

## 13. Atajos útiles

- Tecla **Esc** → cierra cualquier modal.
- En el sidebar, click en el ícono → colapsa para ganar pantalla.
- El **logo** arriba a la izquierda → siempre te lleva al dashboard.
- En el Grid PMS, el botón **Hoy** te recentra en la fecha actual.

---

## 14. Soporte

Si algo no funciona como esperás:
1. Refrescá la página (los datos son en tiempo real, pero a veces conviene recargar).
2. Revisá si tu rol te permite la acción.
3. Hablá con el administrador de tu organización.
4. Si el problema persiste, contactá al soporte técnico con el detalle (qué hiciste, qué esperabas, qué pasó).
