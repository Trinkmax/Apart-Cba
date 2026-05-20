"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { priceForNight, addDaysIso, computePricing } from "@/lib/marketplace/pricing";
import type { UnitPricingRule } from "@/lib/types/database";

export async function listActiveRules(unitId: string): Promise<UnitPricingRule[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("unit_pricing_rules")
    .select("*")
    .eq("unit_id", unitId)
    .eq("organization_id", organization.id)
    .eq("active", true)
    .order("priority", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as UnitPricingRule[];
}

const basePriceSchema = z.object({
  unit_id: z.string().uuid(),
  base_price: z.coerce.number().min(0, "Precio inválido"),
  marketplace_currency: z.string().min(3).max(4),
});

export async function updateUnitBasePrice(input: z.infer<typeof basePriceSchema>) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = basePriceSchema.parse(input);
  const admin = createAdminClient();
  const { error } = await admin
    .from("units")
    .update({
      base_price: parsed.base_price,
      marketplace_currency: parsed.marketplace_currency,
    })
    .eq("id", parsed.unit_id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/unidades/${parsed.unit_id}`);
  revalidatePath(`/dashboard/unidades/${parsed.unit_id}/precios`);
}

export interface CalendarDayPrice {
  date: string;
  price: number;
  ruleId: string | null;
  ruleName: string | null;
  hasBooking: boolean;
}

export async function getCalendarPrices(
  unitId: string,
  year: number,
  month: number
): Promise<{ days: CalendarDayPrice[]; basePrice: number; currency: string }> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const [{ data: unit }, { data: rules }, { data: bookings }] = await Promise.all([
    admin
      .from("units")
      .select("base_price, marketplace_currency")
      .eq("id", unitId)
      .eq("organization_id", organization.id)
      .single(),
    admin
      .from("unit_pricing_rules")
      .select("*")
      .eq("unit_id", unitId)
      .eq("organization_id", organization.id)
      .eq("active", true),
    admin
      .from("bookings")
      .select("check_in_date, check_out_date")
      .eq("unit_id", unitId)
      .eq("organization_id", organization.id)
      .not("status", "in", '("cancelada","no_show")')
      .gte("check_out_date", `${year}-${String(month).padStart(2, "0")}-01`)
      .lte("check_in_date", `${year}-${String(month).padStart(2, "0")}-31`),
  ]);

  if (!unit) throw new Error("Unidad no encontrada");

  const basePrice = Number(unit.base_price ?? 0);
  const currency = unit.marketplace_currency ?? "ARS";
  const activeRules = (rules ?? []) as UnitPricingRule[];

  // Build set of booked dates
  const bookedDates = new Set<string>();
  for (const b of bookings ?? []) {
    let cursor = b.check_in_date;
    while (cursor < b.check_out_date) {
      bookedDates.add(cursor);
      cursor = addDaysIso(cursor, 1);
    }
  }

  // Generate prices for each day of the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: CalendarDayPrice[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateIso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const { price, rule } = priceForNight(dateIso, basePrice, activeRules);
    days.push({
      date: dateIso,
      price,
      ruleId: rule?.id ?? null,
      ruleName: rule?.name ?? null,
      hasBooking: bookedDates.has(dateIso),
    });
  }

  return { days, basePrice, currency };
}

export async function previewBookingPrice(unitId: string, checkIn: string, checkOut: string) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const [{ data: unit }, { data: rules }] = await Promise.all([
    admin
      .from("units")
      .select("base_price, cleaning_fee")
      .eq("id", unitId)
      .eq("organization_id", organization.id)
      .single(),
    admin
      .from("unit_pricing_rules")
      .select("*")
      .eq("unit_id", unitId)
      .eq("organization_id", organization.id)
      .eq("active", true),
  ]);

  if (!unit) throw new Error("Unidad no encontrada");

  return computePricing({
    checkInIso: checkIn,
    checkOutIso: checkOut,
    basePrice: Number(unit.base_price ?? 0),
    cleaningFee: unit.cleaning_fee,
    rules: (rules ?? []) as UnitPricingRule[],
  });
}
