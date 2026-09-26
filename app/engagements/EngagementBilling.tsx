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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  SectionHeader,
  StatCard,
  StatusBadge,
  type Tone,
} from "@/app/admin/_ui";

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

  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);

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
                        if (window.confirm(`Excluir a fatura "${inv.label}"?`))
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
  );
}
