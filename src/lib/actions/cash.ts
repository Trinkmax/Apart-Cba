"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { CashAccount, CashMovement } from "@/lib/types/database";

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
  return data ?? [];
}

export async function createAccount(input: AccountInput) {
  await requireSession();
  const { organization } = await getCurrentOrg();
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
