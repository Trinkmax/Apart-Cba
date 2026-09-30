import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES, authErrorMessage, classifyAuthError } from "../auth-errors";

describe("classifyAuthError", () => {
  it("usa el code de Supabase cuando viene", () => {
    expect(classifyAuthError({ code: "user_already_exists" })).toBe("already_registered");
    expect(classifyAuthError({ code: "email_not_confirmed" })).toBe("email_not_confirmed");
    expect(classifyAuthError({ code: "invalid_credentials" })).toBe("invalid_credentials");
    expect(classifyAuthError({ code: "weak_password" })).toBe("weak_password");
    expect(classifyAuthError({ code: "over_email_send_rate_limit" })).toBe("rate_limited");
    expect(classifyAuthError({ code: "signup_disabled" })).toBe("signup_disabled");
    expect(classifyAuthError({ code: "otp_expired" })).toBe("link_expired");
    expect(classifyAuthError({ code: "same_password" })).toBe("same_password");
  });

  it("cae al texto en inglés si no hay code", () => {
    expect(classifyAuthError({ message: "User already registered" })).toBe("already_registered");
    expect(classifyAuthError({ message: "Email not confirmed" })).toBe("email_not_confirmed");
    expect(classifyAuthError({ message: "Invalid login credentials" })).toBe("invalid_credentials");
    expect(classifyAuthError({ message: "Password should be at least 8 characters." })).toBe("weak_password");
    expect(classifyAuthError({ message: "email rate limit exceeded" })).toBe("rate_limited");
    expect(classifyAuthError({ message: "For security purposes, you can only request this after 42 seconds." })).toBe(
      "rate_limited",
    );
    expect(classifyAuthError({ message: "Signups not allowed for this instance" })).toBe("signup_disabled");
    expect(classifyAuthError({ message: "Unable to validate email address: invalid format" })).toBe("invalid_email");
    expect(classifyAuthError({ status: 429, message: "x" })).toBe("rate_limited");
  });

  it("desconocido si no reconoce nada", () => {
    expect(classifyAuthError(null)).toBe("unknown");
    expect(classifyAuthError({ message: "Database error saving new user" })).toBe("unknown");
  });
});

describe("authErrorMessage", () => {
  it("devuelve el texto en español del caso", () => {
    expect(authErrorMessage({ message: "User already registered" }, "signup")).toBe(AUTH_MESSAGES.already_registered);
    expect(authErrorMessage({ code: "email_not_confirmed" }, "signin")).toBe(
      "Todavía no confirmaste tu email. Te reenviamos el link.",
    );
  });

  it("usa un genérico por pantalla, nunca el inglés crudo", () => {
    const msg = authErrorMessage({ message: "Database error saving new user" }, "signup");
    expect(msg).toBe("No pudimos crear la cuenta. Probá de nuevo en unos minutos.");
    expect(authErrorMessage({ message: "boom" }, "reset")).toMatch(/^No pudimos mandarte el mail/);
  });
});
