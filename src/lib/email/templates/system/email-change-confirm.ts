export const emailChangeConfirmTemplate = {
  subject: "Confirmá tu nuevo email",
  text: (vars: { confirmUrl: string; expiresAt: string }) => `Hola,

Recibimos un pedido para cambiar el email de tu cuenta de Apart Cba.

Hacé click en este link para confirmar el cambio:

${vars.confirmUrl}

El link expira el ${vars.expiresAt}.

Si NO pediste este cambio, podés ignorar este mensaje.

— Apart Cba Seguridad`,
};
