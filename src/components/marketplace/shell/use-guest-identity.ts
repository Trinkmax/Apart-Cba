"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { todayIsoAR } from "@/lib/marketplace/pricing";

/**
 * Quién está mirando la web, resuelto en el navegador.
 *
 * El layout de la web es estático (no lee cookies en el server), así que el
 * header averigua la sesión acá: `auth.getSession()` es local (lee la cookie,
 * sin ir a la red) y el perfil de huésped se lee por RLS (`self_all`).
 *
 * - loading:   todavía no sabemos → placeholder neutro (sin parpadeo).
 * - anonymous: sin sesión → "Ingresar".
 * - guest:     huésped con perfil → avatar y menú.
 * - staff:     sesión del panel sin perfil de huésped → "Ir al panel".
 *
 * Nada de esto es una decisión de seguridad: cada página privada vuelve a
 * validar la sesión en el server.
 */
export type GuestIdentity =
  | { status: "loading" }
  | { status: "anonymous" }
  | {
      status: "guest";
      userId: string;
      name: string;
      firstName: string;
      initials: string;
      avatarUrl: string | null;
      hasActiveReservations: boolean;
    }
  | { status: "staff"; userId: string };

/** Evento para avisarle al header que la sesión cambió desde una Server Action. */
export const AUTH_CHANGED_EVENT = "apart:auth-changed";

/**
 * Las Server Actions de ingreso escriben la cookie en el server: el cliente de
 * Supabase del navegador no se entera solo. Llamalo después de ingresar/salir.
 */
export function notifyAuthChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/** "María José González" → "MG"; "ana" → "A". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

function fallbackName(session: Session): string {
  const meta = session.user.user_metadata as { full_name?: unknown } | undefined;
  if (typeof meta?.full_name === "string" && meta.full_name.trim()) return meta.full_name.trim();
  return session.user.email?.split("@")[0] ?? "Huésped";
}

export function useGuestIdentity(): GuestIdentity {
  const pathname = usePathname();
  const [identity, setIdentity] = useState<GuestIdentity>({ status: "loading" });
  // Usuario ya resuelto: evita releer el perfil en cada navegación o refresh de token.
  const resolvedFor = useRef<string | null | undefined>(undefined);
  const runId = useRef(0);

  const resolve = useCallback(async (session: Session | null, force = false) => {
    const user = session?.user ?? null;
    // Mismo criterio que el server: un email sin confirmar no cuenta como sesión.
    const userId = user && user.email_confirmed_at ? user.id : null;
    if (!force && resolvedFor.current === userId) return;
    resolvedFor.current = userId;
    const run = ++runId.current;

    if (!userId || !session) {
      setIdentity({ status: "anonymous" });
      return;
    }

    const supabase = createClient();
    const [profileRes, activeRes] = await Promise.all([
      supabase.from("guest_profiles").select("full_name, avatar_url").eq("user_id", userId).maybeSingle(),
      supabase
        .from("booking_requests")
        .select("id", { count: "exact", head: true })
        .eq("guest_user_id", userId)
        .in("status", ["pendiente", "aprobada"])
        .gte("check_out_date", todayIsoAR()),
    ]);
    if (run !== runId.current) return;

    if (!profileRes.error && !profileRes.data) {
      setIdentity({ status: "staff", userId });
      return;
    }
    const profile = profileRes.data as { full_name: string | null; avatar_url: string | null } | null;
    const name = profile?.full_name?.trim() || fallbackName(session);
    setIdentity({
      status: "guest",
      userId,
      name,
      firstName: name.split(/\s+/)[0] ?? name,
      initials: initialsOf(name),
      avatarUrl: profile?.avatar_url ?? null,
      hasActiveReservations: !activeRes.error && (activeRes.count ?? 0) > 0,
    });
  }, []);

  const recheck = useCallback(
    async (force = false) => {
      try {
        const { data } = await createClient().auth.getSession();
        await resolve(data.session, force);
      } catch {
        if (resolvedFor.current === undefined) setIdentity({ status: "anonymous" });
      }
    },
    [resolve],
  );

  // Suscripción a cambios de sesión del propio cliente (salir, otra pestaña, etc.).
  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return;
      // Nunca llamar a Supabase adentro del callback (puede trabarse): diferido.
      setTimeout(() => {
        void resolve(session, event === "USER_UPDATED");
      }, 0);
    });
    const onChanged = () => void recheck(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener(AUTH_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [recheck, resolve]);

  // Cada navegación vuelve a mirar la cookie (local, barato): así el header se
  // entera de un ingreso o una salida hechos por una Server Action + redirect.
  useEffect(() => {
    // Diferido: el estado se actualiza fuera del cuerpo del efecto.
    const t = window.setTimeout(() => void recheck(), 0);
    return () => window.clearTimeout(t);
  }, [pathname, recheck]);

  return identity;
}
