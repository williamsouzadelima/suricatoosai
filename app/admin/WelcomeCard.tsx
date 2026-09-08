"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Save, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function WelcomeCard() {
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/onboarding", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const s = data.settings ?? {};
      setEnabled(Boolean(s.enabled));
      setSubject(s.subject ?? "");
      setBody(s.body ?? "");
      setEmailConfigured(Boolean(data.emailConfigured));
      setAdminEmail(data.adminEmail ?? null);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const payload = () => ({ enabled, subject: subject.trim(), body: body.trim() });

  const save = useCallback(async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Assunto e mensagem são obrigatórios.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", ...payload() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(
        enabled
          ? "Boas-vindas salvo e ativado."
          : "Boas-vindas salvo (desativado).",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, subject, body]);

  const test = useCallback(async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Assunto e mensagem são obrigatórios.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/admin/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", ...payload() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`Teste enviado para ${data.to}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no teste.");
    } finally {
      setTesting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body]);

  if (loading) return null;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Boas-vindas automático</h2>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Enviado uma vez, no primeiro acesso de cada convidado (quando entra e vira
        ativo).
      </p>

      {!emailConfigured && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          ⚠️ RESEND_API_KEY não configurada — não será enviado até existir.
        </p>
      )}

      <div className="mt-4 space-y-3">
        <Input
          placeholder="Assunto"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <textarea
          placeholder="Mensagem"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Salvando…" : "Salvar"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void test()}
            disabled={testing}
          >
            <TestTube2 className="h-4 w-4" />
            {testing ? "Enviando…" : `Teste${adminEmail ? ` (p/ ${adminEmail})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
