"use client";

import { useCallback } from "react";
import { useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { UserSecurity } from "@workos-inc/widgets/user-security";
import { WorkOsWidgets } from "@workos-inc/widgets/workos-widgets";

/**
 * Widget de segurança da conta do WorkOS (senha, MFA/TOTP, sessões). FONTE ÚNICA
 * da inscrição de MFA — usado no /seguranca (operador) e no portal do cliente.
 * O cliente é org-less no WorkOS, mas é usuário WorkOS e o AuthKitProvider
 * embrulha o portal, então `getAccessToken()` devolve um token válido lá também.
 */
export function MfaEnrollmentWidget() {
  const { getAccessToken } = useAccessToken();
  const getWidgetAccessToken = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error("Não foi possível carregar a segurança da conta.");
    }
    return token;
  }, [getAccessToken]);

  return (
    <div data-testid="workos-user-security">
      <WorkOsWidgets
        style={{ blockSize: "auto", minBlockSize: "auto" }}
        theme={{
          appearance: "dark",
          // Acento da marca (coral). "gray" fazia os botões de ação do widget
          // (ex. "Definir senha") renderizarem sem contraste no card escuro,
          // parecendo caixas cinza vazias.
          accentColor: "tomato",
          grayColor: "slate",
          hasBackground: false,
          fontFamily: "var(--font-geist-sans)",
        }}
      >
        <UserSecurity authToken={getWidgetAccessToken} />
      </WorkOsWidgets>
    </div>
  );
}
