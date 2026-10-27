"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, ShieldCheck, KeyRound } from "lucide-react";
import { toast } from "sonner";

/**
 * Botão "Baixar evidências (.tar.gz)" + diálogo de step-up MFA. Compartilhado
 * pelo operador (apiBase="/api/evidence-bundle", enrollHref="/seguranca") e pelo
 * cliente (apiBase="/api/portal/evidence-bundle", enrollContent=<widget>).
 *
 * Fluxo: checa inscrição de TOTP → (inscrever | código) → verify → a autorização
 * curta volta num cookie httpOnly escopado ao download → dispara o download por
 * âncora (stream pro disco, sem teto de RAM do browser).
 */

const ERROR_MSG: Record<string, string> = {
  invalid_code: "Código inválido. Confira o app autenticador e tente de novo.",
  too_many_attempts: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  no_mfa_factor: "Você ainda não inscreveu um app autenticador (MFA).",
  rate_limit_unavailable: "Serviço de verificação indisponível no momento.",
  server_not_configured: "Serviço não configurado.",
  missing_fields: "Informe o código do app autenticador.",
};

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function EvidenceDownloadButton({
  engagementId,
  apiBase,
  enrollContent,
  enrollHref,
  label = "Baixar evidências",
  size = "sm",
  variant = "outline",
  className,
}: {
  engagementId: string;
  apiBase: string;
  enrollContent?: ReactNode;
  enrollHref?: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [initialEnroll, setInitialEnroll] = useState(false);
  const [checking, setChecking] = useState(false);

  const start = async () => {
    setChecking(true);
    try {
      const res = await fetch(`${apiBase}/mfa/status`, { cache: "no-store" });
      if (!res.ok) {
        toast.error("Não foi possível verificar o status do MFA.");
        return;
      }
      const data = (await res.json()) as { enrolled?: boolean };
      setInitialEnroll(!data.enrolled);
      setOpen(true);
    } catch {
      toast.error("Falha de rede ao verificar o MFA.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={checking}
        onClick={() => void start()}
      >
        {checking ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {label}
      </Button>
      <EvidenceDownloadDialog
        open={open}
        onOpenChange={setOpen}
        engagementId={engagementId}
        apiBase={apiBase}
        initialEnroll={initialEnroll}
        enrollContent={enrollContent}
        enrollHref={enrollHref}
      />
    </>
  );
}

function EvidenceDownloadDialog({
  open,
  onOpenChange,
  engagementId,
  apiBase,
  initialEnroll,
  enrollContent,
  enrollHref,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  engagementId: string;
  apiBase: string;
  initialEnroll: boolean;
  enrollContent?: ReactNode;
  enrollHref?: string;
}) {
  const [enrollStep, setEnrollStep] = useState(initialEnroll);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ao (re)abrir — padrão "ajustar estado em render" (sem effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setEnrollStep(initialEnroll);
      setCode("");
      setError(null);
      setBusy(false);
    }
  }

  const verifyAndDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/mfa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, code: code.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "no_mfa_factor") {
          setEnrollStep(true);
          return;
        }
        setError(ERROR_MSG[data.error ?? ""] ?? "Não foi possível verificar.");
        return;
      }
      // Autorização no cookie → dispara o download (stream direto pro disco).
      triggerDownload(`${apiBase}/${engagementId}/download`);
      toast.success("Download iniciado — o pacote será baixado em instantes.");
      onOpenChange(false);
    } catch {
      setError("Falha de rede. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Baixar evidências
          </DialogTitle>
          <DialogDescription>
            Para baixar o pacote de evidências (.tar.gz) é exigida uma
            confirmação por MFA (app autenticador).
          </DialogDescription>
        </DialogHeader>

        {enrollStep ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Você ainda não tem um app autenticador (MFA) inscrito. Inscreva um
              TOTP e depois continue.
            </p>
            {enrollContent}
            {enrollHref && (
              <a
                href={enrollHref}
                className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                Abrir segurança da conta
              </a>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  setEnrollStep(false);
                  setError(null);
                }}
              >
                Já inscrevi, continuar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Código do app autenticador
            </label>
            <Input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="text-center font-mono tracking-[0.3em]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim().length >= 6 && !busy) {
                  void verifyAndDownload();
                }
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              {enrollHref ? (
                <a
                  href={enrollHref}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Gerenciar MFA
                </a>
              ) : (
                <span />
              )}
              <Button
                size="sm"
                disabled={busy || code.trim().length < 6}
                onClick={() => void verifyAndDownload()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Verificar e baixar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
