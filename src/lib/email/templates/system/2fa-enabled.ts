export const twoFactorEnabledTemplate = {
  subject: "Activaste verificación en dos pasos",
  text: (vars: { occurredAt: string }) => `Hola,

Activaste correctamente la verificación en dos pasos (2FA) en tu cuenta de Apart Cba el ${vars.occurredAt}.

A partir de ahora, además de tu contraseña te vamos a pedir un código de 6 dígitos generado por tu app de autenticación.

Si NO fuiste vos, contactanos urgente.

— Apart Cba Seguridad`,
};
