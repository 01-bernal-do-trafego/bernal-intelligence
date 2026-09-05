"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Sparkles,
  LayoutTemplate,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/clients", label: "Clientes", icon: Users },
  { href: "/intelligence", label: "Intelligence", icon: Sparkles, soon: true },
  { href: "/templates", label: "Templates", icon: LayoutTemplate, soon: true },
  { href: "/settings", label: "Configurações", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Backdrop (apenas mobile) */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/60 lg:hidden",
          open ? "block" : "hidden",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-transform duration-200",
          "lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <span className="size-2.5 rounded-full bg-accent" />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Bernal Intelligence
          </span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon, soon }) => {
            const active = isActive(pathname, href);
            const inner = (
              <>
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {soon && (
                  <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted">
                    Em breve
                  </span>
                )}
              </>
            );
            // Itens "Em breve" não navegam — não há página para o usuário usar.
            if (soon) {
              return (
                <div
                  key={href}
                  aria-disabled="true"
                  title="Disponível em uma próxima entrega"
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted/70"
                >
                  {inner}
                </div>
              );
            }
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-elevated hover:text-foreground",
                )}
              >
                {inner}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4 text-xs text-muted">
          Bernal do Tráfego · v0.1
        </div>
      </aside>
    </>
  );
}
