/**
 * Biblioteca de workflows pre-armados que se pueden instalar con un click.
 * Cada template define un grafo (nodes + edges) listo para usar.
 */

import type { CrmWorkflowTriggerType, CrmWorkflowGraph } from "@/lib/types/database";

export interface WorkflowLibraryItem {
  slug: string;
  name: string;
  description: string;
  category: "general" | "bookings" | "ia" | "operacion";
  icon: string; // lucide name
  triggerType: CrmWorkflowTriggerType;
  triggerConfig: Record<string, unknown>;
  graph: CrmWorkflowGraph;
}

const triggerNode = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type: `trigger.${type}`,
  position: { x: 400, y: 100 },
  data: { config },
});

const baseNode = (id: string, type: string, config: Record<string, unknown>, x: number, y: number) => ({
  id,
  type,
  position: { x, y },
  data: { config },
});

export const WORKFLOW_LIBRARY: WorkflowLibraryItem[] = [
  {
    slug: "bienvenida",
    name: "Bienvenida automática",
    description: "Cuando un contacto nuevo escribe por primera vez, se le manda un saludo + info de la propiedad y se etiqueta como 'lead'.",
    category: "general",
    icon: "MessageSquareText",
    triggerType: "message_received",
    triggerConfig: { filters: { fromKind: "lead" } },
    graph: {
      nodes: [
        triggerNode("trg", "message_received", { filters: { fromKind: "lead" } }),
        baseNode("send-greet", "send_message", {
          text: "¡Hola! 👋 Gracias por contactarte con rentOS. ¿En qué fecha querés alojarte? Te respondemos al toque.",
          previewUrl: false,
        }, 400, 240),
        baseNode("tag-lead", "add_tag", { tagSlug: "lead" }, 400, 380),
      ],
      edges: [
        { id: "e1", source: "trg", target: "send-greet" },
        { id: "e2", source: "send-greet", target: "tag-lead" },
      ],
    },
  },

  {
    slug: "checkin-recordatorio-24h",
    name: "Recordatorio check-in 24h antes",
    description: "Al detectar un booking con check-in mañana, manda template 'checkin_recordatorio' con el código de acceso y horario.",
    category: "bookings",
    icon: "Clock",
    triggerType: "pms_event",
    triggerConfig: { pmsEvent: "booking.checkin_tomorrow" },
    graph: {
      nodes: [
        triggerNode("trg", "pms_event", { pmsEvent: "booking.checkin_tomorrow" }),
        baseNode("send-tpl", "send_template", { templateId: "", paramValues: {} }, 400, 240),
        baseNode("alert", "crm_alert", {
          title: "Check-in mañana — recordatorio enviado",
          severity: "info",
          targetRole: "recepcion",
        }, 400, 380),
      ],
      edges: [
        { id: "e1", source: "trg", target: "send-tpl" },
        { id: "e2", source: "send-tpl", target: "alert" },
      ],
    },
  },

  {
    slug: "post-stay-review",
    name: "Post-checkout: pedido de reseña",
    description: "Al hacer checkout, espera 2 horas, manda mensaje pidiendo feedback y agrega tag 'checkout-pendiente-review'.",
    category: "bookings",
    icon: "Sparkles",
    triggerType: "pms_event",
    triggerConfig: { pmsEvent: "booking.checkout_today" },
    graph: {
      nodes: [
        triggerNode("trg", "pms_event", { pmsEvent: "booking.checkout_today" }),
        baseNode("wait", "wait_time", { duration: 2, unit: "hours" }, 400, 240),
        baseNode("send-msg", "send_message", {
          text: "¡Gracias por elegirnos, {{guest_name}}! ¿Cómo te fue la estadía? Tu opinión nos ayuda muchísimo. ⭐⭐⭐⭐⭐",
        }, 400, 380),
      ],
      edges: [
        { id: "e1", source: "trg", target: "wait" },
        { id: "e2", source: "wait", target: "send-msg" },
      ],
    },
  },

  {
    slug: "auto-tag-ia",
    name: "Auto-etiquetado con IA",
    description: "Cada mensaje entrante lo clasifica IA y le asigna las tags adecuadas (lead, incidente, reclamo, spam, etc.).",
    category: "ia",
    icon: "Tags",
    triggerType: "message_received",
    triggerConfig: {},
    graph: {
      nodes: [
        triggerNode("trg", "message_received"),
        baseNode("ai-tag", "ai_auto_tag", {
          model: "claude-sonnet-4-6".split("").join(""),
          candidateTagSlugs: [
            "lead", "consulta-disponibilidad", "reserva-pendiente",
            "incidente", "reclamo", "spam", "checkout-positivo", "checkout-negativo",
          ],
          multi: true,
        }, 400, 240),
      ],
      edges: [
        { id: "e1", source: "trg", target: "ai-tag" },
      ],
    },
  },

  {
    slug: "derivar-fuera-horario",
    name: "Derivar fuera de horario",
    description: "Si entra mensaje fuera de horario laboral, manda mensaje automático y derivar a humano (alerta de recepción).",
    category: "ia",
    icon: "UserCheck",
    triggerType: "message_received",
    triggerConfig: {},
    graph: {
      nodes: [
        triggerNode("trg", "message_received"),
        baseNode("send-msg", "send_message", {
          text: "Recibimos tu mensaje. Nuestro horario es de 9 a 21hs. Te respondemos lo antes posible. ⏰",
        }, 400, 240),
        baseNode("handoff", "ai_handoff_human", { notifyRole: "recepcion", summarizeBefore: false }, 400, 380),
      ],
      edges: [
        { id: "e1", source: "trg", target: "send-msg" },
        { id: "e2", source: "send-msg", target: "handoff" },
      ],
    },
  },

  {
    slug: "ticket-from-incidente",
    name: "Crear ticket de mantenimiento desde incidente",
    description: "Si IA detecta tag 'incidente' en un mensaje, crea automáticamente ticket en mantenimiento y avisa al admin.",
    category: "operacion",
    icon: "Wrench",
    triggerType: "message_received",
    triggerConfig: {},
    graph: {
      nodes: [
        triggerNode("trg", "message_received"),
        baseNode("ai-tag", "ai_auto_tag", {
          model: "claude-sonnet-4-6".split("").join(""),
          candidateTagSlugs: ["incidente", "consulta-disponibilidad", "spam"],
          multi: false,
        }, 400, 240),
        baseNode("cond", "condition", {
          rules: [{ path: "ai_tags", op: "contains", value: "incidente" }],
          joiner: "and",
        }, 400, 380),
        baseNode("create-ticket", "pms_create_ticket", {
          title: "Reporte vía CRM: {{text}}",
          priority: "alta",
          unitFrom: "contact_active_booking",
        }, 250, 520),
        baseNode("alert-admin", "crm_alert", {
          title: "Nuevo ticket creado por IA",
          severity: "warning",
          targetRole: "admin",
        }, 250, 660),
      ],
      edges: [
        { id: "e1", source: "trg", target: "ai-tag" },
        { id: "e2", source: "ai-tag", target: "cond" },
        { id: "e3", source: "cond", target: "create-ticket", sourceHandle: "yes" },
        { id: "e4", source: "create-ticket", target: "alert-admin", sourceHandle: "success" },
      ],
    },
  },
];
