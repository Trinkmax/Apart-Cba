/**
 * Nodos PMS-specific de Apart-Cba. Operaciones sobre tablas existentes
 * (bookings, tickets, cleaning, concierge, units, guests).
 */

import { z } from "zod";
import { defineNode } from "../../types";
import { renderTemplate, type VarsMap } from "../../../render-vars";

export const pmsCreateTicket = defineNode({
  type: "pms_create_ticket",
  category: "pms",
  label: "Crear ticket mantenimiento",
  description: "Genera un ticket de mantenimiento en la unidad asociada.",
  icon: "Wrench",
  accentColor: "blue",
  configSchema: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
    unitFrom: z.enum(["contact_active_booking", "fixed"]).default("contact_active_booking"),
    unitId: z.string().uuid().optional(),
    billableTo: z.enum(["owner", "apartcba", "guest"]).optional(),
  }),
  defaultConfig: {
    title: "Reporte vía CRM: {{text}}",
    priority: "media",
    unitFrom: "contact_active_booking",
  },
  outputs: [{ id: "success" }, { id: "error", label: "Error" }],
  execute: async (ctx, config) => {
    let unitId = config.unitId;
    if (config.unitFrom === "contact_active_booking" && ctx.contactId) {
      const { data: contact } = await ctx.admin
        .from("crm_contacts")
        .select("guest_id")
        .eq("id", ctx.contactId)
        .single();
      if (contact?.guest_id) {
        const { data: booking } = await ctx.admin
          .from("bookings")
          .select("unit_id")
          .eq("guest_id", contact.guest_id)
          .eq("organization_id", ctx.organizationId)
          .in("status", ["confirmada", "check_in"])
          .order("check_in", { ascending: false })
          .limit(1)
          .maybeSingle();
        unitId = booking?.unit_id ?? unitId;
      }
    }
    if (!unitId) return { kind: "branch", outputId: "error", output: { error: "no_unit_resolved" } };

    const { data: ticket, error } = await ctx.admin
      .from("maintenance_tickets")
      .insert({
        organization_id: ctx.organizationId,
        unit_id: unitId,
        title: renderTemplate(config.title, ctx.variables as VarsMap),
        description: config.description ? renderTemplate(config.description, ctx.variables as VarsMap) : null,
        priority: config.priority,
        status: "abierto",
        billable_to: config.billableTo ?? "apartcba",
      })
      .select("id")
      .single();

    if (error) return { kind: "branch", outputId: "error", output: { error: error.message } };
    return { kind: "branch", outputId: "success", output: { ticket_id: ticket.id } };
  },
});

export const pmsAssignCleaning = defineNode({
  type: "pms_assign_cleaning",
  category: "pms",
  label: "Asignar limpieza",
  description: "Crea una tarea de limpieza para una unidad.",
  icon: "Sparkles",
  accentColor: "blue",
  configSchema: z.object({
    unitFrom: z.enum(["contact_active_booking", "fixed"]).default("fixed"),
    unitId: z.string().uuid().optional(),
    scheduledAt: z.string().optional(), // ISO date
    notes: z.string().optional(),
  }),
  defaultConfig: { unitFrom: "fixed" },
  outputs: [{ id: "success" }, { id: "error" }],
  execute: async (ctx, config) => {
    let unitId = config.unitId;
    if (config.unitFrom === "contact_active_booking" && ctx.contactId) {
      const { data: contact } = await ctx.admin
        .from("crm_contacts")
        .select("guest_id")
        .eq("id", ctx.contactId)
        .single();
      if (contact?.guest_id) {
        const { data: booking } = await ctx.admin
          .from("bookings")
          .select("unit_id")
          .eq("guest_id", contact.guest_id)
          .order("check_out", { ascending: false })
          .limit(1)
          .maybeSingle();
        unitId = booking?.unit_id ?? unitId;
      }
    }
    if (!unitId) return { kind: "branch", outputId: "error", output: { error: "no_unit_resolved" } };

    const { data: task, error } = await ctx.admin
      .from("cleaning_tasks")
      .insert({
        organization_id: ctx.organizationId,
        unit_id: unitId,
        scheduled_at: config.scheduledAt ?? new Date().toISOString(),
        status: "pendiente",
        notes: config.notes ? renderTemplate(config.notes, ctx.variables as VarsMap) : null,
      })
      .select("id")
      .single();
    if (error) return { kind: "branch", outputId: "error", output: { error: error.message } };
    return { kind: "branch", outputId: "success", output: { cleaning_task_id: task.id } };
  },
});

export const pmsAddGuestNote = defineNode({
  type: "pms_add_guest_note",
  category: "pms",
  label: "Agregar nota a guest",
  description: "Anota algo en el guest asociado al contacto.",
  icon: "StickyNote",
  accentColor: "blue",
  configSchema: z.object({
    note: z.string().min(1),
  }),
  defaultConfig: { note: "Nota desde CRM: {{text}}" },
  outputs: [{ id: "success" }, { id: "error" }],
  execute: async (ctx, config) => {
    if (!ctx.contactId) return { kind: "branch", outputId: "error", output: { error: "no_contact" } };
    const { data: contact } = await ctx.admin
      .from("crm_contacts")
      .select("guest_id")
      .eq("id", ctx.contactId)
      .single();
    if (!contact?.guest_id) return { kind: "branch", outputId: "error", output: { error: "contact_not_linked_to_guest" } };

    const note = renderTemplate(config.note, ctx.variables as VarsMap);
    const { error } = await ctx.admin
      .from("guests")
      .update({ notes: note })
      .eq("id", contact.guest_id);
    if (error) return { kind: "branch", outputId: "error", output: { error: error.message } };
    return { kind: "branch", outputId: "success" };
  },
});

export const pmsCreateConcierge = defineNode({
  type: "pms_create_concierge",
  category: "pms",
  label: "Crear pedido conserjería",
  description: "Genera un concierge_request a partir del mensaje.",
  icon: "ListTodo",
  accentColor: "blue",
  configSchema: z.object({
    title: z.string().min(1),
    requestType: z.string().default("otro"),
    priority: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
    chargeToGuest: z.boolean().default(false),
  }),
  defaultConfig: { title: "Pedido vía CRM: {{text}}", requestType: "otro", priority: "media", chargeToGuest: false },
  outputs: [{ id: "success" }, { id: "error" }],
  execute: async (ctx, config) => {
    if (!ctx.contactId) return { kind: "branch", outputId: "error", output: { error: "no_contact" } };
    const { data: contact } = await ctx.admin
      .from("crm_contacts")
      .select("guest_id")
      .eq("id", ctx.contactId)
      .single();
    const guestId = contact?.guest_id;

    const { data: req, error } = await ctx.admin
      .from("concierge_requests")
      .insert({
        organization_id: ctx.organizationId,
        guest_id: guestId,
        request_type: config.requestType,
        title: renderTemplate(config.title, ctx.variables as VarsMap),
        priority: config.priority,
        status: "pendiente",
        charge_to_guest: config.chargeToGuest,
      })
      .select("id")
      .single();
    if (error) return { kind: "branch", outputId: "error", output: { error: error.message } };
    return { kind: "branch", outputId: "success", output: { concierge_request_id: req.id } };
  },
});

export const pmsChangeUnitStatus = defineNode({
  type: "pms_change_unit_status",
  category: "pms",
  label: "Cambiar status de unidad",
  description: "Marca una unidad como bloqueada / mantenimiento / limpieza.",
  icon: "Building2",
  accentColor: "blue",
  configSchema: z.object({
    unitId: z.string().uuid(),
    status: z.enum(["disponible", "reservado", "ocupado", "limpieza", "mantenimiento", "bloqueado"]),
    reason: z.string().optional(),
  }),
  defaultConfig: { unitId: "", status: "mantenimiento" },
  outputs: [{ id: "success" }, { id: "error" }],
  execute: async (ctx, config) => {
    const { error } = await ctx.admin
      .from("units")
      .update({ status: config.status })
      .eq("id", config.unitId)
      .eq("organization_id", ctx.organizationId);
    if (error) return { kind: "branch", outputId: "error", output: { error: error.message } };
    return { kind: "branch", outputId: "success" };
  },
});

export const pmsLinkToBooking = defineNode({
  type: "pms_link_to_booking",
  category: "pms",
  label: "Asociar a booking",
  description: "Asocia el contacto al guest de un booking activo (lookup por phone).",
  icon: "Link",
  accentColor: "blue",
  configSchema: z.object({
    strategy: z.enum(["phone_match", "fixed"]).default("phone_match"),
    bookingId: z.string().uuid().optional(),
  }),
  defaultConfig: { strategy: "phone_match" },
  outputs: [{ id: "linked" }, { id: "not_found" }],
  execute: async (ctx, config) => {
    if (!ctx.contactId) return { kind: "branch", outputId: "not_found" };

    if (config.strategy === "fixed" && config.bookingId) {
      const { data: booking } = await ctx.admin
        .from("bookings")
        .select("guest_id")
        .eq("id", config.bookingId)
        .single();
      if (!booking?.guest_id) return { kind: "branch", outputId: "not_found" };
      await ctx.admin
        .from("crm_contacts")
        .update({ guest_id: booking.guest_id, contact_kind: "guest" })
        .eq("id", ctx.contactId);
      return { kind: "branch", outputId: "linked", output: { booking_id: config.bookingId } };
    }

    // phone_match
    const { data: contact } = await ctx.admin
      .from("crm_contacts")
      .select("phone")
      .eq("id", ctx.contactId)
      .single();
    if (!contact?.phone) return { kind: "branch", outputId: "not_found" };

    const { data: guest } = await ctx.admin
      .from("guests")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("phone", contact.phone)
      .maybeSingle();
    if (!guest) return { kind: "branch", outputId: "not_found" };

    await ctx.admin
      .from("crm_contacts")
      .update({ guest_id: guest.id, contact_kind: "guest" })
      .eq("id", ctx.contactId);
    return { kind: "branch", outputId: "linked", output: { guest_id: guest.id } };
  },
});
