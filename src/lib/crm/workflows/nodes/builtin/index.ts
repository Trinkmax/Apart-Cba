/**
 * Built-in nodes del workflow engine.
 * Categorías: trigger | messages | logic | ai | actions
 */

import { z } from "zod";
import { defineNode } from "../../types";
import { renderTemplate, type VarsMap } from "../../../render-vars";
import { sendMessageNow } from "../../../message-sender";
import { getAIClientForOrg } from "../../../ai/factory";
import { trackAIUsage, assertAIBudget } from "../../../ai/usage";

// ─── TRIGGERS ──────────────────────────────────────────────────────────────

export const triggerMessageReceived = defineNode({
  type: "trigger.message_received",
  category: "trigger",
  label: "Mensaje recibido",
  description: "Se dispara cuando llega un mensaje de un contacto.",
  icon: "MessageSquareText",
  accentColor: "zinc",
  isTrigger: true,
  configSchema: z.object({
    filters: z.object({
      keywords: z.array(z.string()).optional(),
      channels: z.array(z.string()).optional(),
      fromKind: z.enum(["lead", "guest", "owner", "any"]).optional(),
      firstMessageOnly: z.boolean().optional(),
    }).optional(),
  }),
  defaultConfig: { filters: { fromKind: "any" } },
  outputs: [{ id: "next" }],
  execute: async () => ({ kind: "next" }),
});

export const triggerConversationClosed = defineNode({
  type: "trigger.conversation_closed",
  category: "trigger",
  label: "Conversación cerrada",
  description: "Se dispara al cerrarse una conversación (auto 24h o manual).",
  icon: "MessageCircleOff",
  accentColor: "zinc",
  isTrigger: true,
  configSchema: z.object({
    reason: z.enum(["any", "auto_24h", "manual", "workflow"]).default("any"),
  }),
  defaultConfig: { reason: "any" },
  outputs: [{ id: "next" }],
  execute: async () => ({ kind: "next" }),
});

export const triggerPmsEvent = defineNode({
  type: "trigger.pms_event",
  category: "trigger",
  label: "Evento PMS",
  description: "Booking, ticket, cleaning, payment events.",
  icon: "Building2",
  accentColor: "zinc",
  isTrigger: true,
  configSchema: z.object({
    pmsEvent: z.enum([
      "booking.created", "booking.confirmed", "booking.cancelled",
      "booking.checkin_today", "booking.checkout_today",
      "booking.checkin_tomorrow", "booking.checkout_tomorrow",
      "ticket.created", "ticket.closed",
      "cleaning.assigned", "cleaning.completed",
      "payment.received", "payment.overdue",
      "concierge.created",
    ]),
  }),
  defaultConfig: { pmsEvent: "booking.created" },
  outputs: [{ id: "next" }],
  execute: async () => ({ kind: "next" }),
});

export const triggerScheduled = defineNode({
  type: "trigger.scheduled",
  category: "trigger",
  label: "Programado (cron)",
  description: "Se dispara según una expresión cron.",
  icon: "Clock",
  accentColor: "zinc",
  isTrigger: true,
  configSchema: z.object({
    cronExpression: z.string().default("0 9 * * *"),
    timezone: z.string().default("America/Argentina/Cordoba"),
  }),
  defaultConfig: { cronExpression: "0 9 * * *", timezone: "America/Argentina/Cordoba" },
  outputs: [{ id: "next" }],
  execute: async () => ({ kind: "next" }),
});

export const triggerManual = defineNode({
  type: "trigger.manual",
  category: "trigger",
  label: "Manual desde chat",
  description: "Botón 'Ejecutar' dentro de una conversación.",
  icon: "PlayCircle",
  accentColor: "zinc",
  isTrigger: true,
  configSchema: z.object({}),
  defaultConfig: {},
  outputs: [{ id: "next" }],
  execute: async () => ({ kind: "next" }),
});

// ─── MENSAJES ──────────────────────────────────────────────────────────────

export const sendMessage = defineNode({
  type: "send_message",
  category: "messages",
  label: "Enviar mensaje",
  description: "Texto libre con soporte de variables {{guest_name}}.",
  icon: "MessageSquare",
  accentColor: "green",
  configSchema: z.object({
    text: z.string().min(1),
    previewUrl: z.boolean().optional(),
  }),
  defaultConfig: { text: "Hola {{contact.name|amig@}}!", previewUrl: false },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId || !ctx.contactId || !ctx.channelId) {
      return { kind: "error", error: "send_message requires conversation context" };
    }
    const text = renderTemplate(config.text, ctx.variables as VarsMap);
    await sendMessageNow({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      channelId: ctx.channelId,
      body: { type: "text", text, previewUrl: config.previewUrl },
      senderKind: "workflow",
      workflowRunId: ctx.runId,
    });
    return { kind: "next" };
  },
});

export const sendMedia = defineNode({
  type: "send_media",
  category: "messages",
  label: "Enviar multimedia",
  description: "Imagen, audio, video, documento o sticker.",
  icon: "Image",
  accentColor: "green",
  configSchema: z.object({
    kind: z.enum(["image", "audio", "video", "document", "sticker"]),
    mediaUrl: z.string().url(),
    caption: z.string().optional(),
    filename: z.string().optional(),
  }),
  defaultConfig: { kind: "image", mediaUrl: "" },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId || !ctx.contactId || !ctx.channelId) {
      return { kind: "error", error: "send_media requires conversation context" };
    }
    const caption = config.caption ? renderTemplate(config.caption, ctx.variables as VarsMap) : undefined;
    await sendMessageNow({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      channelId: ctx.channelId,
      body: { type: config.kind, mediaUrl: config.mediaUrl, caption, filename: config.filename },
      senderKind: "workflow",
      workflowRunId: ctx.runId,
    });
    return { kind: "next" };
  },
});

export const sendButtons = defineNode({
  type: "send_buttons",
  category: "messages",
  label: "Enviar botones",
  description: "Mensaje interactivo con hasta 3 botones de respuesta.",
  icon: "Square",
  accentColor: "green",
  configSchema: z.object({
    bodyText: z.string().min(1),
    headerText: z.string().optional(),
    footerText: z.string().optional(),
    buttons: z.array(z.object({ id: z.string(), title: z.string().max(20) })).min(1).max(3),
  }),
  defaultConfig: {
    bodyText: "¿Qué querés hacer?",
    buttons: [{ id: "yes", title: "Sí" }, { id: "no", title: "No" }],
  },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId || !ctx.contactId || !ctx.channelId) {
      return { kind: "error", error: "send_buttons requires conversation context" };
    }
    await sendMessageNow({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      channelId: ctx.channelId,
      body: {
        type: "interactive_buttons",
        bodyText: renderTemplate(config.bodyText, ctx.variables as VarsMap),
        headerText: config.headerText ? renderTemplate(config.headerText, ctx.variables as VarsMap) : undefined,
        footerText: config.footerText,
        buttons: config.buttons,
      },
      senderKind: "workflow",
      workflowRunId: ctx.runId,
    });
    return { kind: "next" };
  },
});

export const sendList = defineNode({
  type: "send_list",
  category: "messages",
  label: "Enviar lista",
  description: "Lista de opciones con secciones.",
  icon: "List",
  accentColor: "green",
  configSchema: z.object({
    bodyText: z.string().min(1),
    buttonText: z.string().max(20),
    headerText: z.string().optional(),
    footerText: z.string().optional(),
    sections: z.array(z.object({
      title: z.string(),
      rows: z.array(z.object({
        id: z.string(),
        title: z.string().max(24),
        description: z.string().max(72).optional(),
      })).min(1),
    })).min(1),
  }),
  defaultConfig: {
    bodyText: "Elegí una opción:",
    buttonText: "Ver opciones",
    sections: [{ title: "Servicios", rows: [{ id: "info", title: "Información" }] }],
  },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId || !ctx.contactId || !ctx.channelId) {
      return { kind: "error", error: "send_list requires conversation context" };
    }
    await sendMessageNow({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      channelId: ctx.channelId,
      body: {
        type: "interactive_list",
        bodyText: renderTemplate(config.bodyText, ctx.variables as VarsMap),
        buttonText: config.buttonText,
        headerText: config.headerText,
        footerText: config.footerText,
        sections: config.sections,
      },
      senderKind: "workflow",
      workflowRunId: ctx.runId,
    });
    return { kind: "next" };
  },
});

export const sendTemplate = defineNode({
  type: "send_template",
  category: "messages",
  label: "Enviar template",
  description: "Template aprobado por Meta (mensaje proactivo fuera de 24h).",
  icon: "FileText",
  accentColor: "green",
  configSchema: z.object({
    templateId: z.string().uuid(),
    paramValues: z.record(z.string(), z.string()).default({}),
  }),
  defaultConfig: { templateId: "", paramValues: {} },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId || !ctx.contactId || !ctx.channelId) {
      return { kind: "error", error: "send_template requires conversation context" };
    }
    const { data: tpl, error } = await ctx.admin
      .from("crm_whatsapp_templates")
      .select("name,language,body,variables_count")
      .eq("id", config.templateId)
      .single();
    if (error || !tpl || tpl.meta_status !== "approved") {
      return { kind: "error", error: "Template no aprobado o no existe" };
    }
    const params: { type: "text"; text: string }[] = [];
    for (let i = 1; i <= tpl.variables_count; i++) {
      const raw = config.paramValues[`${i}`] ?? `{{${i}}}`;
      params.push({ type: "text", text: renderTemplate(raw, ctx.variables as VarsMap) });
    }
    await sendMessageNow({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      channelId: ctx.channelId,
      body: {
        type: "template",
        templateName: tpl.name,
        language: tpl.language,
        components: [{ type: "body", parameters: params }],
      },
      senderKind: "workflow",
      workflowRunId: ctx.runId,
      templateName: tpl.name,
      templateVariables: config.paramValues,
    });
    return { kind: "next" };
  },
});

// ─── LÓGICA ────────────────────────────────────────────────────────────────

export const conditionNode = defineNode({
  type: "condition",
  category: "logic",
  label: "Condición",
  description: "Bifurca según una expresión sobre las variables.",
  icon: "GitBranch",
  accentColor: "amber",
  configSchema: z.object({
    rules: z.array(z.object({
      path: z.string(),
      op: z.enum(["eq", "neq", "contains", "gt", "lt", "in", "matches", "is_empty", "not_empty"]),
      value: z.string().optional(),
    })).min(1),
    joiner: z.enum(["and", "or"]).default("and"),
  }),
  defaultConfig: {
    rules: [{ path: "text", op: "contains", value: "" }],
    joiner: "and",
  },
  outputs: [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }],
  execute: async (ctx, config) => {
    const evalRule = (rule: { path: string; op: string; value?: string }) => {
      const left = String(getPath(ctx.variables, rule.path) ?? "").toLowerCase();
      const right = String(rule.value ?? "").toLowerCase();
      switch (rule.op) {
        case "eq": return left === right;
        case "neq": return left !== right;
        case "contains": return left.includes(right);
        case "gt": return Number(left) > Number(right);
        case "lt": return Number(left) < Number(right);
        case "in": return right.split(",").map((s) => s.trim()).includes(left);
        case "matches": try { return new RegExp(right).test(left); } catch { return false; }
        case "is_empty": return left === "";
        case "not_empty": return left !== "";
        default: return false;
      }
    };
    const results = config.rules.map(evalRule);
    const passed = config.joiner === "and" ? results.every(Boolean) : results.some(Boolean);
    return { kind: "branch", outputId: passed ? "yes" : "no" };
  },
});

export const waitForReplyNode = defineNode({
  type: "wait_for_reply",
  category: "logic",
  label: "Esperar respuesta",
  description: "Suspende el workflow hasta que el contacto responda (o timeout).",
  icon: "Hourglass",
  accentColor: "amber",
  configSchema: z.object({
    timeoutMinutes: z.number().int().min(1).max(60 * 24 * 7).default(60),
  }),
  defaultConfig: { timeoutMinutes: 60 },
  outputs: [{ id: "replied", label: "Respondió" }, { id: "timeout", label: "Timeout" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId) return { kind: "error", error: "wait_for_reply requires conversation context" };
    const timeoutAt = new Date(Date.now() + config.timeoutMinutes * 60_000);
    return { kind: "wait_reply", conversationId: ctx.conversationId, timeoutAt };
  },
});

export const waitTimeNode = defineNode({
  type: "wait_time",
  category: "logic",
  label: "Esperar tiempo",
  description: "Pausa el workflow durante N segundos/minutos/horas.",
  icon: "Clock",
  accentColor: "amber",
  configSchema: z.object({
    duration: z.number().int().min(1),
    unit: z.enum(["seconds", "minutes", "hours", "days"]).default("seconds"),
  }),
  defaultConfig: { duration: 60, unit: "seconds" },
  outputs: [{ id: "next" }],
  execute: async (_ctx, config) => {
    const seconds = {
      seconds: config.duration,
      minutes: config.duration * 60,
      hours: config.duration * 3600,
      days: config.duration * 86400,
    }[config.unit];
    return { kind: "wait_time", resumeAt: new Date(Date.now() + seconds * 1000) };
  },
});

export const loopNode = defineNode({
  type: "loop",
  category: "logic",
  label: "Bucle / Loop",
  description: "Itera sobre un array de variables.",
  icon: "RotateCw",
  accentColor: "amber",
  configSchema: z.object({
    collectionPath: z.string(),
    itemVarName: z.string().default("item"),
    maxIterations: z.number().int().min(1).max(50).default(10),
  }),
  defaultConfig: { collectionPath: "items", itemVarName: "item", maxIterations: 10 },
  outputs: [{ id: "next", label: "Loop" }, { id: "done", label: "Done" }],
  execute: async (ctx, config) => {
    const collection = getPath(ctx.variables, config.collectionPath);
    if (!Array.isArray(collection)) return { kind: "branch", outputId: "done" };
    const iter = (ctx.variables.__loop_iter as number | undefined) ?? 0;
    if (iter >= Math.min(collection.length, config.maxIterations)) {
      return { kind: "branch", outputId: "done" };
    }
    return {
      kind: "branch",
      outputId: "next",
      output: { __loop_iter: iter + 1, [config.itemVarName]: collection[iter] },
    };
  },
});

export const setVariableNode = defineNode({
  type: "set_variable",
  category: "logic",
  label: "Setear variable",
  description: "Asigna o renderiza una variable runtime.",
  icon: "Variable",
  accentColor: "amber",
  configSchema: z.object({
    name: z.string().min(1),
    value: z.string(),
  }),
  defaultConfig: { name: "my_var", value: "{{contact.name}}" },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    const value = renderTemplate(config.value, ctx.variables as VarsMap);
    return { kind: "next", output: { [config.name]: value } };
  },
});

// ─── IA ────────────────────────────────────────────────────────────────────

export const aiResponseNode = defineNode({
  type: "ai_response",
  category: "ai",
  label: "Respuesta IA",
  description: "Genera una respuesta con LLM y opcionalmente la envía.",
  icon: "Sparkles",
  accentColor: "violet",
  configSchema: z.object({
    model: z.string(),
    systemPrompt: z.string(),
    includeHistory: z.boolean().default(true),
    maxHistoryMessages: z.number().int().min(1).max(50).default(10),
    sendAsMessage: z.boolean().default(true),
    saveAs: z.string().optional(),
  }),
  defaultConfig: {
    model: "claude-sonnet-4-6".split("").join(""),
    systemPrompt: "Sos el asistente virtual de Apart Cba (PMS de alquileres temporarios). Respondé en español rioplatense, conciso y amable.",
    includeHistory: true,
    maxHistoryMessages: 10,
    sendAsMessage: true,
  },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    await assertAIBudget(ctx.organizationId);
    const { client } = await getAIClientForOrg(ctx.organizationId);

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: config.systemPrompt },
    ];
    if (config.includeHistory && ctx.conversationId) {
      const { data: history } = await ctx.admin
        .from("crm_messages")
        .select("direction,body,type,transcription_text")
        .eq("conversation_id", ctx.conversationId)
        .order("created_at", { ascending: true })
        .limit(config.maxHistoryMessages);
      for (const m of history ?? []) {
        const text = m.body ?? m.transcription_text ?? `[${m.type}]`;
        messages.push({ role: m.direction === "in" ? "user" : "assistant", content: text });
      }
    } else if (ctx.variables.text) {
      messages.push({ role: "user", content: String(ctx.variables.text) });
    }

    const { text, usage } = await client.chat({ model: config.model, messages });
    await trackAIUsage({ organizationId: ctx.organizationId, usage, model: config.model });

    if (config.sendAsMessage && ctx.conversationId && ctx.contactId && ctx.channelId) {
      await sendMessageNow({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        channelId: ctx.channelId,
        body: { type: "text", text },
        senderKind: "ai",
        workflowRunId: ctx.runId,
      });
    }
    const out: Record<string, unknown> = { ai_response: text };
    if (config.saveAs) out[config.saveAs] = text;
    return { kind: "next", output: out };
  },
});

export const aiAutoTagNode = defineNode({
  type: "ai_auto_tag",
  category: "ai",
  label: "Auto-tag IA",
  description: "Clasifica el mensaje y aplica tags automáticamente.",
  icon: "Tags",
  accentColor: "violet",
  configSchema: z.object({
    model: z.string(),
    candidateTagSlugs: z.array(z.string()).min(1),
    multi: z.boolean().default(true),
  }),
  defaultConfig: {
    model: "claude-sonnet-4-6".split("").join(""),
    candidateTagSlugs: ["lead", "consulta-disponibilidad", "incidente", "spam"],
    multi: true,
  },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId) return { kind: "error", error: "ai_auto_tag requires conversation context" };
    await assertAIBudget(ctx.organizationId);
    const { client } = await getAIClientForOrg(ctx.organizationId);

    const { data: tags } = await ctx.admin
      .from("crm_tags")
      .select("id,slug,description")
      .eq("organization_id", ctx.organizationId)
      .in("slug", config.candidateTagSlugs);

    if (!tags || tags.length === 0) return { kind: "next" };

    const text = String(ctx.variables.text ?? "");
    if (!text) return { kind: "next" };

    const tagsTyped = tags as { id: string; slug: string; description: string | null }[];
    const result = await client.classify({
      model: config.model,
      text,
      labels: tagsTyped.map((t) => ({ slug: t.slug, description: t.description ?? undefined })),
      multi: config.multi,
    });
    await trackAIUsage({ organizationId: ctx.organizationId, usage: result.usage, model: config.model });

    const matchedIds = tagsTyped.filter((t) => result.labels.includes(t.slug)).map((t) => t.id);
    for (const tagId of matchedIds) {
      await ctx.admin.from("crm_conversation_tags").upsert({
        conversation_id: ctx.conversationId,
        tag_id: tagId,
        added_via: "ai",
      }, { onConflict: "conversation_id,tag_id" });
    }
    return { kind: "next", output: { ai_tags: result.labels, ai_confidence: result.confidence } };
  },
});

export const aiHandoffHumanNode = defineNode({
  type: "ai_handoff_human",
  category: "ai",
  label: "Derivar a humano",
  description: "Asigna la conversación a un humano y notifica.",
  icon: "UserCheck",
  accentColor: "violet",
  configSchema: z.object({
    notifyRole: z.enum(["admin", "recepcion"]).default("recepcion"),
    summarizeBefore: z.boolean().default(true),
    model: z.string().optional(),
  }),
  defaultConfig: { notifyRole: "recepcion", summarizeBefore: true },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId) return { kind: "error", error: "handoff requires conversation" };

    if (config.summarizeBefore && config.model) {
      try {
        await assertAIBudget(ctx.organizationId);
        const { client } = await getAIClientForOrg(ctx.organizationId);
        const { data: msgs } = await ctx.admin
          .from("crm_messages")
          .select("direction,body,transcription_text,type")
          .eq("conversation_id", ctx.conversationId)
          .order("created_at", { ascending: false })
          .limit(20);
        const text = ((msgs ?? []) as { direction: string; body: string | null; transcription_text: string | null; type: string }[]).reverse()
          .map((m) => `${m.direction === "in" ? "Cliente" : "Agente"}: ${m.body ?? m.transcription_text ?? `[${m.type}]`}`)
          .join("\n");
        const { summary, usage } = await client.summarize({ model: config.model, text });
        await trackAIUsage({ organizationId: ctx.organizationId, usage, model: config.model });
        await ctx.admin
          .from("crm_conversations")
          .update({ ai_summary: summary, ai_summary_generated_at: new Date().toISOString() })
          .eq("id", ctx.conversationId);
      } catch {
        // best-effort
      }
    }

    await ctx.admin.from("notifications").insert({
      organization_id: ctx.organizationId,
      type: "manual",
      severity: "warning",
      title: "Derivación a humano",
      body: "Una conversación necesita atención humana.",
      ref_type: "crm_conversation",
      ref_id: ctx.conversationId,
      target_role: config.notifyRole,
      action_url: `/dashboard/crm/inbox?c=${ctx.conversationId}`,
    });
    return { kind: "next" };
  },
});

export const aiSummarizeThreadNode = defineNode({
  type: "ai_summarize_thread",
  category: "ai",
  label: "Resumir thread",
  description: "Genera un resumen del thread y lo guarda en la conversación.",
  icon: "FileText",
  accentColor: "violet",
  configSchema: z.object({
    model: z.string(),
    lastN: z.number().int().min(2).max(50).default(20),
  }),
  defaultConfig: { model: "claude-sonnet-4-6".split("").join(""), lastN: 20 },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId) return { kind: "error", error: "summarize requires conversation" };
    await assertAIBudget(ctx.organizationId);
    const { client } = await getAIClientForOrg(ctx.organizationId);
    const { data: msgs } = await ctx.admin
      .from("crm_messages")
      .select("direction,body,transcription_text,type")
      .eq("conversation_id", ctx.conversationId)
      .order("created_at", { ascending: false })
      .limit(config.lastN);
    const text = ((msgs ?? []) as { direction: string; body: string | null; transcription_text: string | null; type: string }[]).reverse()
      .map((m) => `${m.direction === "in" ? "Cliente" : "Agente"}: ${m.body ?? m.transcription_text ?? `[${m.type}]`}`)
      .join("\n");
    const { summary, usage } = await client.summarize({ model: config.model, text });
    await trackAIUsage({ organizationId: ctx.organizationId, usage, model: config.model });
    await ctx.admin
      .from("crm_conversations")
      .update({ ai_summary: summary, ai_summary_generated_at: new Date().toISOString() })
      .eq("id", ctx.conversationId);
    return { kind: "next", output: { ai_summary: summary } };
  },
});

// ─── ACCIONES GENÉRICAS ────────────────────────────────────────────────────

export const addTagNode = defineNode({
  type: "add_tag",
  category: "actions",
  label: "Agregar etiqueta",
  description: "Agrega un tag a la conversación.",
  icon: "Tag",
  accentColor: "red",
  configSchema: z.object({
    tagSlug: z.string(),
  }),
  defaultConfig: { tagSlug: "lead" },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId) return { kind: "next" };
    const { data: tag } = await ctx.admin
      .from("crm_tags")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("slug", config.tagSlug)
      .single();
    if (!tag) return { kind: "next" };
    await ctx.admin.from("crm_conversation_tags").upsert({
      conversation_id: ctx.conversationId,
      tag_id: tag.id,
      added_via: "workflow",
    }, { onConflict: "conversation_id,tag_id" });
    return { kind: "next" };
  },
});

export const removeTagNode = defineNode({
  type: "remove_tag",
  category: "actions",
  label: "Quitar etiqueta",
  description: "Saca un tag de la conversación.",
  icon: "TagX",
  accentColor: "red",
  configSchema: z.object({
    tagSlug: z.string(),
  }),
  defaultConfig: { tagSlug: "lead" },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    if (!ctx.conversationId) return { kind: "next" };
    const { data: tag } = await ctx.admin
      .from("crm_tags")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("slug", config.tagSlug)
      .single();
    if (!tag) return { kind: "next" };
    await ctx.admin.from("crm_conversation_tags")
      .delete()
      .eq("conversation_id", ctx.conversationId)
      .eq("tag_id", tag.id);
    return { kind: "next" };
  },
});

export const crmAlertNode = defineNode({
  type: "crm_alert",
  category: "actions",
  label: "Alerta CRM",
  description: "Crea una notificación in-app para el equipo.",
  icon: "Bell",
  accentColor: "red",
  configSchema: z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    severity: z.enum(["info", "warning", "critical", "success"]).default("warning"),
    targetRole: z.enum(["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"]).optional(),
  }),
  defaultConfig: { title: "Atención", severity: "warning" },
  outputs: [{ id: "next" }],
  execute: async (ctx, config) => {
    await ctx.admin.from("notifications").insert({
      organization_id: ctx.organizationId,
      type: "manual",
      severity: config.severity,
      title: renderTemplate(config.title, ctx.variables as VarsMap),
      body: config.body ? renderTemplate(config.body, ctx.variables as VarsMap) : null,
      target_role: config.targetRole ?? null,
      action_url: ctx.conversationId ? `/dashboard/crm/inbox?c=${ctx.conversationId}` : null,
      ref_type: ctx.conversationId ? "crm_conversation" : null,
      ref_id: ctx.conversationId ?? null,
    });
    return { kind: "next" };
  },
});

export const httpRequestNode = defineNode({
  type: "http_request",
  category: "actions",
  label: "HTTP Request",
  description: "Llama a una URL externa (con timeout 10s).",
  icon: "Globe",
  accentColor: "red",
  configSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    saveAs: z.string().optional(),
    timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  }),
  defaultConfig: { method: "GET", url: "https://example.com", timeoutMs: 10000 },
  outputs: [{ id: "success" }, { id: "error" }],
  execute: async (ctx, config) => {
    try {
      const url = renderTemplate(config.url, ctx.variables as VarsMap);
      const ctl = AbortSignal.timeout(config.timeoutMs);
      const renderedBody = config.body ? renderTemplate(config.body, ctx.variables as VarsMap) : undefined;
      const res = await fetch(url, {
        method: config.method,
        headers: config.headers,
        body: renderedBody,
        signal: ctl,
      });
      const text = await res.text();
      const out: Record<string, unknown> = { http_status: res.status, http_body: text };
      if (config.saveAs) {
        try {
          out[config.saveAs] = JSON.parse(text);
        } catch {
          out[config.saveAs] = text;
        }
      }
      if (!res.ok) return { kind: "branch", outputId: "error", output: out };
      return { kind: "branch", outputId: "success", output: out };
    } catch (err) {
      return { kind: "branch", outputId: "error", output: { http_error: err instanceof Error ? err.message : String(err) } };
    }
  },
});

// ─── helpers ──────────────────────────────────────────────────────────────

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}
