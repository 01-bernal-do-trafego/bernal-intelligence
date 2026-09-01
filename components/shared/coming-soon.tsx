import type { ReactNode } from "react";

interface ComingSoonProps {
  title: string;
  description: string;
  children?: ReactNode;
}

export function ComingSoon({ title, description, children }: ComingSoonProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted">{description}</p>
        {children}
      </div>
    </div>
  );
}
