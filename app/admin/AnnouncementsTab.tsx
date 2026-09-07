"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Plus, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Level = "info" | "warning" | "success";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: string;
  active: boolean;
  dismissible: boolean;
  starts_at?: number;
  ends_at?: number;
  cta_label?: string;
  cta_url?: string;
  created_by?: string;
  created_at: number;
  updated_at: number;
}

interface FormState {
  id: string | null;
  title: string;
  body: string;
  level: Level;
  active: boolean;
  dismissible: boolean;
  starts_at: string;
  ends_at: string;
  cta_label: string;
  cta_url: string;
}

const EMPTY: FormState = {
  id: null,
  title: "",
  body: "",
  level: "info",
  active: true,
  dismissible: true,
  starts_at: "",
  ends_at: "",
  cta_label: "",
  cta_url: "",
};

const LEVELS: { value: Level; label: string; badge: string }[] = [
  { value: "info", label: "Info", badge: "border-primary/30 bg-primary/10 text-primary" },
  { value: "warning", label: "Aviso", badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  { value: "success", label: "Sucesso", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
];

const toLocalInput = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
const toMs = (s: string): number | undefined => {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : undefined;
};
const fmt = (ms?: number) =>
  ms
    ? new Date(ms).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function AnnouncementsTab() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (error) {
      toast.error("Falha ao carregar avisos.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (a: Announcement) => {
    setForm({
      id: a.id,
      title: a.title,
      body: a.body,
      level: (["info", "warning", "success"].includes(a.level)
        ? a.level
        : "info") as Level,
      active: a.active,
      dismissible: a.dismissible,
      starts_at: toLocalInput(a.starts_at),
      ends_at: toLocalInput(a.ends_at),
      cta_label: a.cta_label ?? "",
      cta_url: a.cta_url ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = useCallback(async () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error("Título e mensagem são obrigatórios.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: form.id ? "update" : "create",
          id: form.id ?? undefined,
          announcement: {
            title: form.title.trim(),
            body: form.body.trim(),
            level: form.level,
            active: form.active,
            dismissible: form.dismissible,
            starts_at: toMs(form.starts_at),
            ends_at: toMs(form.ends_at),
            cta_label: form.cta_label.trim() || undefined,
            cta_url: form.cta_url.trim() || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(form.id ? "Aviso atualizado." : "Aviso criado.");
      setForm(EMPTY);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const act = useCallback(
    async (a: Announcement, action: "toggle" | "delete") => {
      if (
        action === "delete" &&
        !window.confirm(`Excluir o aviso "${a.title}"?`)
      ) {
        return;
      }
      setBusyId(a.id);
      try {
        const res = await fetch("/api/admin/announcements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            id: a.id,
            active: action === "toggle" ? !a.active : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        await load();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Falha na operação.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <div className="mt-6 space-y-4">
      {/* Form */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">
            {form.id ? "Editar aviso" : "Novo aviso"}
          </h2>
        </div>
        <div className="mt-4 space-y-3">
          <Input
            placeholder="Título"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            placeholder="Mensagem"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setForm({ ...form, level: l.value })}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    form.level === l.value
                      ? l.badge
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
              Ativo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.dismissible}
                onCheckedChange={(v) => setForm({ ...form, dismissible: v })}
              />
              Dispensável
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Início (opcional)
              </label>
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Fim (opcional)
              </label>
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="Texto do botão (opcional)"
              value={form.cta_label}
              onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
            />
            <Input
              type="url"
              placeholder="URL do botão (https://…)"
              value={form.cta_url}
              onChange={(e) => setForm({ ...form, cta_url: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              <Plus className="h-4 w-4" />
              {saving ? "Salvando…" : form.id ? "Salvar alterações" : "Criar aviso"}
            </Button>
            {form.id && (
              <Button variant="ghost" onClick={() => setForm(EMPTY)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="text-base font-semibold">
            Avisos
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {items.length}
            </span>
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhum aviso ainda. Crie um acima.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((a) => {
              const lvl = LEVELS.find((l) => l.value === a.level) ?? LEVELS[0];
              return (
                <li key={a.id} className="flex items-start gap-3 p-4">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${lvl.badge}`}
                  >
                    {lvl.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.title}</span>
                      {a.active ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          publicado
                        </span>
                      ) : (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          rascunho
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {a.body}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.starts_at || a.ends_at
                        ? `janela: ${fmt(a.starts_at)} → ${fmt(a.ends_at)} · `
                        : ""}
                      atualizado {fmt(a.updated_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === a.id}
                      onClick={() => void act(a, "toggle")}
                      title={a.active ? "Despublicar" : "Publicar"}
                    >
                      {a.active ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => edit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busyId === a.id}
                      onClick={() => void act(a, "delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
