import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Términos y condiciones · rentOS",
  description:
    "Términos y condiciones de uso del servicio de gestión de alojamientos temporales y canales de mensajería de rentOS.",
};

const UPDATED = "11 de mayo de 2026";

export default function TermsPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <h1 className="text-3xl font-bold tracking-tight mb-2">
        Términos y condiciones
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Última actualización: {UPDATED}
      </p>

      <Section title="1. Aceptación de los términos">
        <p>
          Estos Términos y Condiciones (en adelante, los &quot;Términos&quot;) regulan el
          uso del servicio prestado por <strong>rentOS</strong> (en adelante,
          &quot;rentOS&quot;, &quot;nosotros&quot;), incluyendo la plataforma de gestión de
          alojamientos temporales, el sitio web, los canales de mensajería
          (Instagram Direct, WhatsApp Business) y cualquier interacción con
          nuestro equipo.
        </p>
        <p>
          Al reservar una estadía, comunicarte con nosotros por cualquier canal
          o utilizar nuestros servicios, declarás haber leído, comprendido y
          aceptado estos Términos. Si no estás de acuerdo con alguno de los
          puntos, abstenete de usar el servicio.
        </p>
      </Section>

      <Section title="2. Descripción del servicio">
        <p>
          rentOS opera y administra alojamientos temporales (departamentos
          amueblados) en la Ciudad de Córdoba, Argentina, ya sea como
          propietario directo o en representación de propietarios terceros.
          Nuestros servicios incluyen:
        </p>
        <ul>
          <li>Comercialización y gestión de reservas</li>
          <li>Atención al huésped por canales digitales y telefónicos</li>
          <li>Check-in y check-out</li>
          <li>Limpieza, mantenimiento y reposición de amenities</li>
          <li>Cobro de tarifas, depósitos y servicios adicionales</li>
          <li>Liquidación a propietarios</li>
        </ul>
        <p>
          rentOS no es una agencia de viajes registrada. La relación
          contractual de hospedaje se establece entre el huésped y el operador
          (rentOS o el propietario representado, según el caso), conforme la
          documentación que se emita para cada reserva.
        </p>
      </Section>

      <Section title="3. Proceso de reserva">
        <h3 className="font-semibold mt-4">3.1 Cotización</h3>
        <p>
          Las tarifas se cotizan en pesos argentinos (ARS) o dólares
          estadounidenses (USD), según se indique en cada caso. Las cotizaciones
          son válidas hasta la confirmación de la reserva con el pago
          correspondiente, salvo modificaciones por variaciones cambiarias o de
          disponibilidad.
        </p>

        <h3 className="font-semibold mt-4">3.2 Confirmación</h3>
        <p>
          La reserva queda confirmada cuando: (i) rentOS acuse recibo del
          pago de la seña requerida, (ii) el huésped haya provisto los datos
          personales mínimos (nombre, DNI/pasaporte, teléfono, email) y (iii)
          rentOS emita la confirmación por escrito (email o WhatsApp). Antes
          de los tres pasos completos, no existe reserva.
        </p>

        <h3 className="font-semibold mt-4">3.3 Capacidad máxima</h3>
        <p>
          Cada unidad tiene una capacidad máxima publicada. El alojamiento de
          personas que excedan dicha capacidad sin autorización previa puede
          ser causal de cancelación inmediata sin reembolso.
        </p>
      </Section>

      <Section title="4. Pagos">
        <ul>
          <li>
            <strong>Seña:</strong> al confirmar la reserva, el huésped abona una
            seña no inferior al 30% del total. El saldo se cancela al ingreso o
            según las condiciones particulares acordadas.
          </li>
          <li>
            <strong>Métodos:</strong> aceptamos transferencia bancaria, Mercado
            Pago, tarjeta de crédito/débito, criptomonedas o efectivo, según
            disponibilidad por unidad.
          </li>
          <li>
            <strong>Depósito de garantía:</strong> según el tipo de unidad y
            duración, podemos solicitar un depósito de garantía reembolsable al
            check-out, descontando eventuales daños o consumos pendientes.
          </li>
          <li>
            <strong>Facturación:</strong> rentOS emite el comprobante fiscal
            correspondiente (factura A, B o C según condición frente a IVA del
            huésped). Es obligación del huésped suministrar datos fiscales
            correctos.
          </li>
        </ul>
      </Section>

      <Section title="5. Cancelaciones y reembolsos">
        <p>
          Salvo políticas particulares aclaradas al momento de la reserva, la
          política general es:
        </p>
        <ul>
          <li>
            <strong>Cancelación a más de 30 días de la fecha de ingreso:</strong>{" "}
            reembolso del 100% de la seña.
          </li>
          <li>
            <strong>Entre 30 y 15 días antes:</strong> reembolso del 50%.
          </li>
          <li>
            <strong>Menos de 15 días antes o no presentación:</strong> sin
            reembolso.
          </li>
          <li>
            <strong>Cancelación por rentOS:</strong> si por causas
            imputables a nosotros no podemos prestar el servicio, devolvemos el
            100% de lo abonado o reubicamos en una unidad equivalente.
          </li>
        </ul>
      </Section>

      <Section title="6. Conducta esperada del huésped">
        <p>El huésped se compromete a:</p>
        <ul>
          <li>Usar la unidad con diligencia, cuidando muebles y equipamiento.</li>
          <li>
            Respetar el reglamento interno del edificio: horarios de silencio,
            uso de espacios comunes, prohibición de fiestas o ruidos molestos.
          </li>
          <li>
            No subarrendar, prestar ni utilizar la unidad para fines distintos
            al alojamiento personal/turístico.
          </li>
          <li>
            Informar de inmediato cualquier desperfecto o incidente para que
            podamos asistirlo.
          </li>
          <li>
            Devolver la unidad al check-out en condiciones razonables. Los
            daños que excedan el uso normal serán descontados del depósito de
            garantía o facturados.
          </li>
        </ul>
        <p>
          El incumplimiento grave o reiterado del reglamento autoriza a Apart
          Cba a finalizar la estadía anticipadamente, sin obligación de
          reembolso.
        </p>
      </Section>

      <Section title="7. Limitación de responsabilidad">
        <p>
          rentOS se compromete a actuar con diligencia profesional en la
          prestación de sus servicios. Sin embargo, no será responsable por:
        </p>
        <ul>
          <li>
            Daños o pérdidas de objetos personales del huésped dentro de la
            unidad, excepto por dolo o culpa grave demostrada.
          </li>
          <li>
            Interrupciones temporales de servicios (luz, agua, gas, internet)
            causadas por terceros (empresas prestadoras, fuerza mayor, eventos
            climáticos).
          </li>
          <li>
            Hechos de fuerza mayor o caso fortuito que impidan o limiten el
            uso de la unidad.
          </li>
          <li>
            Daños indirectos, consecuentes o lucro cesante.
          </li>
        </ul>
        <p>
          En todos los casos, la responsabilidad máxima de rentOS frente al
          huésped queda limitada al monto efectivamente abonado por la reserva
          objeto de reclamo.
        </p>
      </Section>

      <Section title="8. Uso de los canales de mensajería">
        <p>
          rentOS ofrece atención por Instagram Direct y WhatsApp Business.
          Al iniciar una conversación con nosotros por estos canales:
        </p>
        <ul>
          <li>
            Aceptás recibir respuestas, recordatorios operativos y
            comunicaciones relacionadas con tu reserva o consulta.
          </li>
          <li>
            Reconocés que las conversaciones pueden ser asistidas por
            herramientas de inteligencia artificial para sugerir o redactar
            respuestas, supervisadas por personal humano.
          </li>
          <li>
            Podés solicitar en cualquier momento dejar de recibir mensajes
            automáticos enviándonos &quot;BAJA&quot; o &quot;STOP&quot;.
          </li>
          <li>
            Los datos compartidos por estos canales son tratados conforme a
            nuestra{" "}
            <a href="/legal/privacidad">Política de privacidad</a> y podés
            ejercer derechos siguiendo las{" "}
            <a href="/legal/eliminacion-de-datos">
              instrucciones de eliminación de datos
            </a>
            .
          </li>
        </ul>
      </Section>

      <Section title="9. Propiedad intelectual">
        <p>
          Todos los contenidos del sitio web y los canales digitales de Apart
          Cba (textos, fotografías, marcas, logos, código fuente, diseño) son
          propiedad de rentOS o de los propietarios que representamos, y
          están protegidos por la Ley 11.723 de Propiedad Intelectual. Queda
          prohibida su reproducción total o parcial sin autorización escrita.
        </p>
      </Section>

      <Section title="10. Modificaciones a estos Términos">
        <p>
          rentOS se reserva el derecho de modificar estos Términos en
          cualquier momento. La versión vigente es siempre la publicada en
          esta página, con la fecha de &quot;Última actualización&quot; indicada arriba.
          Para reservas ya confirmadas regirán los Términos vigentes al momento
          de la confirmación.
        </p>
      </Section>

      <Section title="11. Ley aplicable y jurisdicción">
        <p>
          Estos Términos se rigen por las leyes de la República Argentina. Para
          cualquier controversia derivada de la prestación del servicio, las
          partes se someten a la jurisdicción de los Tribunales Ordinarios de
          la Ciudad de Córdoba, Provincia de Córdoba, con renuncia expresa a
          cualquier otro fuero que pudiera corresponder.
        </p>
        <p>
          En materia de defensa del consumidor, son aplicables la Ley 24.240 y
          sus modificatorias. El huésped consumidor puede iniciar reclamos ante
          la Dirección de Defensa del Consumidor de la Provincia de Córdoba o
          la autoridad nacional competente.
        </p>
      </Section>

      <Section title="12. Contacto">
        <p>
          Para consultas sobre estos Términos:
        </p>
        <p>
          <strong>rentOS</strong>
          <br />
          Email:{" "}
          <a href="mailto:contacto@apart-cba.com.ar">contacto@apart-cba.com.ar</a>
        </p>
      </Section>
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
