"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Save, TestTube2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader, Callout } from "./_ui";

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
    <Card>
      <CardContent className="space-y-4">
        <SectionHeader
          icon={Sparkles}
          title="Boas-vindas automático"
          description="Enviado uma vez, no primeiro acesso de cada convidado (quando entra e vira ativo)."
          action={<Switch checked={enabled} onCheckedChange={setEnabled} />}
        />

        {!emailConfigured && (
          <Callout tone="warning" icon={AlertTriangle}>
            RESEND_API_KEY não configurada — não será enviado até existir.
          </Callout>
        )}

        <div className="space-y-3">
          <Input
            placeholder="Assunto"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            placeholder="Mensagem"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
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
      </CardContent>
    </Card>
  );
}
