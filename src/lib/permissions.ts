import { DEFAULT_ROLE_PERMISSIONS } from "./constants";
import type { UserRole } from "./types/database";

export type Action = "view" | "create" | "update" | "delete";
export type Resource =
  | "units"
  | "owners"
  | "bookings"
  | "guests"
  | "payments"
  | "tickets"
  | "cleaning"
  | "cash"
  | "settlements"
  | "concierge"
  | "amenities"
  | "ical"
  | "messaging"
  | "users"
  | "crm_inbox"
  | "crm_workflows"
  | "crm_rapidos"
  | "crm_config"
  | "parte_diario"
  | "date_marks";

export function can(role: UserRole, resource: Resource, action: Action = "view"): boolean {
  const perms = DEFAULT_ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms["*"]?.includes(action)) return true;
  return perms[resource]?.includes(action) ?? false;
}

export function canAny(role: UserRole, checks: Array<[Resource, Action?]>): boolean {
  return checks.some(([res, act]) => can(role, res, act ?? "view"));
}
