"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import type { CashAccount, CashMovement } from "@/lib/types/database";

// ════════════════════════════════════════════════════════════════════════════
// Tipos públicos del módulo de caja
// ════════════════════════════════════════════════════════════════════════════

export type MovementCategory = CashMovement["category"];
export type MovementDirection = CashMovement["direction"];

export type EnrichedMovement = CashMovement & {
  account: { id: string; name: string; currency: string; type: string; color: string | null } | null;
  unit: { id: string; code: string; name: string } | null;
  owner: { id: string; full_name: string } | null;
};

export type EnrichedMovementRow = EnrichedMovement & { running_balance: number };

export type LinkedBookingPreview = {
  id: string;
  unit_id: string;
  unit_code: string | null;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  paid_amount: number;
  currency: string;
  guest_name: string | null;
  status: string;
};

export type LinkedSchedulePreview = {
  id: string;
  booking_id: string;
  sequence_number: number;
  total_count: number;
  due_date: string;
  expected_amount: number;
  paid_amount: number;
  currency: string;
  status: string;
};

export type LinkedTransferPreview = {
  id: string;
  exchange_rate: number | null;
  fee: number | null;
  sibling: {
    movement_id: string;
    account_id: string;
    account_name: string;
    direction: MovementDirection;
    amount: number;
    currency: string;
  } | null;
};

export type LinkedSettlementPreview = {
  id: string;
  status: string;
  period_year: number;
  period_month: number;
  owner_id: string;
  owner_name: string | null;
  is_locked: boolean;
};

export type MovementDetail = EnrichedMovement & {
  linked_booking: LinkedBookingPreview | null;
  linked_schedule: LinkedSchedulePreview | null;
  linked_transfer: LinkedTransferPreview | null;
  linked_settlement: LinkedSettlementPreview | null;
};

export type AccountStats = {
  balance: number;
  mtd_in: number;
  mtd_out: number;
  ytd_in: number;
  ytd_out: number;
  daily_balance: Array<{ date: string; balance: number }>;
};

export type ListMovementsFilters = {
  accountId: string;
  fromDate?: string;
  toDate?: string;
  category?: MovementCategory | "all";
  direction?: MovementDirection | "all";
  billableTo?: "apartcba" | "owner" | "guest" | "all";
  search?: string;
  page?: number;
  pageSize?: number;
};

export type MutationResult = {
  ok: boolean;
  side_effects: string[];
  affected: { booking_id?: string; schedule_id?: string };
};

export type PreviewResult = {
  ok: boolean;
  blockers: string[];
  side_effects: string[];
};

export type CashMovementAuditEntry = {
  id: string;
  movement_id: string | null;
  action: "update" | "delete";
  actor_user_id: string | null;
  actor_name: string;
  changes: Record<string, { from: unknown; to: unknown } | unknown>;
  side_effects: string[];
  occurred_at: string;
};

const accountSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["efectivo", "banco", "mp", "crypto", "tarjeta", "otro"]),
  currency: z.string(),
  opening_balance: z.coerce.number().default(0),
  account_number: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  color: z.string().default("#0F766E"),
  icon: z.string().default("wallet"),
});

const movementSchema = z.object({
  account_id: z.string().uuid(),
  direction: z.enum(["in", "out"]),
  amount: z.coerce.number().positive(),
  currency: z.string(),
  category: z.enum([
    "booking_payment", "maintenance", "cleaning", "owner_settlement", "transfer",
    "adjustment", "salary", "utilities", "tax", "supplies", "commission", "refund", "other",
  ]),
  unit_id: z.string().uuid().optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  occurred_at: z.string().optional(),
  billable_to: z.enum(["apartcba", "owner", "guest"]).default("apartcba"),
});

export type AccountInput = z.infer<typeof accountSchema>;
export type MovementInput = z.infer<typeof movementSchema>;

export async function listAccounts(): Promise<CashAccount[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cash_accounts")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("active", true)
    .order("display_order")
    .order("name");
  if (error) throw new Error(error.message);
  return (data as CashAccount[]) ?? [];
}

export async function getAccountBalance(accountId: string): Promise<number> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const [{ data: acc }, { data: mvs }] = await Promise.all([
    admin.from("cash_accounts").select("opening_balance").eq("id", accountId).eq("organization_id", organization.id).maybeSingle(),
    admin.from("cash_movements").select("direction, amount").eq("account_id", accountId).eq("organization_id", organization.id),
  ]);
  if (!acc) return 0;
  const delta = (mvs ?? []).reduce(
    (acc, m) => acc + (m.direction === "in" ? Number(m.amount) : -Number(m.amount)),
    0
  );
  return Number(acc.opening_balance) + delta;
}

/**
 * Devuelve todos los balances de las cuentas de la org en 2 queries totales,
 * evitando el N+1 que tenía /dashboard/caja al llamar getAccountBalance por
 * cada cuenta. El resultado es un map { account_id → balance }; las cuentas
 * sin movimientos quedan con su opening_balance.
 */
export async function getAccountBalances(): Promise<Record<string, number>> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const [{ data: accounts }, { data: movements }] = await Promise.all([
    admin
      .from("cash_accounts")
      .select("id, opening_balance")
      .eq("organization_id", organization.id),
    admin
      .from("cash_movements")
      .select("account_id, direction, amount")
      .eq("organization_id", organization.id),
  ]);
  const map: Record<string, number> = {};
  for (const a of accounts ?? []) {
    map[a.id] = Number(a.opening_balance ?? 0);
  }
  for (const m of movements ?? []) {
    const delta = m.direction === "in" ? Number(m.amount) : -Number(m.amount);
    map[m.account_id] = (map[m.account_id] ?? 0) + delta;
  }
  return map;
}

export async function listMovements(filters?: {
  accountId?: string;
  fromDate?: string;
  toDate?: string;
  category?: string;
  limit?: number;
}) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("cash_movements")
    .select(`*, account:cash_accounts(id, name, currency, type, color), unit:units(id, code, name), owner:owners(id, full_name)`)
    .eq("organization_id", organization.id);
  if (filters?.accountId) q = q.eq("account_id", filters.accountId);
  if (filters?.fromDate) q = q.gte("occurred_at", filters.fromDate);
  if (filters?.toDate) q = q.lte("occurred_at", filters.toDate);
  if (filters?.category) q = q.eq("category", filters.category);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(filters?.limit ?? 200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    category: string;
    ref_type: string | null;
    ref_id: string | null;
    [k: string]: unknown;
  }>;
  if (rows.length === 0) return rows;

  // Resolvemos el guest_name del huésped pagador para movimientos de
  // booking_payment. Hacemos 2 queries extra (bookings + schedules)
  // para evitar N+1: ya teníamos los movements en memoria, juntamos los
  // ids y traemos las relaciones en batch.
  const bookingMovs = rows.filter(
    (r) => r.category === "booking_payment" && r.ref_id
  );
  const directBookingIds = bookingMovs
    .filter((r) => r.ref_type === "booking")
    .map((r) => r.ref_id as string);
  const scheduleIds = bookingMovs
    .filter((r) => r.ref_type === "payment_schedule")
    .map((r) => r.ref_id as string);

  const [bookingsRes, schedulesRes] = await Promise.all([
    directBookingIds.length
      ? admin
          .from("bookings")
          .select("id, guest:guests(full_name)")
          .in("id", directBookingIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({ data: [] as Array<{ id: string; guest: { full_name: string } | null }> }),
    scheduleIds.length
      ? admin
          .from("booking_payment_schedule")
          .select("id, booking_id, booking:bookings(guest:guests(full_name))")
          .in("id", scheduleIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            booking_id: string;
            booking: { guest: { full_name: string } | null } | null;
          }>,
        }),
  ]);

  const guestByBookingId = new Map<string, string | null>();
  for (const bk of (bookingsRes.data ?? []) as Array<{ id: string; guest: { full_name: string } | null }>) {
    guestByBookingId.set(bk.id, bk.guest?.full_name ?? null);
  }
  const guestByScheduleId = new Map<string, string | null>();
  for (const sch of (schedulesRes.data ?? []) as Array<{
    id: string;
    booking: { guest: { full_name: string } | null } | null;
  }>) {
    guestByScheduleId.set(sch.id, sch.booking?.guest?.full_name ?? null);
  }

  return rows.map((r) => {
    let guest_name: string | null = null;
    if (r.category === "booking_payment" && r.ref_id) {
      if (r.ref_type === "booking") {
        guest_name = guestByBookingId.get(r.ref_id as string) ?? null;
      } else if (r.ref_type === "payment_schedule") {
        guest_name = guestByScheduleId.get(r.ref_id as string) ?? null;
      }
    }
    return { ...r, linked_guest_name: guest_name };
  });
}

export async function createAccount(input: AccountInput) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "cash", "create")) {
    throw new Error("No tenés permiso para crear cuentas de caja.");
  }
  const validated = accountSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cash_accounts")
    .insert({ ...validated, organization_id: organization.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/caja");
  return data as CashAccount;
}

export async function updateAccount(id: string, input: AccountInput) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "cash", "update")) {
    throw new Error("No tenés permiso para editar cuentas de caja.");
  }
  const validated = accountSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cash_accounts")
    .update(validated)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/caja");
  return data as CashAccount;
}

export async function deleteAccount(id: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "cash", "delete")) {
    throw new Error("No tenés permiso para eliminar cuentas de caja.");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("cash_accounts")
    .update({ active: false })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/caja");
}

export async function createMovement(input: MovementInput) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = movementSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cash_movements")
    .insert({
      ...validated,
      organization_id: organization.id,
      created_by: session.userId,
      occurred_at: validated.occurred_at ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/caja");
  return data as CashMovement;
}

export async function createTransfer(input: {
  from_account_id: string;
  to_account_id: string;
  from_amount: number;
  to_amount: number;
  exchange_rate?: number;
  description?: string;
}) {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const [{ data: fromAcc }, { data: toAcc }] = await Promise.all([
    admin.from("cash_accounts").select("currency").eq("id", input.from_account_id).maybeSingle(),
    admin.from("cash_accounts").select("currency").eq("id", input.to_account_id).maybeSingle(),
  ]);
  if (!fromAcc || !toAcc) throw new Error("Cuenta no encontrada");

  // Crear los 2 movimientos
  const { data: outMv, error: e1 } = await admin
    .from("cash_movements")
    .insert({
      organization_id: organization.id,
      account_id: input.from_account_id,
      direction: "out",
      amount: input.from_amount,
      currency: fromAcc.currency,
      category: "transfer",
      description: input.description ?? `Transferencia a otra cuenta`,
      created_by: session.userId,
    })
    .select()
    .single();
  if (e1) throw new Error(e1.message);

  const { data: inMv, error: e2 } = await admin
    .from("cash_movements")
    .insert({
      organization_id: organization.id,
      account_id: input.to_account_id,
      direction: "in",
      amount: input.to_amount,
      currency: toAcc.currency,
      category: "transfer",
      description: input.description ?? `Transferencia de otra cuenta`,
      created_by: session.userId,
    })
    .select()
    .single();
  if (e2) throw new Error(e2.message);

  await admin.from("cash_transfers").insert({
    organization_id: organization.id,
    from_movement_id: outMv.id,
    to_movement_id: inMv.id,
    exchange_rate: input.exchange_rate,
  });

  revalidatePath("/dashboard/caja");
}

// ════════════════════════════════════════════════════════════════════════════
// Lecturas para detalle de cuenta
// ════════════════════════════════════════════════════════════════════════════

export async function getAccount(
  accountId: string
): Promise<{ account: CashAccount; balance: number } | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("cash_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!account) return null;
  const balance = await getAccountBalance(accountId);
  return { account: account as CashAccount, balance };
}

export async function getAccountStats(
  accountId: string,
  range?: { from: string; to: string }
): Promise<AccountStats> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
  const fromISO = range?.from ?? thirtyDaysAgo.toISOString();
  const toISO = range?.to ?? now.toISOString();

  const [{ data: acc }, ytd, mtd, daily] = await Promise.all([
    admin
      .from("cash_accounts")
      .select("opening_balance")
      .eq("id", accountId)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    admin
      .from("cash_movements")
      .select("direction, amount")
      .eq("account_id", accountId)
      .eq("organization_id", organization.id)
      .gte("occurred_at", yearStart),
    admin
      .from("cash_movements")
      .select("direction, amount")
      .eq("account_id", accountId)
      .eq("organization_id", organization.id)
      .gte("occurred_at", monthStart),
    admin
      .from("v_cash_movements_enriched")
      .select("occurred_at, running_balance")
      .eq("account_id", accountId)
      .eq("organization_id", organization.id)
      .gte("occurred_at", fromISO)
      .lte("occurred_at", toISO)
      .order("occurred_at", { ascending: true }),
  ]);

  const balance = await getAccountBalance(accountId);
  const opening = Number(acc?.opening_balance ?? 0);

  const sum = (rows: Array<{ direction: string; amount: number }> | null, dir: "in" | "out") =>
    (rows ?? [])
      .filter((r) => r.direction === dir)
      .reduce((s, r) => s + Number(r.amount), 0);

  // Construimos serie diaria: agrupamos el último running_balance de cada día
  const dailyMap = new Map<string, number>();
  for (const r of (daily.data as Array<{ occurred_at: string; running_balance: number }> | null) ?? []) {
    const day = r.occurred_at.slice(0, 10);
    dailyMap.set(day, Number(r.running_balance));
  }
  const daily_balance: Array<{ date: string; balance: number }> = [];
  let lastBalance = opening;
  // Generar 30 puntos contiguos para sparkline visual estable
  for (let i = 30; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    if (dailyMap.has(d)) lastBalance = dailyMap.get(d)!;
    daily_balance.push({ date: d, balance: lastBalance });
  }

  return {
    balance,
    mtd_in: sum(mtd.data, "in"),
    mtd_out: sum(mtd.data, "out"),
    ytd_in: sum(ytd.data, "in"),
    ytd_out: sum(ytd.data, "out"),
    daily_balance,
  };
}

export async function listAccountMovements(filters: ListMovementsFilters): Promise<{
  rows: EnrichedMovementRow[];
  total: number;
}> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 50;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let q = admin
    .from("v_cash_movements_enriched")
    .select(
      `id, organization_id, account_id, direction, amount, currency, category, ref_type, ref_id, unit_id, owner_id, description, occurred_at, created_at, created_by, billable_to, account_name, account_color, account_type, running_balance`,
      { count: "exact" }
    )
    .eq("account_id", filters.accountId)
    .eq("organization_id", organization.id);

  if (filters.fromDate) q = q.gte("occurred_at", filters.fromDate);
  if (filters.toDate) q = q.lte("occurred_at", filters.toDate);
  if (filters.category && filters.category !== "all") q = q.eq("category", filters.category);
  if (filters.direction && filters.direction !== "all") q = q.eq("direction", filters.direction);
  if (filters.billableTo && filters.billableTo !== "all") q = q.eq("billable_to", filters.billableTo);
  if (filters.search && filters.search.trim()) {
    q = q.ilike("description", `%${filters.search.trim()}%`);
  }

  const { data, error, count } = await q.order("occurred_at", { ascending: false }).range(from, to);
  if (error) throw new Error(error.message);

  // Hidratar unit/owner para cada row (SELECT en batch sobre la vista no incluye joins)
  const rows = (data ?? []) as Array<{
    id: string;
    organization_id: string;
    account_id: string;
    direction: MovementDirection;
    amount: number;
    currency: string;
    category: MovementCategory;
    ref_type: string | null;
    ref_id: string | null;
    unit_id: string | null;
    owner_id: string | null;
    description: string | null;
    occurred_at: string;
    created_at: string;
    created_by: string | null;
    billable_to: "apartcba" | "owner" | "guest";
    account_name: string;
    account_color: string | null;
    account_type: string;
    running_balance: number;
  }>;

  const unitIds = Array.from(new Set(rows.map((r) => r.unit_id).filter(Boolean) as string[]));
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id).filter(Boolean) as string[]));

  const [{ data: units }, { data: owners }] = await Promise.all([
    unitIds.length
      ? admin
          .from("units")
          .select("id, code, name")
          .in("id", unitIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({ data: [] as Array<{ id: string; code: string; name: string }> }),
    ownerIds.length
      ? admin
          .from("owners")
          .select("id, full_name")
          .in("id", ownerIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
  ]);

  const unitMap = new Map((units ?? []).map((u) => [u.id, u]));
  const ownerMap = new Map((owners ?? []).map((o) => [o.id, o]));

  const enriched: EnrichedMovementRow[] = rows.map((r) => ({
    id: r.id,
    organization_id: r.organization_id,
    account_id: r.account_id,
    direction: r.direction,
    amount: Number(r.amount),
    currency: r.currency,
    category: r.category,
    ref_type: r.ref_type,
    ref_id: r.ref_id,
    unit_id: r.unit_id,
    owner_id: r.owner_id,
    description: r.description,
    occurred_at: r.occurred_at,
    created_at: r.created_at,
    created_by: r.created_by,
    billable_to: r.billable_to,
    account: {
      id: r.account_id,
      name: r.account_name,
      currency: r.currency,
      type: r.account_type,
      color: r.account_color,
    },
    unit: r.unit_id ? unitMap.get(r.unit_id) ?? null : null,
    owner: r.owner_id ? ownerMap.get(r.owner_id) ?? null : null,
    running_balance: Number(r.running_balance),
  }));

  return { rows: enriched, total: count ?? enriched.length };
}

export async function getMovementDetail(movementId: string): Promise<MovementDetail | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: m, error } = await admin
    .from("cash_movements")
    .select(
      `*,
       account:cash_accounts(id, name, currency, type, color),
       unit:units(id, code, name),
       owner:owners(id, full_name)`
    )
    .eq("id", movementId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!m) return null;

  const movement = m as unknown as EnrichedMovement;

  let linked_booking: LinkedBookingPreview | null = null;
  let linked_schedule: LinkedSchedulePreview | null = null;
  let linked_transfer: LinkedTransferPreview | null = null;
  let linked_settlement: LinkedSettlementPreview | null = null;

  // Booking preview (directo o vía schedule)
  let bookingId: string | null = null;
  if (movement.ref_type === "booking" && movement.ref_id) {
    bookingId = movement.ref_id;
  } else if (movement.ref_type === "payment_schedule" && movement.ref_id) {
    const { data: sch } = await admin
      .from("booking_payment_schedule")
      .select("id, booking_id, sequence_number, total_count, due_date, expected_amount, paid_amount, currency, status")
      .eq("id", movement.ref_id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (sch) {
      linked_schedule = {
        id: sch.id,
        booking_id: sch.booking_id,
        sequence_number: sch.sequence_number,
        total_count: sch.total_count,
        due_date: sch.due_date,
        expected_amount: Number(sch.expected_amount),
        paid_amount: Number(sch.paid_amount),
        currency: sch.currency,
        status: sch.status,
      };
      bookingId = sch.booking_id;
    }
  }

  if (bookingId) {
    const { data: bk } = await admin
      .from("bookings")
      .select(
        "id, unit_id, check_in_date, check_out_date, total_amount, paid_amount, currency, status, unit:units(code), guest:guests(full_name)"
      )
      .eq("id", bookingId)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (bk) {
      const u = bk.unit as unknown as { code: string } | null;
      const g = bk.guest as unknown as { full_name: string } | null;
      linked_booking = {
        id: bk.id,
        unit_id: bk.unit_id,
        unit_code: u?.code ?? null,
        check_in_date: bk.check_in_date,
        check_out_date: bk.check_out_date,
        total_amount: Number(bk.total_amount),
        paid_amount: Number(bk.paid_amount),
        currency: bk.currency,
        status: bk.status,
        guest_name: g?.full_name ?? null,
      };
    }
  }

  // Transfer pair
  if (movement.category === "transfer") {
    const { data: pair } = await admin
      .from("cash_transfers")
      .select("id, from_movement_id, to_movement_id, exchange_rate, fee")
      .or(`from_movement_id.eq.${movementId},to_movement_id.eq.${movementId}`)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (pair) {
      const siblingId = pair.from_movement_id === movementId ? pair.to_movement_id : pair.from_movement_id;
      const { data: sib } = await admin
        .from("cash_movements")
        .select("id, account_id, direction, amount, currency, account:cash_accounts(name)")
        .eq("id", siblingId)
        .eq("organization_id", organization.id)
        .maybeSingle();
      const sa = sib?.account as unknown as { name: string } | null;
      linked_transfer = {
        id: pair.id,
        exchange_rate: pair.exchange_rate ? Number(pair.exchange_rate) : null,
        fee: pair.fee ? Number(pair.fee) : null,
        sibling: sib
          ? {
              movement_id: sib.id,
              account_id: sib.account_id,
              account_name: sa?.name ?? "—",
              direction: sib.direction as MovementDirection,
              amount: Number(sib.amount),
              currency: sib.currency,
            }
          : null,
      };
    }
  }

  // Settlement vinculado (vía paid_movement_id)
  if (movement.category === "owner_settlement") {
    const { data: st } = await admin
      .from("owner_settlements")
      .select("id, status, period_year, period_month, owner_id, owner:owners(full_name)")
      .eq("paid_movement_id", movementId)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (st) {
      const o = st.owner as unknown as { full_name: string } | null;
      linked_settlement = {
        id: st.id,
        status: st.status,
        period_year: st.period_year,
        period_month: st.period_month,
        owner_id: st.owner_id,
        owner_name: o?.full_name ?? null,
        is_locked: ["pagada", "enviada", "revisada"].includes(st.status),
      };
    }
  }

  return {
    ...movement,
    amount: Number(movement.amount),
    linked_booking,
    linked_schedule,
    linked_transfer,
    linked_settlement,
  };
}

// Lista los movements asociados a una booking (directos + por sus cuotas).
// Reutilizado por la pestaña Pagos en /dashboard/reservas/[id].
export async function listMovementsForBooking(bookingId: string): Promise<EnrichedMovement[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: schedules } = await admin
    .from("booking_payment_schedule")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("organization_id", organization.id);
  const scheduleIds = (schedules ?? []).map((s) => s.id);

  const orFilter = scheduleIds.length
    ? `and(ref_type.eq.booking,ref_id.eq.${bookingId}),and(ref_type.eq.payment_schedule,ref_id.in.(${scheduleIds.join(",")}))`
    : `and(ref_type.eq.booking,ref_id.eq.${bookingId})`;

  const { data, error } = await admin
    .from("cash_movements")
    .select(
      `*, account:cash_accounts(id, name, currency, type, color), unit:units(id, code, name), owner:owners(id, full_name)`
    )
    .eq("organization_id", organization.id)
    .or(orFilter)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as EnrichedMovement[]) ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
// Mutaciones — preview / update / delete
// ════════════════════════════════════════════════════════════════════════════

const updateMovementSchema = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  direction: z.enum(["in", "out"]),
  amount: z.coerce.number().positive(),
  category: z.enum([
    "booking_payment", "maintenance", "cleaning", "owner_settlement", "transfer",
    "adjustment", "salary", "utilities", "tax", "supplies", "commission", "refund", "other",
  ]),
  unit_id: z.string().uuid().optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  occurred_at: z.string().optional(),
  billable_to: z.enum(["apartcba", "owner", "guest"]).default("apartcba"),
  // Nombre del administrador que hace el cambio (audit trail informativo).
  // Se exige en updateMovement/deleteMovement; previewMovementUpdate puede ignorarlo.
  actor_name: z.string().min(2, "Indicá quién está haciendo el cambio").max(120).optional(),
});

export type UpdateMovementInput = z.infer<typeof updateMovementSchema>;

const previewSchema = updateMovementSchema.extend({
  is_delete: z.boolean().default(false),
  force_transfer: z.boolean().default(false),
});

// Helper para revalidación centralizada después de cualquier mutación.
function pathsForMovementMutation(opts: {
  accountId: string;
  newAccountId?: string;
  bookingId?: string;
  settlementId?: string;
}) {
  const paths = [
    "/dashboard/caja",
    `/dashboard/caja/${opts.accountId}`,
    "/dashboard/reservas",
    "/dashboard/unidades/kanban",
    "/dashboard/unidades/calendario/mensual",
    "/dashboard/alertas",
    "/dashboard",
  ];
  if (opts.newAccountId && opts.newAccountId !== opts.accountId) {
    paths.push(`/dashboard/caja/${opts.newAccountId}`);
  }
  if (opts.bookingId) paths.push(`/dashboard/reservas/${opts.bookingId}`);
  if (opts.settlementId) {
    paths.push("/dashboard/liquidaciones");
    paths.push(`/dashboard/liquidaciones/${opts.settlementId}`);
  }
  return paths;
}

// Verifica permisos compuestos: cash + (payments si hay link a booking/schedule) + (settlements si owner_settlement)
async function assertCanMutateMovement(movementId: string, action: "update" | "delete") {
  const { role } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: m } = await admin
    .from("cash_movements")
    .select("ref_type, category")
    .eq("id", movementId)
    .maybeSingle();
  const refType = m?.ref_type ?? null;
  const category = (m?.category ?? null) as MovementCategory | null;

  if (!can(role, "cash", action)) {
    throw new Error("No tenés permiso para modificar movimientos de caja.");
  }
  if (refType === "booking" || refType === "payment_schedule") {
    // payments requiere doble check (recepcion puede crear pero no editar)
    if (!can(role, "payments", action)) {
      throw new Error("No tenés permiso para modificar pagos de reservas.");
    }
  }
  if (category === "owner_settlement") {
    if (!can(role, "settlements", action)) {
      throw new Error("No tenés permiso para modificar liquidaciones.");
    }
  }
}

export async function previewMovementUpdate(
  input: z.input<typeof previewSchema>
): Promise<PreviewResult> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = previewSchema.parse(input);
  const admin = createAdminClient();

  // Defensa: el movement debe pertenecer a la org
  const { data: own } = await admin
    .from("cash_movements")
    .select("id")
    .eq("id", validated.id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!own) throw new Error("Movimiento no encontrado");

  const { data, error } = await admin.rpc("preview_cash_movement_change", {
    p_movement_id: validated.id,
    p_account_id: validated.account_id,
    p_direction: validated.direction,
    p_amount: validated.amount,
    p_category: validated.category,
    p_occurred_at: validated.occurred_at ?? new Date().toISOString(),
    p_delete: validated.is_delete,
    p_force_transfer: validated.force_transfer,
  });
  if (error) throw new Error(error.message);
  const result = data as PreviewResult;
  return result;
}

export async function updateMovement(input: UpdateMovementInput): Promise<MutationResult> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = updateMovementSchema.parse(input);
  if (!validated.actor_name?.trim()) {
    throw new Error("Indicá quién está haciendo el cambio");
  }
  await assertCanMutateMovement(validated.id, "update");
  const admin = createAdminClient();

  // Defensa: org scoping
  const { data: existing } = await admin
    .from("cash_movements")
    .select("id, account_id, ref_type, ref_id, category")
    .eq("id", validated.id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!existing) throw new Error("Movimiento no encontrado");

  const { data, error } = await admin.rpc("update_cash_movement", {
    p_movement_id: validated.id,
    p_account_id: validated.account_id,
    p_direction: validated.direction,
    p_amount: validated.amount,
    p_category: validated.category,
    p_unit_id: validated.unit_id ?? null,
    p_owner_id: validated.owner_id ?? null,
    p_description: validated.description ?? null,
    p_occurred_at: validated.occurred_at ?? new Date().toISOString(),
    p_billable_to: validated.billable_to,
    p_actor_user_id: session.userId,
    p_actor_name: validated.actor_name.trim(),
  });
  if (error) {
    // Errores conocidos del RPC vienen con mensajes en español del RAISE EXCEPTION
    const msg = mapRpcErrorToSpanish(error.message);
    throw new Error(msg);
  }
  const result = data as MutationResult;

  const settlementId = await maybeFindSettlementId(validated.id, existing.category as MovementCategory);
  for (const p of pathsForMovementMutation({
    accountId: existing.account_id,
    newAccountId: validated.account_id,
    bookingId: result.affected?.booking_id,
    settlementId: settlementId ?? undefined,
  })) {
    revalidatePath(p);
  }
  return result;
}

export async function deleteMovement(input: {
  id: string;
  force_transfer?: boolean;
  actor_name: string;
}): Promise<MutationResult> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const id = z.string().uuid().parse(input.id);
  const actorName = input.actor_name?.trim();
  if (!actorName || actorName.length < 2) {
    throw new Error("Indicá quién está eliminando el movimiento");
  }
  await assertCanMutateMovement(id, "delete");
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("cash_movements")
    .select("id, account_id, category")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!existing) throw new Error("Movimiento no encontrado");

  const { data, error } = await admin.rpc("delete_cash_movement", {
    p_movement_id: id,
    p_force_transfer: input.force_transfer ?? false,
    p_actor_user_id: session.userId,
    p_actor_name: actorName,
  });
  if (error) {
    const msg = mapRpcErrorToSpanish(error.message);
    throw new Error(msg);
  }
  const result = data as MutationResult;

  const settlementId = await maybeFindSettlementId(id, existing.category as MovementCategory);
  for (const p of pathsForMovementMutation({
    accountId: existing.account_id,
    bookingId: result.affected?.booking_id,
    settlementId: settlementId ?? undefined,
  })) {
    revalidatePath(p);
  }
  return result;
}

async function maybeFindSettlementId(
  movementId: string,
  category: MovementCategory
): Promise<string | null> {
  if (category !== "owner_settlement") return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("owner_settlements")
    .select("id")
    .eq("paid_movement_id", movementId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// Auditoría — historial informativo de quién cambió qué
// ════════════════════════════════════════════════════════════════════════════

export async function listMovementAudit(movementId: string): Promise<CashMovementAuditEntry[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cash_movement_audit")
    .select("id, movement_id, action, actor_user_id, actor_name, changes, side_effects, occurred_at")
    .eq("organization_id", organization.id)
    .eq("movement_id", movementId)
    .order("occurred_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as CashMovementAuditEntry[];
}

// Última entrada de auditoría por movimiento — eficiente para mostrar en la lista
// del detalle de cuenta sin un N+1.
export async function listLatestAuditByAccount(
  accountId: string,
  movementIds: string[]
): Promise<Record<string, CashMovementAuditEntry>> {
  if (movementIds.length === 0) return {};
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cash_movement_audit")
    .select("id, movement_id, action, actor_user_id, actor_name, changes, side_effects, occurred_at")
    .eq("organization_id", organization.id)
    .in("movement_id", movementIds)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(error.message);
  const map: Record<string, CashMovementAuditEntry> = {};
  for (const row of (data ?? []) as CashMovementAuditEntry[]) {
    if (row.movement_id && !map[row.movement_id]) map[row.movement_id] = row;
  }
  // accountId queda como parámetro para futura optimización si se filtra por cuenta
  void accountId;
  return map;
}

// ════════════════════════════════════════════════════════════════════════════
// Exportación de movimientos
// ════════════════════════════════════════════════════════════════════════════

const EXPORT_CAP = 50000;

const exportFiltersSchema = z.object({
  fromDate: z.string().min(1, "Fecha inicial requerida"),
  toDate: z.string().min(1, "Fecha final requerida"),
  accountIds: z.array(z.string().uuid()).optional(),
  categories: z
    .array(
      z.enum([
        "booking_payment", "maintenance", "cleaning", "owner_settlement", "transfer",
        "adjustment", "salary", "utilities", "tax", "supplies", "commission", "refund", "other",
      ])
    )
    .optional(),
  direction: z.enum(["in", "out", "all"]).default("all"),
  billableTo: z.enum(["apartcba", "owner", "guest", "all"]).default("all"),
});

export type ExportMovementsFilters = z.input<typeof exportFiltersSchema>;

export type ExportMovementRow = {
  id: string;
  occurred_at: string;
  account_id: string;
  account_name: string;
  currency: string;
  direction: MovementDirection;
  category: MovementCategory;
  amount: number;
  unit_code: string | null;
  unit_name: string | null;
  owner_name: string | null;
  description: string | null;
  billable_to: "apartcba" | "owner" | "guest";
  created_by_name: string | null;
  running_balance: number;
};

export async function exportMovements(input: ExportMovementsFilters): Promise<ExportMovementRow[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = exportFiltersSchema.parse(input);
  const admin = createAdminClient();

  let q = admin
    .from("v_cash_movements_enriched")
    .select(
      `id, occurred_at, account_id, account_name, currency, direction, category, amount, unit_id, owner_id, description, billable_to, created_by, running_balance`
    )
    .eq("organization_id", organization.id)
    .gte("occurred_at", validated.fromDate)
    .lte("occurred_at", validated.toDate);

  if (validated.accountIds?.length) q = q.in("account_id", validated.accountIds);
  if (validated.categories?.length) q = q.in("category", validated.categories);
  if (validated.direction !== "all") q = q.eq("direction", validated.direction);
  if (validated.billableTo !== "all") q = q.eq("billable_to", validated.billableTo);

  const { data, error } = await q
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(EXPORT_CAP + 1);
  if (error) throw new Error(error.message);

  if ((data?.length ?? 0) > EXPORT_CAP) {
    throw new Error(
      `La exportación excede el límite de ${EXPORT_CAP.toLocaleString("es-AR")} movimientos. Reducí el rango de fechas o ajustá los filtros.`
    );
  }

  const rows = (data ?? []) as Array<{
    id: string;
    occurred_at: string;
    account_id: string;
    account_name: string;
    currency: string;
    direction: MovementDirection;
    category: MovementCategory;
    amount: number;
    unit_id: string | null;
    owner_id: string | null;
    description: string | null;
    billable_to: "apartcba" | "owner" | "guest";
    created_by: string | null;
    running_balance: number;
  }>;

  if (rows.length === 0) return [];

  const unitIds = Array.from(new Set(rows.map((r) => r.unit_id).filter(Boolean) as string[]));
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id).filter(Boolean) as string[]));
  const userIds = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean) as string[]));

  const [{ data: units }, { data: owners }, { data: profiles }] = await Promise.all([
    unitIds.length
      ? admin
          .from("units")
          .select("id, code, name")
          .in("id", unitIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({ data: [] as Array<{ id: string; code: string; name: string }> }),
    ownerIds.length
      ? admin
          .from("owners")
          .select("id, full_name")
          .in("id", ownerIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    userIds.length
      ? admin.from("user_profiles").select("user_id, full_name").in("user_id", userIds)
      : Promise.resolve({ data: [] as Array<{ user_id: string; full_name: string }> }),
  ]);

  const unitMap = new Map((units ?? []).map((u) => [u.id, u]));
  const ownerMap = new Map((owners ?? []).map((o) => [o.id, o.full_name]));
  const userMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

  return rows.map((r) => {
    const u = r.unit_id ? unitMap.get(r.unit_id) ?? null : null;
    return {
      id: r.id,
      occurred_at: r.occurred_at,
      account_id: r.account_id,
      account_name: r.account_name,
      currency: r.currency,
      direction: r.direction,
      category: r.category,
      amount: Number(r.amount),
      unit_code: u?.code ?? null,
      unit_name: u?.name ?? null,
      owner_name: r.owner_id ? ownerMap.get(r.owner_id) ?? null : null,
      description: r.description,
      billable_to: r.billable_to,
      created_by_name: r.created_by ? userMap.get(r.created_by) ?? null : null,
      running_balance: Number(r.running_balance),
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Comprobante de pago — datos para PDF
// ════════════════════════════════════════════════════════════════════════════

export type PaymentReceiptData = {
  receipt_number: string;
  issued_at: string;
  organization: {
    id: string;
    name: string;
    legal_name: string | null;
    tax_id: string | null;
    logo_url: string | null;
    primary_color: string | null;
  };
  movement: {
    id: string;
    amount: number;
    currency: string;
    direction: MovementDirection;
    category: MovementCategory;
    occurred_at: string;
    description: string | null;
    billable_to: "apartcba" | "owner" | "guest";
  };
  account: { id: string; name: string; type: string } | null;
  unit: { id: string; code: string; name: string; address: string | null } | null;
  payer: {
    kind: "guest" | "owner" | "organization";
    name: string;
    document: string | null;
    email: string | null;
    phone: string | null;
  };
  booking: {
    id: string;
    check_in_date: string;
    check_out_date: string;
    nights: number;
    total_amount: number;
    paid_amount: number;
    currency: string;
    guests_count: number;
  } | null;
  schedule: {
    sequence_number: number;
    total_count: number;
    expected_amount: number;
    due_date: string;
  } | null;
  issued_by_name: string | null;
};

export async function getPaymentReceiptData(
  movementId: string
): Promise<PaymentReceiptData> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: m, error } = await admin
    .from("cash_movements")
    .select(
      `id, amount, currency, direction, category, occurred_at, description,
       billable_to, ref_type, ref_id, unit_id, owner_id, created_by,
       account:cash_accounts(id, name, type),
       unit:units(id, code, name, address),
       owner:owners(id, full_name, email, phone, document_number, document_type)`
    )
    .eq("id", movementId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!m) throw new Error("Movimiento no encontrado");

  const acc = m.account as unknown as { id: string; name: string; type: string } | null;
  const unitRaw = m.unit as unknown as
    | { id: string; code: string; name: string; address: string | null }
    | null;
  const ownerRaw = m.owner as unknown as
    | {
        id: string;
        full_name: string;
        email: string | null;
        phone: string | null;
        document_number: string | null;
        document_type: string | null;
      }
    | null;

  // Resolver booking + schedule + huésped
  let bookingId: string | null = null;
  let schedule: PaymentReceiptData["schedule"] = null;

  if (m.ref_type === "booking" && m.ref_id) {
    bookingId = m.ref_id;
  } else if (m.ref_type === "payment_schedule" && m.ref_id) {
    const { data: sch } = await admin
      .from("booking_payment_schedule")
      .select("booking_id, sequence_number, total_count, expected_amount, due_date")
      .eq("id", m.ref_id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (sch) {
      bookingId = sch.booking_id;
      schedule = {
        sequence_number: sch.sequence_number,
        total_count: sch.total_count,
        expected_amount: Number(sch.expected_amount),
        due_date: sch.due_date,
      };
    }
  }

  let booking: PaymentReceiptData["booking"] = null;
  let guest:
    | {
        full_name: string;
        document_number: string | null;
        document_type: string | null;
        email: string | null;
        phone: string | null;
      }
    | null = null;
  let bookingUnit: PaymentReceiptData["unit"] = unitRaw;

  if (bookingId) {
    const { data: bk } = await admin
      .from("bookings")
      .select(
        `id, check_in_date, check_out_date, total_amount, paid_amount, currency,
         guests_count, unit_id,
         guest:guests(full_name, document_number, document_type, email, phone),
         unit:units(id, code, name, address)`
      )
      .eq("id", bookingId)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (bk) {
      const g = bk.guest as unknown as {
        full_name: string;
        document_number: string | null;
        document_type: string | null;
        email: string | null;
        phone: string | null;
      } | null;
      const u = bk.unit as unknown as
        | { id: string; code: string; name: string; address: string | null }
        | null;
      const ci = new Date(bk.check_in_date);
      const co = new Date(bk.check_out_date);
      const nights = Math.max(
        1,
        Math.round((co.getTime() - ci.getTime()) / 86400000)
      );
      booking = {
        id: bk.id,
        check_in_date: bk.check_in_date,
        check_out_date: bk.check_out_date,
        nights,
        total_amount: Number(bk.total_amount),
        paid_amount: Number(bk.paid_amount),
        currency: bk.currency,
        guests_count: bk.guests_count,
      };
      guest = g;
      if (u) bookingUnit = u;
    }
  }

  // Resolver pagador
  let payer: PaymentReceiptData["payer"];
  if (guest && (m.billable_to === "guest" || bookingId)) {
    payer = {
      kind: "guest",
      name: guest.full_name,
      document: guest.document_number
        ? `${guest.document_type ?? "Doc"} ${guest.document_number}`
        : null,
      email: guest.email,
      phone: guest.phone,
    };
  } else if (ownerRaw && m.billable_to === "owner") {
    payer = {
      kind: "owner",
      name: ownerRaw.full_name,
      document: ownerRaw.document_number
        ? `${ownerRaw.document_type ?? "Doc"} ${ownerRaw.document_number}`
        : null,
      email: ownerRaw.email,
      phone: ownerRaw.phone,
    };
  } else {
    payer = {
      kind: "organization",
      name: organization.name,
      document: organization.tax_id,
      email: null,
      phone: null,
    };
  }

  // Issued by: usuario que descarga el comprobante (sesión actual), no quien creó el movimiento
  const issuedByName: string | null = session.profile.full_name ?? null;

  // Numero de comprobante: REC-YYYYMM-XXXXXX (deterministico, basado en id)
  const issuedAt = new Date();
  const yyyy = issuedAt.getFullYear();
  const mm = String(issuedAt.getMonth() + 1).padStart(2, "0");
  const shortId = m.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  const receiptNumber = `REC-${yyyy}${mm}-${shortId}`;

  return {
    receipt_number: receiptNumber,
    issued_at: issuedAt.toISOString(),
    organization: {
      id: organization.id,
      name: organization.name,
      legal_name: organization.legal_name,
      tax_id: organization.tax_id,
      logo_url: organization.logo_url,
      primary_color: organization.primary_color,
    },
    movement: {
      id: m.id,
      amount: Number(m.amount),
      currency: m.currency,
      direction: m.direction as MovementDirection,
      category: m.category as MovementCategory,
      occurred_at: m.occurred_at,
      description: m.description,
      billable_to: m.billable_to as "apartcba" | "owner" | "guest",
    },
    account: acc,
    unit: bookingUnit,
    payer,
    booking,
    schedule,
    issued_by_name: issuedByName,
  };
}

function mapRpcErrorToSpanish(raw: string): string {
  if (raw.includes("TRANSFER_REQUIRES_CONFIRM"))
    return "Esta es una transferencia: confirmá que querés eliminar ambos movimientos.";
  if (raw.includes("SETTLEMENT_LOCKED"))
    return "El movimiento está vinculado a una liquidación cerrada. Anulá la liquidación primero.";
  if (raw.includes("Currency mismatch"))
    return "La cuenta destino tiene otra moneda: no se puede reasignar.";
  if (raw.includes("La cuenta destino está inactiva"))
    return "La cuenta destino está inactiva.";
  if (raw.includes("Una cuota debe permanecer"))
    return "Una cuota es siempre cobro entrante: no puede cambiarse a egreso.";
  if (raw.includes("transferencia"))
    return "No se puede cambiar la categoría de una transferencia.";
  return raw;
}
