import type { Metadata } from "next";
import { LegalContactEmail } from "@/components/marketplace/shell/legal-contact";
import { LegalArticle, LegalSection as Section } from "@/components/marketplace/shell/legal-document";

export const metadata: Metadata = {
  title: "Eliminación de datos",
  description:
    "Cómo solicitar la eliminación de tus datos personales recolectados por apart (Apart CBA) a través de Instagram, WhatsApp o el formulario de reservas.",
};

// El mail de contacto sale de la configuración (cacheada 5 min, sin cookies).
export const revalidate = 300;

const UPDATED = "29 de septiembre de 2026";
const SUBJECT = "Solicitud de eliminación de datos";

export default function DataDeletionPage() {
  return (
    <LegalArticle title="Eliminación de datos" updated={UPDATED}>
      <section className="mb-12 rounded-3xl bg-leaf-100 p-5 ring-1 ring-leaf-300 sm:p-7">
        <h2 className="mb-2 text-lg font-bold text-forest-700">Resumen</h2>
        <p className="leading-relaxed text-forest-800">
          Si querés que eliminemos los datos personales que apart (Apart CBA) tiene sobre
          vos (mensajes de Instagram/WhatsApp, datos de contacto, historial de
          reservas), podés solicitarlo enviando un email a <LegalContactEmail subject={SUBJECT} />. Procesamos
          cada solicitud dentro de los <strong>30 días</strong>{" "}
          siguientes a la verificación de tu identidad.
        </p>
      </section>

      <Section title="¿Qué datos elimino al pedir esto?">
        <p>
          Al confirmar tu solicitud, apart eliminará o anonimizará en forma
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
        <p className="mt-3 text-[0.9375rem] text-ink-500">
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
            <strong>Mandanos un email</strong> a <LegalContactEmail subject={SUBJECT} /> con el asunto{" "}
            <em>&quot;{SUBJECT}&quot;</em>.
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
          Si revocás los permisos de apart directamente desde tu configuración
          de Facebook o Instagram (Configuración → Privacidad → Apps y sitios
          web), Meta nos enviará un aviso automático y eliminaremos los datos
          asociados a tu identificador de Meta dentro de los 30 días, sin
          intervención manual de tu parte.
        </p>
        <p className="text-[0.9375rem] text-ink-500">
          Conforme la <em>Meta Platform Policy</em>, apart expone un
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

      <p className="mt-12 text-sm text-ink-500">
        Esta página complementa la{" "}
        <a href="/legal/privacidad">Política de privacidad</a> de apart.
      </p>
    </LegalArticle>
  );
}
