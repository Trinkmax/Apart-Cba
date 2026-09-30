/**
 * Errores de Supabase Auth traducidos a lo que tiene que leer el huésped
 * (es-AR, voseo). Nunca mostramos el mensaje crudo en inglés. Puro y testeado.
 */
export type AuthErrorKind =
  | "already_registered"
  | "email_not_confirmed"
  | "invalid_credentials"
  | "weak_password"
  | "same_password"
  | "rate_limited"
  | "signup_disabled"
  | "invalid_email"
  | "email_not_authorized"
  | "link_expired"
  | "unknown";

export type AuthContext = "signup" | "signin" | "reset" | "resend" | "update_password";

export interface AuthErrorLike {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}

export const AUTH_MESSAGES: Record<Exclude<AuthErrorKind, "unknown">, string> = {
  already_registered: "Ya hay una cuenta con ese email. Ingresá o recuperá la contraseña.",
  email_not_confirmed: "Todavía no confirmaste tu email. Te reenviamos el link.",
  invalid_credentials: "Email o contraseña incorrectos.",
  weak_password: "Esa contraseña es muy fácil de adivinar. Usá al menos 8 caracteres y mezclá letras y números.",
  same_password: "Elegí una contraseña distinta de la anterior.",
  rate_limited: "Hubo demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.",
  signup_disabled: "Por ahora no se pueden crear cuentas nuevas. Podés pedir tu reserva sin cuenta.",
  invalid_email: "Revisá el email: parece que tiene un error.",
  email_not_authorized: "No pudimos mandar el mail a esa dirección. Probá con otro email.",
  link_expired: "El link venció o ya se usó. Pedí uno nuevo.",
};

const FALLBACKS: Record<AuthContext, string> = {
  signup: "No pudimos crear la cuenta. Probá de nuevo en unos minutos.",
  signin: "No pudimos ingresar. Probá de nuevo en unos minutos.",
  reset: "No pudimos mandarte el mail. Probá de nuevo en unos minutos.",
  resend: "No pudimos reenviar el mail. Probá de nuevo en unos minutos.",
  update_password: "No pudimos cambiar la contraseña. Pedí un link nuevo e intentá otra vez.",
};

/** Clasifica un error de Supabase Auth por su `code`, y si no, por el texto. */
export function classifyAuthError(error: AuthErrorLike | null | undefined): AuthErrorKind {
  if (!error) return "unknown";
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();

  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered/.test(msg)) {
    return "already_registered";
  }
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "email_not_confirmed";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "invalid_credentials";
  if (code === "same_password" || msg.includes("different from the old password")) return "same_password";
  if (
    code === "weak_password" ||
    /password should|password is known|weak password|easy to guess|pwned/.test(msg)
  ) {
    return "weak_password";
  }
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    code === "over_sms_send_rate_limit" ||
    error.status === 429 ||
    /rate limit|too many requests|security purposes/.test(msg)
  ) {
    return "rate_limited";
  }
  if (code === "signup_disabled" || /signups? not allowed|signup is disabled/.test(msg)) return "signup_disabled";
  if (code === "email_address_invalid" || /invalid format|unable to validate email|invalid email/.test(msg)) {
    return "invalid_email";
  }
  if (code === "email_address_not_authorized" || msg.includes("not authorized")) return "email_not_authorized";
  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    code === "flow_state_not_found" ||
    code === "session_expired" ||
    code === "session_not_found" ||
    code === "bad_code_verifier" ||
    /expired|invalid.*(token|code)/.test(msg)
  ) {
    return "link_expired";
  }
  return "unknown";
}

/** Mensaje para la persona según el error y la pantalla donde pasó. */
export function authErrorMessage(error: AuthErrorLike | null | undefined, context: AuthContext): string {
  const kind = classifyAuthError(error);
  return kind === "unknown" ? FALLBACKS[context] : AUTH_MESSAGES[kind];
}
