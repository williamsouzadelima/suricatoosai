"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Palette, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/app/admin/_ui";
import { DEFAULT_BRAND } from "@/lib/reports/report-model";

type BrandForm = {
  name: string;
  wordmark: string;
  docCodePrefix: string;
  primary: string; // "#rrggbb"
  accent: string; // "#rrggbb"
  contact: string;
  tagline: string;
  classification: string;
};

const withHash = (hex?: string | null, fallback = "") =>
  hex ? (hex.startsWith("#") ? hex : `#${hex}`) : fallback;

const EMPTY: BrandForm = {
  name: "",
  wordmark: "",
  docCodePrefix: "",
  primary: withHash(DEFAULT_BRAND.primary),
  accent: withHash(DEFAULT_BRAND.accent),
  contact: "",
  tagline: "",
  classification: "",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex-1">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function ReportBrandCard() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<BrandForm>(EMPTY);

  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    fetch("/api/report-brand")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        const b = data?.brand;
        if (b) {
          setForm({
            name: b.name ?? "",
            wordmark: b.wordmark ?? "",
            docCodePrefix: b.docCodePrefix ?? "",
            primary: withHash(b.primary, withHash(DEFAULT_BRAND.primary)),
            accent: withHash(b.accent, withHash(DEFAULT_BRAND.accent)),
            contact: b.contact ?? "",
            tagline: b.tagline ?? "",
            classification: b.classification ?? "",
          });
        }
        setLoaded(true);
      })
      .catch(() => toast.error("Falha ao carregar a marca."))
      .finally(() => setLoading(false));
  }, [open, loaded]);

  const set = (k: keyof BrandForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/report-brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Marca salva. Vale para os próximos relatórios gerados.");
    } catch (e) {
      toast.error("Falha ao salvar a marca.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const wordmark = form.wordmark || form.name || DEFAULT_BRAND.wordmark;
  const prefix = form.docCodePrefix || DEFAULT_BRAND.docCodePrefix;
  const classification = form.classification || DEFAULT_BRAND.classification;

  return (
    <Card className="gap-0 py-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between p-5 text-left"
      >
        <SectionHeader
          icon={Palette}
          title="Marca dos relatórios"
          description="Logo/nome, cores, contato e prefixo do código do documento. Vazio = padrão Suricatoos."
        />
        {open ? (
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <CardContent className="flex flex-col gap-4 border-t p-5">
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Field
                  label="Nome do MSSP"
                  value={form.name}
                  onChange={set("name")}
                  placeholder={DEFAULT_BRAND.name}
                />
                <Field
                  label="Marca curta (wordmark)"
                  value={form.wordmark}
                  onChange={set("wordmark")}
                  placeholder={DEFAULT_BRAND.wordmark}
                />
                <Field
                  label="Prefixo do código"
                  value={form.docCodePrefix}
                  onChange={set("docCodePrefix")}
                  placeholder={DEFAULT_BRAND.docCodePrefix}
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Cor primária
                  </label>
                  <input
                    type="color"
                    value={form.primary}
                    onChange={(e) => set("primary")(e.target.value)}
                    className="h-9 w-16 cursor-pointer rounded-md border bg-background"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Cor de destaque
                  </label>
                  <input
                    type="color"
                    value={form.accent}
                    onChange={(e) => set("accent")(e.target.value)}
                    className="h-9 w-16 cursor-pointer rounded-md border bg-background"
                  />
                </div>
                <Field
                  label="Contato"
                  value={form.contact}
                  onChange={set("contact")}
                  placeholder={DEFAULT_BRAND.contact ?? "comercial@exemplo.com"}
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Field
                  label="Assinatura (tagline)"
                  value={form.tagline}
                  onChange={set("tagline")}
                  placeholder={DEFAULT_BRAND.tagline ?? ""}
                />
                <Field
                  label="Classificação"
                  value={form.classification}
                  onChange={set("classification")}
                  placeholder={DEFAULT_BRAND.classification}
                />
              </div>

              {/* Prévia da capa */}
              <div
                className="rounded-lg p-4"
                style={{ backgroundColor: "#0E1B2E" }}
              >
                <div
                  className="text-sm font-bold"
                  style={{ color: form.accent }}
                >
                  {wordmark}
                </div>
                <div
                  className="mt-0.5 text-[10px] font-semibold tracking-wide"
                  style={{ color: form.accent }}
                >
                  {classification} · {prefix}-PTI-2026-0042
                </div>
                <div className="mt-3 text-lg font-bold text-white">
                  Relatório Executivo de Pentest
                </div>
                <div className="mt-1 text-xs" style={{ color: "#C9D3E6" }}>
                  Cliente — Engajamento
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Palette className="h-4 w-4" />
                  )}
                  Salvar marca
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
