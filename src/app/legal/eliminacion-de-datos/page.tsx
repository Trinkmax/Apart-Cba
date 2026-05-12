import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Eliminación de datos · rentOS",
  description:
    "Cómo solicitar la eliminación de tus datos personales recolectados por rentOS a través de Instagram, WhatsApp o el formulario de reservas.",
};

const UPDATED = "11 de mayo de 2026";

export default function DataDeletionPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <h1 className="text-3xl font-bold tracking-tight mb-2">
        Eliminación de datos
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Última actualización: {UPDATED}
      </p>

      <section className="mb-8 rounded-lg border border-border bg-muted/30 p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-2">Resumen</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Si querés que eliminemos los datos personales que rentOS tiene sobre
          vos (mensajes de Instagram/WhatsApp, datos de contacto, historial de
          reservas), podés solicitarlo enviando un email a{" "}
          <a
            href="mailto:privacidad@apart-cba.com.ar?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos"
            className="font-medium"
          >
            privacidad@apart-cba.com.ar
          </a>
          . Procesamos cada solicitud dentro de los <strong>30 días</strong>{" "}
          siguientes a la verificación de tu identidad.
        </p>
      </section>

      <Section title="¿Qué datos elimino al pedir esto?">
        <p>
          Al confirmar tu solicitud, rentOS eliminará o anonimizará en forma
          permanente:
        </p>
        <ul>
          <li>
            Tu nombre, apellido, teléfono, email y documento (cuando no
            estuvieran sujetos a obligaciones legales de retención).
          </li>
          <li>
            El contenido completo de las conversaciones que mantuviste con
            nosotros por Instagram Direct o WhatsApp Business.
          </li>
          <li>
            Tu identificador interno de Instagram (IGSID) o número de WhatsApp,
            junto con el vínculo entre ese identificador y tu perfil de huésped.
          </li>
          <li>
            Eventos derivados (alertas, recordatorios automáticos, tareas
            generadas a partir de tus mensajes).
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          <strong>Excepción:</strong> los datos contables, fiscales y de reserva
          asociados a estadías que ya ocurrieron deben retenerse 10 años por
          obligación legal (AFIP, Ley 25.326). Sobre esos registros aplicamos
          <em> anonimización</em> en lugar de eliminación total — quitamos
          identificadores directos pero conservamos el dato agregado.
        </p>
      </Section>

      <Section title="Pasos para solicitar la eliminación">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>Mandanos un email</strong> a{" "}
            <a href="mailto:privacidad@apart-cba.com.ar?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos">
              privacidad@apart-cba.com.ar
            </a>{" "}
            con el asunto <em>&quot;Solicitud de eliminación de datos&quot;</em>.
          </li>
          <li>
            <strong>Incluí en el cuerpo</strong>:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Tu nombre completo (tal como figura en la reserva o perfil).</li>
              <li>
                El canal por el que nos contactaste: Instagram (handle{" "}
                <code>@</code>), WhatsApp (número), email o reserva.
              </li>
              <li>
                (Opcional) Un detalle de qué datos específicos querés eliminar,
                si no querés que borremos todo.
              </li>
            </ul>
          </li>
          <li>
            <strong>Verificamos tu identidad.</strong> Para evitar que un tercero
            elimine tus datos sin tu permiso, podemos pedirte responder a un
            email/mensaje de confirmación desde la misma cuenta que usaste
            originalmente.
          </li>
          <li>
            <strong>Procesamos la solicitud</strong> dentro de los 30 días
            siguientes. Te confirmamos por email cuando se completó.
          </li>
        </ol>
      </Section>

      <Section title="Eliminación automática desde Instagram / Facebook">
        <p>
          Si revocás los permisos de rentOS directamente desde tu configuración
          de Facebook o Instagram (Configuración → Privacidad → Apps y sitios
          web), Meta nos enviará un aviso automático y eliminaremos los datos
          asociados a tu identificador de Meta dentro de los 30 días, sin
          intervención manual de tu parte.
        </p>
        <p className="text-sm text-muted-foreground">
          Conforme la <em>Meta Platform Policy</em>, rentOS expone un
          endpoint de callback que recibe estas notificaciones de revocación,
          inicia el proceso de eliminación y devuelve un código de seguimiento.
        </p>
      </Section>

      <Section title="Plazo de procesamiento">
        <p>
          Por norma respondemos dentro de los <strong>30 días corridos</strong>{" "}
          desde la verificación de identidad. La eliminación efectiva en
          backups y logs puede demorar hasta <strong>90 días</strong> adicionales
          mientras se purgan los backups rotacionales.
        </p>
      </Section>

      <Section title="¿Y si quiero algo distinto a la eliminación?">
        <p>
          También podés solicitarnos:
        </p>
        <ul>
          <li>
            <strong>Acceso</strong> a una copia de los datos personales que
            tenemos sobre vos.
          </li>
          <li>
            <strong>Rectificación</strong> de información incorrecta o
            desactualizada.
          </li>
          <li>
            <strong>Limitación</strong> del tratamiento (ej. dejar de recibir
            mensajes automatizados sin eliminar el historial).
          </li>
          <li>
            <strong>Portabilidad</strong>: te entregamos tus datos en un formato
            estructurado (JSON) para que los lleves a otro servicio.
          </li>
        </ul>
        <p>
          Para cualquiera de estas opciones, escribinos al mismo correo y
          aclarando en el asunto qué necesitás.
        </p>
      </Section>

      <Section title="Si no recibís respuesta">
        <p>
          Si pasaron 30 días desde tu solicitud y no obtuviste respuesta, podés
          presentar un reclamo ante la <strong>Agencia de Acceso a la
          Información Pública (AAIP)</strong>, autoridad de control argentina:
        </p>
        <ul>
          <li>
            Sitio web:{" "}
            <a
              href="https://www.argentina.gob.ar/aaip/datospersonales/reclama"
              target="_blank"
              rel="noopener noreferrer"
            >
              argentina.gob.ar/aaip/datospersonales/reclama
            </a>
          </li>
          <li>Email: datospersonales@aaip.gob.ar</li>
        </ul>
      </Section>

      <p className="mt-12 text-xs text-muted-foreground">
        Esta página complementa la{" "}
        <a href="/legal/privacidad">Política de privacidad</a> de rentOS.
      </p>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mt-8 mb-3 border-b border-border pb-2">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
