"use client";

import { SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * Alterna claro/escuro no shell interno (espelha o toggle do chat em
 * SidebarUserNav). Ícone ÚNICO (não depende do tema no render) → sem
 * descasamento de hidratação e sem setState-em-effect; a direção é decidida
 * no clique via `resolvedTheme`.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Alternar tema claro/escuro"
      title="Alternar tema"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunMoon className="h-4 w-4" />
    </Button>
  );
}
