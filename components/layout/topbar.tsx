"use client";

import { Menu, LogOut, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";

interface TopbarProps {
  onMenuClick: () => void;
  userEmail?: string;
  onSignOut?: () => void;
  /** Rótulo de contexto (ex.: "Modo demonstração"). */
  contextLabel?: string;
}

export function Topbar({
  onMenuClick,
  userEmail,
  onSignOut,
  contextLabel,
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menu"
        className="rounded-md p-2 text-muted transition-colors hover:bg-surface-elevated hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex-1" />

      {contextLabel && (
        <span
          className={cn(
            "hidden rounded-full border border-border px-2.5 py-1 text-xs text-muted sm:inline-block",
          )}
        >
          {contextLabel}
        </span>
      )}

      <Dropdown
        align="end"
        trigger={
          <span className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground transition-colors hover:border-muted/40">
            <UserRound className="size-4 text-muted" />
            <span className="hidden max-w-[180px] truncate sm:inline">
              {userEmail ?? "Conta"}
            </span>
          </span>
        }
      >
        {userEmail && (
          <>
            <div className="px-2.5 py-1.5 text-xs text-muted">{userEmail}</div>
            <DropdownSeparator />
          </>
        )}
        <DropdownItem tone="danger" onSelect={onSignOut}>
          <LogOut className="size-4" />
          Sair
        </DropdownItem>
      </Dropdown>
    </header>
  );
}
