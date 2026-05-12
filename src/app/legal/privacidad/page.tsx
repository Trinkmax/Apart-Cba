import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidad · rentOS",
  description:
    "Cómo rentOS recolecta, usa, almacena y protege la información personal de huéspedes, propietarios y contactos.",
};

const UPDATED = "11 de mayo de 2026";

export default function PrivacyPolicyPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Política de privacidad</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Última actualización: {UPDATED}
      </p>

      <Section title="1. Identidad del responsable">
        <p>
          <strong>rentOS</strong> (en adelante, &quot;rentOS&quot;, &quot;nosotros&quot;) es una
          plataforma de gestión de alojamientos temporales con domicilio en la Ciudad
          de Córdoba, Provincia de Córdoba, República Argentina.
        </p>
        <p>
          Para consultas relacionadas con esta política o el tratamiento de tus
          datos personales, escribinos a{" "}
          <a href="mailto:privacidad@apart-cba.com.ar">privacidad@apart-cba.com.ar</a>.
        </p>
      </Section>

      <Section title="2. Datos que recopilamos">
        <h3 className="font-semibold mt-4">2.1 Datos de huéspedes</h3>
        <ul>
          <li>Nombre y apellido</li>
          <li>Número de teléfono</li>
          <li>Correo electrónico</li>
          <li>Documento de identidad (DNI / pasaporte) cuando es requerido por la regulación local</li>
          <li>Domicilio</li>
          <li>Datos de reserva: fechas, unidad, valor, método de pago</li>
          <li>Historial de comunicación con nuestro equipo</li>
        </ul>

        <h3 className="font-semibold mt-4">2.2 Datos de propietarios</h3>
        <ul>
          <li>Datos de contacto (nombre, teléfono, email)</li>
          <li>Información bancaria para liquidación de rentas</li>
          <li>Identificación tributaria (CUIT / CUIL)</li>
        </ul>

        <h3 className="font-semibold mt-4">2.3 Datos recibidos a través de Instagram y WhatsApp</h3>
        <p>
          Cuando un usuario nos envía un mensaje a través de Instagram Direct o
          WhatsApp Business, rentOS recibe automáticamente:
        </p>
        <ul>
          <li>Identificador de usuario provisto por Meta (IGSID en Instagram, número de teléfono en WhatsApp)</li>
          <li>Nombre de perfil público y foto de perfil (cuando está disponible)</li>
          <li>El contenido del mensaje: texto, imágenes, audios, videos, documentos, ubicaciones, stickers</li>
          <li>Metadatos: fecha y hora del envío, confirmaciones de entrega y lectura</li>
          <li>Identificadores internos asignados por Meta a cada mensaje y conversación</li>
        </ul>
        <p>
          No accedemos a ningún otro dato de tu cuenta de Instagram o WhatsApp más
          allá de lo necesario para responder tu conversación.
        </p>

        <h3 className="font-semibold mt-4">2.4 Datos de uso de la plataforma</h3>
        <ul>
          <li>
            Dirección IP, tipo de dispositivo y navegador (a través de Vercel Analytics
            y Speed Insights, sin identificadores personales)
          </li>
          <li>Páginas visitadas dentro del panel administrativo, cuando sos usuario interno</li>
        </ul>
      </Section>

      <Section title="3. Para qué usamos tus datos">
        <ul>
          <li>
            Gestionar reservas, check-in, check-out, limpieza, mantenimiento y
            servicios complementarios del alojamiento.
          </li>
          <li>
            Responder mensajes y consultas recibidas por Instagram, WhatsApp,
            correo electrónico o teléfono.
          </li>
          <li>
            Emitir comprobantes de pago, recibos y liquidaciones a propietarios.
          </li>
          <li>
            Enviar recordatorios operativos sobre tu reserva (check-in, ubicación,
            instrucciones de acceso, encuesta post-estadía).
          </li>
          <li>
            Cumplir con obligaciones legales argentinas: registro hotelero,
            requerimientos fiscales (AFIP) y normativa de protección de datos
            personales.
          </li>
          <li>
            Mejorar la calidad del servicio mediante análisis interno agregado
            (sin identificar individuos).
          </li>
        </ul>
      </Section>

      <Section title="4. Bases legales del tratamiento">
        <p>
          Tratamos tus datos personales conforme a la Ley 25.326 de Protección de
          Datos Personales de la República Argentina, con las siguientes bases:
        </p>
        <ul>
          <li>
            <strong>Ejecución contractual:</strong> para procesar reservas y
            prestar el servicio de alojamiento.
          </li>
          <li>
            <strong>Consentimiento:</strong> cuando nos contactás vía Instagram o
            WhatsApp, prestás consentimiento implícito a que procesemos esos
            mensajes para responderte. Podés retirar el consentimiento en cualquier
            momento dejando de escribirnos y solicitando la eliminación.
          </li>
          <li>
            <strong>Obligación legal:</strong> retención de registros fiscales y
            de huéspedes según exige la regulación argentina.
          </li>
          <li>
            <strong>Interés legítimo:</strong> seguridad de la plataforma,
            prevención de fraude y mejora del servicio.
          </li>
        </ul>
      </Section>

      <Section title="5. Con quién compartimos tus datos">
        <p>
          rentOS <strong>no vende ni alquila</strong> tus datos personales a
          terceros. Compartimos datos únicamente con:
        </p>
        <ul>
          <li>
            <strong>Proveedores de infraestructura:</strong> Vercel (hosting),
            Supabase (base de datos y autenticación). Los datos están alojados en
            servidores con cifrado en reposo y en tránsito.
          </li>
          <li>
            <strong>Meta Platforms (Instagram y WhatsApp Business):</strong> los
            mensajes intercambiados fluyen a través de la infraestructura de Meta
            conforme a sus propias políticas. No compartimos con Meta datos
            adicionales fuera de lo necesario para entregar o recibir mensajes.
          </li>
          <li>
            <strong>Proveedores de IA conversacional</strong> (cuando está
            activado): el contenido de los mensajes puede ser procesado por
            modelos de lenguaje para sugerir o redactar respuestas. Estos modelos
            operan en modo &quot;zero data retention&quot; y no usan tu contenido
            para entrenar.
          </li>
          <li>
            <strong>Propietarios del inmueble</strong> que reservaste: pueden
            recibir tu nombre, fechas y datos básicos de la reserva para fines de
            liquidación; nunca tu DNI, teléfono ni email a menos que vos lo
            autorices explícitamente.
          </li>
          <li>
            <strong>Autoridades públicas competentes:</strong> cuando un
            requerimiento judicial o regulatorio nos obligue.
          </li>
        </ul>
      </Section>

      <Section title="6. Tiempo de retención">
        <ul>
          <li>
            <strong>Datos de reserva y huésped:</strong> 10 años desde la última
            estadía (plazo de prescripción de obligaciones comerciales en
            Argentina).
          </li>
          <li>
            <strong>Conversaciones de Instagram / WhatsApp:</strong> hasta 2 años
            desde el último mensaje. Pasado ese plazo, se anonimizan o eliminan
            salvo que estén vinculadas a una reserva activa.
          </li>
          <li>
            <strong>Datos contables y fiscales:</strong> 10 años, según exige la
            normativa AFIP.
          </li>
          <li>
            <strong>Logs de la plataforma:</strong> 90 días.
          </li>
        </ul>
      </Section>

      <Section title="7. Tus derechos">
        <p>Como titular de los datos, podés en cualquier momento:</p>
        <ul>
          <li>
            <strong>Acceder</strong> a la información que tenemos sobre vos
          </li>
          <li>
            <strong>Rectificar</strong> datos inexactos o desactualizados
          </li>
          <li>
            <strong>Suprimir</strong> tus datos (con las excepciones legales
            aplicables)
          </li>
          <li>
            <strong>Oponerte</strong> al tratamiento con fines de marketing
          </li>
          <li>
            <strong>Retirar el consentimiento</strong> que diste para recibir
            mensajes automatizados
          </li>
        </ul>
        <p>
          Para ejercer cualquiera de estos derechos, escribinos a{" "}
          <a href="mailto:privacidad@apart-cba.com.ar">privacidad@apart-cba.com.ar</a>{" "}
          desde el correo asociado a tu reserva o mensaje, o seguí las
          instrucciones de la página de{" "}
          <a href="/legal/eliminacion-de-datos">Eliminación de datos</a>.
        </p>
        <p>
          También podés presentar un reclamo ante la <strong>Agencia de Acceso
          a la Información Pública (AAIP)</strong>, autoridad de control de la
          Ley 25.326, en <a href="https://www.argentina.gob.ar/aaip" target="_blank" rel="noopener noreferrer">argentina.gob.ar/aaip</a>.
        </p>
      </Section>

      <Section title="8. Seguridad">
        <p>
          rentOS aplica medidas técnicas y organizativas razonables para
          proteger tus datos: cifrado TLS para las comunicaciones, cifrado en
          reposo de credenciales sensibles en Supabase Vault, control de acceso
          basado en roles, y registros de auditoría de operaciones críticas.
        </p>
        <p>
          Pese a estas medidas, ningún sistema es absolutamente impenetrable. En
          caso de un incidente de seguridad que afecte tus datos personales,
          notificaremos a los afectados y a la AAIP dentro de los plazos exigidos
          por la normativa.
        </p>
      </Section>

      <Section title="9. Menores de edad">
        <p>
          rentOS no presta servicios a menores de 18 años de forma directa. No
          recopilamos intencionalmente datos de menores. Si detectamos datos de
          menores cargados sin consentimiento parental, los eliminamos al ser
          notificados.
        </p>
      </Section>

      <Section title="10. Cambios a esta política">
        <p>
          Podemos actualizar esta política cuando incorporemos nuevos servicios o
          cuando la normativa lo requiera. La fecha de &quot;Última actualización&quot;
          al inicio refleja la versión vigente. Si los cambios son materiales,
          notificaremos a los usuarios activos por los canales disponibles.
        </p>
      </Section>

      <Section title="11. Contacto">
        <p>
          Por consultas sobre esta política, ejercicio de derechos o reportes de
          incidentes:
        </p>
        <p>
          <strong>Email:</strong>{" "}
          <a href="mailto:privacidad@apart-cba.com.ar">privacidad@apart-cba.com.ar</a>
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mt-8 mb-3 border-b border-border pb-2">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
