"use client";

import Link from "next/link";
import { Menu, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { SuricatoosAISVG } from "@/components/icons/suricatoos-ai-svg";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { visibleNav, type ActiveKey } from "./app-nav";

// Mobile nav drawer for the internal shell: the desktop sidebar is hidden below
// `md`, so without this the operator/admin have no way to change sections on a
// phone. A hamburger in the topbar opens the same NAV in a left Sheet; tapping
// an item closes the sheet (SheetClose) and navigates.
export function MobileNav({
  active,
  isSuperadmin,
}: {
  active: ActiveKey;
  isSuperadmin?: boolean;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 shrink-0 md:hidden"
          aria-label="Abrir navegação"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="internal-sidebar w-[264px] gap-0 border-r-0 p-0 text-chrome-fg"
      >
        <SheetHeader className="gap-1.5 px-4 pb-1 pt-4">
          <SuricatoosAISVG theme="dark" scale={0.135} />
          <SheetTitle className="sr-only">Navegação</SheetTitle>
          <span className="pl-0.5 text-[11px] font-medium tracking-wide text-chrome-fg-dim">
            Offensive Security
          </span>
        </SheetHeader>
        <nav className="flex flex-col gap-1 overflow-y-auto px-3.5 pb-5">
          {visibleNav(isSuperadmin ?? false).map((g) => (
            <div key={g.group}>
              <div className="px-2.5 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-chrome-fg-faint">
                {g.group}
              </div>
              {g.items.map((it) => {
                const Icon = it.icon;
                const isActive = active === it.key;
                return (
                  <SheetClose asChild key={it.key}>
                    <Link
                      href={it.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
                        isActive
                          ? "bg-primary/20 text-white shadow-[inset_0_0_0_1px_rgba(93,132,240,0.28)]"
                          : "text-chrome-fg-muted hover:bg-white/5 hover:text-chrome-active-fg",
                      )}
                    >
                      <Icon className="h-[17px] w-[17px] shrink-0 opacity-90" />
                      {it.label}
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
          ))}
          <SheetClose asChild>
            <Link
              href="/"
              className="mt-2 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13px] font-medium text-chrome-fg-dim transition-colors hover:bg-white/5 hover:text-chrome-active-fg"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar ao app
            </Link>
          </SheetClose>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
