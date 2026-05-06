export const twoFactorDisabledTemplate = {
  subject: "Desactivaste verificación en dos pasos",
  text: (vars: { occurredAt: string }) => `Hola,

Desactivaste la verificación en dos pasos (2FA) en tu cuenta de Apart Cba el ${vars.occurredAt}.

A partir de ahora vamos a pedir solamente tu contraseña para entrar.

Si NO fuiste vos, contactanos urgente y volvé a activar 2FA cuando puedas.

— Apart Cba Seguridad`,
};
