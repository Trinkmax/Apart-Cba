export const emailChangeNotifyOldTemplate = {
  subject: "Pedido de cambio de email en tu cuenta",
  text: (vars: { newEmail: string; cancelUrl: string }) => `Hola,

Recibimos un pedido de cambio de email para tu cuenta de rentOS.

El nuevo email solicitado es: ${vars.newEmail}

Si fuiste vos, no necesitás hacer nada — solo confirmá el cambio desde el link que enviamos al nuevo email.

Si NO fuiste vos, hacé click acá para CANCELAR el cambio:

${vars.cancelUrl}

Si lo cancelás, tu email actual queda sin cambios.

— rentOS Seguridad`,
};
