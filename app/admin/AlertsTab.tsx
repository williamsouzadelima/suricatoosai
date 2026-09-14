"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Send,
  Save,
  Mail,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader, Callout, formatDateTime } from "./_ui";

interface Settings {
  teams_enabled: boolean;
  teams_webhook_url?: string;
  email_enabled: boolean;
  email_to?: string;
  updated_by?: string;
  updated_at?: number;
}

export function AlertsTab({ adminEmail }: { adminEmail: string }) {
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [teamsUrl, setTeamsUrl] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [updatedBy, setUpdatedBy] = useState<string | undefined>();
  const [updatedAt, setUpdatedAt] = useState<number | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/monitor", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const s: Settings = data.settings ?? {};
      setTeamsEnabled(Boolean(s.teams_enabled));
      setTeamsUrl(s.teams_webhook_url ?? "");
      setEmailEnabled(Boolean(s.email_enabled));
      setEmailTo(s.email_to ?? adminEmail);
      setEmailConfigured(Boolean(data.emailConfigured));
      setUpdatedBy(s.updated_by);
      setUpdatedAt(s.updated_at);
    } catch (error) {
      toast.error("Falha ao carregar configurações de alerta.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [adminEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentSettings = () => ({
    teams_enabled: teamsEnabled,
    teams_webhook_url: teamsUrl.trim(),
    email_enabled: emailEnabled,
    email_to: emailTo.trim(),
  });

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", settings: currentSettings() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Configurações salvas.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsEnabled, teamsUrl, emailEnabled, emailTo, load]);

  const test = useCallback(async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", settings: currentSettings() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const results: Record<string, string> = data.results ?? {};
      const lines = Object.entries(results).map(
        ([ch, r]) => `${ch}: ${r === "ok" ? "✅ enviado" : `❌ ${r}`}`,
      );
      const allOk = Object.values(results).every((r) => r === "ok");
      if (allOk) toast.success(`Teste enviado — ${lines.join(" · ")}`);
      else toast.error(`Teste com falhas — ${lines.join(" · ")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no teste.");
    } finally {
      setTesting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsEnabled, teamsUrl, emailEnabled, emailTo]);

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent>
          <SectionHeader
            icon={Bell}
            title="Alertas de saúde"
            description="O monitor checa site, Convex, serviços e recursos a cada ~3 min e avisa quando algo cai (e quando volta). Escolha os canais."
          />
        </CardContent>
      </Card>

      {/* Teams */}
      <Card>
        <CardContent className="space-y-4">
          <SectionHeader
            icon={MessageSquare}
            title="Microsoft Teams"
            action={
              <Switch checked={teamsEnabled} onCheckedChange={setTeamsEnabled} />
            }
          />
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              URL do webhook (Teams → canal → … → Workflows/Incoming Webhook)
            </label>
            <Input
              type="url"
              placeholder="https://…webhook.office.com/…  ou  https://prod-…logic.azure.com/…"
              value={teamsUrl}
              onChange={(e) => setTeamsUrl(e.target.value)}
              disabled={!teamsEnabled}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardContent className="space-y-4">
          <SectionHeader
            icon={Mail}
            title="E-mail"
            action={
              <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
            }
          />
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Enviar para
            </label>
            <Input
              type="email"
              placeholder="voce@empresa.com"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              disabled={!emailEnabled}
              className="mt-1"
            />
          </div>
          {!emailConfigured && (
            <Callout tone="warning" icon={AlertTriangle}>
              RESEND_API_KEY não está configurada no servidor — o e-mail não será
              enviado até ela existir.
            </Callout>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          <Save className="h-4 w-4" />
          {saving ? "Salvando…" : "Salvar"}
        </Button>
        <Button variant="outline" onClick={() => void test()} disabled={testing}>
          <Send className="h-4 w-4" />
          {testing ? "Enviando…" : "Enviar teste"}
        </Button>
        {updatedAt && (
          <span className="text-xs tabular-nums text-muted-foreground">
            Última alteração: {formatDateTime(updatedAt)}
            {updatedBy ? ` · ${updatedBy}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
