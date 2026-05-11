export const passwordChangedTemplate = {
  subject: "Tu contraseña fue actualizada",
  text: (vars: { occurredAt: string }) => `Hola,

Te avisamos que tu contraseña de Apart Cba fue actualizada el ${vars.occurredAt}.

Si fuiste vos, ignorá este mensaje.

Si NO fuiste vos, contactanos urgente porque alguien podría haber accedido a tu cuenta.

— Apart Cba Seguridad`,
};
