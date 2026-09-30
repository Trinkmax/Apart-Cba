import type { Metadata } from "next";
import { LegalContactEmail } from "@/components/marketplace/shell/legal-contact";
import { LegalArticle, LegalSection as Section } from "@/components/marketplace/shell/legal-document";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description:
    "Términos y condiciones de uso del servicio de gestión de alojamientos temporales y canales de mensajería de apart (Apart CBA).",
};

// El mail de contacto sale de la configuración (cacheada 5 min, sin cookies).
export const revalidate = 300;

const UPDATED = "29 de septiembre de 2026";

export default function TermsPage() {
  return (
    <LegalArticle title="Términos y condiciones" updated={UPDATED}>
      <Section title="1. Aceptación de los términos">
        <p>
          Estos Términos y Condiciones (en adelante, los &quot;Términos&quot;) regulan el
          uso del servicio prestado por <strong>apart (Apart CBA)</strong> (en adelante,
          &quot;apart&quot;, &quot;nosotros&quot;), incluyendo la plataforma de gestión de
          alojamientos temporales, el sitio web, los canales de mensajería
          (Instagram Direct, WhatsApp Business) y cualquier interacción con
          nuestro equipo.
        </p>
        <p>
          Al pedir o reservar una estadía, comunicarte con nosotros por
          cualquier canal o utilizar nuestros servicios, declarás haber leído,
          comprendido y aceptado estos Términos. Si no estás de acuerdo con
          alguno de los puntos, abstenete de usar el servicio.
        </p>
      </Section>

      <Section title="2. Descripción del servicio">
        <p>
          apart opera y administra alojamientos temporales (departamentos
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
          apart no es una agencia de viajes registrada. La relación
          contractual de hospedaje se establece entre el huésped y el operador
          (apart o el propietario representado, según el caso), conforme la
          documentación que se emita para cada reserva.
        </p>
      </Section>

      <Section title="3. Proceso de reserva">
        <h3 className="font-semibold mt-4">3.1 Pedido y precio</h3>
        <p>
          Desde la web pedís tus fechas sin pagar nada. Las tarifas se expresan
          en pesos argentinos (ARS), salvo que se indique otra moneda, y el
          detalle que ves al pedir (noches, limpieza y total) es el que se
          confirma, salvo error evidente o que cambien las fechas o la cantidad
          de huéspedes.
        </p>

        <h3 className="font-semibold mt-4">3.2 Confirmación</h3>
        <p>
          Tu pedido queda confirmado cuando te lo confirmamos por WhatsApp o
          por mail; en los alojamientos con reserva inmediata, al enviarlo. Te
          respondemos dentro del plazo que indica la web, y si no llegamos a
          confirmarlo a tiempo, el pedido vence solo, sin ningún costo.
        </p>
        <p>
          Para asegurar tus fechas transferís la seña que te indicamos, dentro
          del plazo informado. Si la seña no se acredita a tiempo, las fechas
          pueden liberarse; si necesitás más tiempo, escribinos.
        </p>

        <h3 className="font-semibold mt-4">3.3 Estadías por mes</h3>
        <p>
          Las estadías de 28 noches o más no se piden por la web: se consultan
          con el equipo, que te pasa el precio final, el contrato y la forma de
          pago de cada caso.
        </p>

        <h3 className="font-semibold mt-4">3.4 Capacidad máxima</h3>
        <p>
          Cada unidad tiene una capacidad máxima publicada. El alojamiento de
          personas que excedan dicha capacidad sin autorización previa puede
          ser causal de cancelación inmediata sin reembolso.
        </p>
      </Section>

      <Section title="4. Pagos">
        <ul>
          <li>
            <strong>Seña:</strong> el monto de la seña y el plazo para
            transferirla figuran en el link de tu reserva y en el mail de
            confirmación. La seña se descuenta del total de la estadía.
          </li>
          <li>
            <strong>Saldo:</strong> el resto se paga al llegar, en efectivo o
            por transferencia, salvo que acordemos otra cosa.
          </li>
          <li>
            <strong>Métodos:</strong> la seña se paga por transferencia
            bancaria a la cuenta que figura en el link de tu reserva. La web no
            cobra online ni te va a pedir datos de tarjetas.
          </li>
          <li>
            <strong>Depósito de garantía:</strong> según el tipo de unidad y
            duración, podemos solicitar un depósito de garantía reembolsable al
            check-out, descontando eventuales daños o consumos pendientes.
          </li>
          <li>
            <strong>Facturación:</strong> apart emite el comprobante fiscal
            correspondiente (factura A, B o C según condición frente a IVA del
            huésped). Es obligación del huésped suministrar datos fiscales
            correctos.
          </li>
        </ul>
      </Section>

      <Section title="5. Cancelaciones y reembolsos">
        <ul>
          <li>
            <strong>Pedido pendiente:</strong> mientras no te lo confirmamos,
            lo cancelás sin costo desde el link de tu reserva.
          </li>
          <li>
            <strong>Reserva confirmada:</strong> rige la política de
            cancelación de cada alojamiento, que ves en su ficha, al pedir y en
            el link de tu reserva. Para cancelar, escribinos.
          </li>
          <li>
            <strong>Cancelación por apart:</strong> si por causas
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
          apart se compromete a actuar con diligencia profesional en la
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
          En todos los casos, la responsabilidad máxima de apart frente al
          huésped queda limitada al monto efectivamente abonado por la reserva
          objeto de reclamo.
        </p>
      </Section>

      <Section title="8. Uso de los canales de mensajería">
        <p>
          Si iniciás una conversación con nosotros por Instagram Direct o
          WhatsApp:
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
          propiedad de apart o de los propietarios que representamos, y
          están protegidos por la Ley 11.723 de Propiedad Intelectual. Queda
          prohibida su reproducción total o parcial sin autorización escrita.
        </p>
      </Section>

      <Section title="10. Modificaciones a estos Términos">
        <p>
          apart se reserva el derecho de modificar estos Términos en
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
          <strong>apart (Apart CBA)</strong>
          <br />
          Email: <LegalContactEmail subject="Consulta sobre los términos" />
        </p>
      </Section>
    </LegalArticle>
  );
}
