"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Receipt,
  Plus,
  Trash2,
  DollarSign,
  Coins,
  Percent,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  SectionHeader,
  StatCard,
  StatusBadge,
  type Tone,
} from "@/app/admin/_ui";
import { PortalAccessCard } from "./PortalAccessCard";

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Rascunho" },
  sent: { tone: "warning", label: "Enviada" },
  paid: { tone: "success", label: "Paga" },
  void: { tone: "neutral", label: "Anulada" },
};

function fmtMoney(n: number, currency: string): string {
  const v = n >= 1 || n <= -1 ? n.toFixed(2) : n.toFixed(4);
  return `${currency} ${v}`;
}

interface Invoice {
  _id: Id<"engagement_invoices">;
  label: string;
  amount_dollars: number;
  currency: string;
  status: string;
  created_at: number;
  note?: string;
}

export function EngagementBilling({
  engagementId,
}: {
  engagementId: Id<"engagements">;
}) {
  const billing = useQuery(api.engagements.getEngagementBilling, {
    engagementId,
  });
  const invoices = useQuery(api.engagements.listInvoicesForEngagement, {
    engagementId,
  }) as Invoice[] | undefined;
  const createInvoice = useMutation(api.engagements.createInvoice);
  const setStatus = useMutation(api.engagements.setInvoiceStatus);
  const removeInvoice = useMutation(api.engagements.deleteInvoice);
  const setBudget = useMutation(api.engagements.setEngagementBudget);

  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [capInput, setCapInput] = useState("");
  const [warnInput, setWarnInput] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);

  const saveBudget = async () => {
    const cap =
      capInput.trim() === "" ? (billing?.capDollars ?? 0) : Number(capInput);
    const warn =
      warnInput.trim() === "" ? (billing?.warnPct ?? 80) : Number(warnInput);
    if (!Number.isFinite(cap) || cap < 0) {
      toast.error("Teto inválido.");
      return;
    }
    setSavingBudget(true);
    try {
      await setBudget({ engagementId, capDollars: cap, warnPct: warn });
      setCapInput("");
      setWarnInput("");
      toast.success(cap > 0 ? "Teto salvo." : "Teto removido.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o teto.");
    } finally {
      setSavingBudget(false);
    }
  };

  const cur = billing?.currency ?? currency;

  const add = async () => {
    const amt = Number(amount);
    if (!label.trim() || !Number.isFinite(amt) || amt < 0) {
      toast.error("Preencha descrição e valor válido.");
      return;
    }
    setBusy(true);
    try {
      await createInvoice({
        engagementId,
        label: label.trim(),
        amountDollars: amt,
        currency: currency.trim() || "USD",
      });
      setLabel("");
      setAmount("");
      toast.success("Fatura criada (rascunho).");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar fatura.");
    } finally {
      setBusy(false);
    }
  };

  const marginTone: Tone =
    billing && billing.margin >= 0 ? "success" : "destructive";

  return (
    <div className="space-y-5">
      <Card className="gap-0 py-0">
        <div className="border-b p-5">
          <SectionHeader
            icon={Receipt}
            title="Faturamento"
            description="Receita faturada × custo de IA do engajamento → margem. Preço é placeholder (scaffold)."
          />
        </div>
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              icon={DollarSign}
              tone="success"
              label="Faturado"
              value={billing ? fmtMoney(billing.invoiced, cur) : "—"}
              sub={
                billing
                  ? `${fmtMoney(billing.paid, cur)} pago · ${fmtMoney(
                      billing.sent,
                      cur,
                    )} enviado`
                  : undefined
              }
              loading={billing === undefined}
            />
            <StatCard
              icon={Coins}
              tone="primary"
              label="Custo IA"
              value={billing ? fmtMoney(billing.cost, "USD") : "—"}
              sub={
                billing?.costCapped
                  ? "limite de leitura atingido"
                  : "linhas com engagement_id"
              }
              loading={billing === undefined}
            />
            <StatCard
              icon={Percent}
              tone={marginTone}
              label="Margem"
              value={billing ? fmtMoney(billing.margin, cur) : "—"}
              sub="faturado − custo (ignora câmbio)"
              loading={billing === undefined}
            />
          </div>

          {/* Teto de custo de IA (monitor, sem enforcement) */}
          {(() => {
            const cap = billing?.capDollars ?? 0;
            const cost = billing?.cost ?? 0;
            const warnPct = billing?.warnPct ?? 80;
            const pct = cap > 0 ? (cost / cap) * 100 : 0;
            const over = cap > 0 && cost >= cap;
            const warn = cap > 0 && !over && cost >= (cap * warnPct) / 100;
            const barTone = over
              ? "bg-destructive"
              : warn
                ? "bg-warning"
                : "bg-success";
            return (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Teto de custo de IA
                  </span>
                  {cap > 0 ? (
                    <StatusBadge
                      tone={over ? "destructive" : warn ? "warning" : "success"}
                      label={`${over ? "estourou" : warn ? "aviso" : "ok"} · ${pct.toFixed(0)}%`}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      sem teto
                    </span>
                  )}
                </div>
                {cap > 0 && (
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", barTone)}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="w-32">
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Teto (USD)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={capInput}
                      onChange={(e) => setCapInput(e.target.value)}
                      placeholder={cap > 0 ? cap.toFixed(2) : "0.00"}
                    />
                  </div>
                  <div className="w-24">
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Aviso (%)
                    </label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={warnInput}
                      onChange={(e) => setWarnInput(e.target.value)}
                      placeholder={String(warnPct)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void saveBudget()}
                    disabled={savingBudget}
                  >
                    Salvar teto
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Monitor apenas — não bloqueia runs. Teto 0 remove o monitor.
                </p>
              </div>
            );
          })()}

          {/* Nova fatura */}
          <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Descrição
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ex.: Pentest Web — parcela 1"
              />
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs text-muted-foreground">
                Valor
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="w-20">
              <label className="mb-1 block text-xs text-muted-foreground">
                Moeda
              </label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={4}
              />
            </div>
            <Button onClick={() => void add()} disabled={busy}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {/* Lista */}
          {invoices && invoices.length > 0 ? (
            <div className="overflow-hidden rounded-lg border">
              {invoices.map((inv) => {
                const st = STATUS[inv.status] ?? STATUS.draft;
                return (
                  <div
                    key={inv._id}
                    className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-sm last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {inv.label}
                    </span>
                    <span className="tabular-nums">
                      {fmtMoney(inv.amount_dollars, inv.currency)}
                    </span>
                    <StatusBadge tone={st.tone} label={st.label} />
                    <div className="flex gap-1">
                      {inv.status !== "sent" && inv.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void setStatus({
                              invoiceId: inv._id,
                              status: "sent",
                            })
                          }
                        >
                          Enviar
                        </Button>
                      )}
                      {inv.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void setStatus({
                              invoiceId: inv._id,
                              status: "paid",
                            })
                          }
                        >
                          Pago
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (
                            window.confirm(`Excluir a fatura "${inv.label}"?`)
                          )
                            void removeInvoice({ invoiceId: inv._id });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma fatura ainda. Crie a primeira acima.
            </p>
          )}
        </CardContent>
      </Card>
      {billing?.clientId && (
        <PortalAccessCard
          clientId={billing.clientId}
          clientName={billing.clientName}
          portalEnabled={billing.portalEnabled}
        />
      )}
    </div>
  );
}
