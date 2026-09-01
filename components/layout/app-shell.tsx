"use client";

import { useState, type ReactNode } from "react";
import { signOut } from "@/app/(app)/actions";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

interface AppShellProps {
  children: ReactNode;
  userEmail?: string;
  demo?: boolean;
}

export function AppShell({ children, userEmail, demo = false }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          userEmail={userEmail}
          onSignOut={() => void signOut()}
          contextLabel={demo ? "Modo demonstração" : undefined}
        />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
