"use client";

import { LogOut, Menu, UserRound } from "lucide-react";
import { ROLE_LABEL, type AppRole } from "@/lib/roles";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";

interface TopbarProps {
  onMenuClick: () => void;
  email?: string;
  displayName?: string;
  role?: AppRole;
  demo?: boolean;
}

export function Topbar({
  onMenuClick,
  email,
  displayName,
  role,
  demo = false,
}: TopbarProps) {
  const primary = displayName || email || "Conta";
  const roleLabel = demo ? "Modo demonstração" : role ? ROLE_LABEL[role] : null;

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

      {demo && (
        <span className="hidden rounded-full border border-border px-2.5 py-1 text-xs text-muted sm:inline-block">
          Modo demonstração
        </span>
      )}

      <Dropdown
        align="end"
        trigger={
          <span className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground transition-colors hover:border-muted/40">
            <UserRound className="size-4 text-muted" />
            <span className="hidden max-w-[180px] truncate sm:inline">
              {primary}
            </span>
          </span>
        }
      >
        <div className="px-2.5 py-1.5">
          <p className="truncate text-sm text-foreground">{primary}</p>
          {email && email !== primary && (
            <p className="truncate text-xs text-muted">{email}</p>
          )}
          {roleLabel && (
            <p className="mt-0.5 text-xs text-accent">{roleLabel}</p>
          )}
        </div>
        <DropdownSeparator />
        <SignOutButton className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-negative transition-colors hover:bg-negative/10 disabled:cursor-not-allowed disabled:opacity-50">
          <LogOut className="size-4" />
          Sair
        </SignOutButton>
      </Dropdown>
    </header>
  );
}
