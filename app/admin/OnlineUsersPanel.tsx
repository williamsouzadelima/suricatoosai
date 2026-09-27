"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio, Users, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionHeader, StatCard, EmptyState, fmtDuration } from "./_ui";

interface PresenceUser {
  userId: string;
  email: string;
  lastSeenAt: number;
  status: "online" | "idle";
  path: string | null;
}
interface Presence {
  online: number;
  idle: number;
  users: PresenceUser[];
}

function cleanPath(p: string | null): string {
  if (!p) return "";
  if (p === "/") return "início";
  return p.replace(/^\//, "").split("/")[0];
}

export function OnlineUsersPanel() {
  const [data, setData] = useState<Presence | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/presence", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setNow(Date.now());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const users = data?.users ?? [];

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          icon={Radio}
          title="Usuários online"
          description="Presença ao vivo (heartbeat do navegador). Atualiza a cada 30s."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </div>

      <CardContent className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Radio}
            tone={data && data.online > 0 ? "success" : "neutral"}
            label="Online agora"
            value={loading ? 0 : (data?.online ?? 0)}
            sub="visto há < 2 min"
            loading={loading}
          />
          <StatCard
            icon={Users}
            tone={data && data.idle > 0 ? "warning" : "neutral"}
            label="Ausentes"
            value={loading ? 0 : (data?.idle ?? 0)}
            sub="visto há < 12 min"
            loading={loading}
          />
        </div>

        {!loading && users.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="Ninguém online agora."
            description="A presença aparece quando alguém abre a plataforma."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {users.map((u) => (
              <div
                key={u.userId}
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {u.status === "online" && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                    )}
                    <span
                      className={cn(
                        "relative inline-flex h-2.5 w-2.5 rounded-full",
                        u.status === "online" ? "bg-success" : "bg-warning",
                      )}
                    />
                  </span>
                  <span className="truncate font-medium">{u.email}</span>
                </div>
                <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {u.status === "online" ? (
                    <span className="text-success">online</span>
                  ) : (
                    <span>há {fmtDuration(now - u.lastSeenAt)}</span>
                  )}
                  {u.path && (
                    <span className="ml-2 hidden font-mono sm:inline">
                      {cleanPath(u.path)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
