import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/marketplace/auth-forms";
import { AuthShell } from "@/components/marketplace/shell/auth-shell";

export const metadata: Metadata = {
  title: "Nueva contraseña",
  robots: { index: false, follow: false },
};

/**
 * Vuelta del mail "Olvidé mi contraseña": /auth/callback canjea el link por
 * una sesión y trae acá. El formulario verifica la sesión en el navegador.
 */
export default function ResetPasswordPage() {
  return (
    <AuthShell quote="Llegar debe sentirse simple.">
      <ResetPasswordForm />
    </AuthShell>
  );
}
