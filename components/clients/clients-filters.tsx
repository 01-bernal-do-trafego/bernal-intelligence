"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos os status" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Ativo" },
  { value: "paused", label: "Pausado" },
  { value: "archived", label: "Arquivado" },
] as const;

export function ClientsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [term, setTerm] = useState(searchParams.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(next: { q?: string; status?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q);
      else params.delete("q");
    }
    if (next.status !== undefined) {
      if (next.status && next.status !== "all") params.set("status", next.status);
      else params.delete("status");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  function onTermChange(value: string) {
    setTerm(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => pushParams({ q: value }), 300);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        className="sm:max-w-xs"
        placeholder="Buscar cliente"
        leading={<Search />}
        value={term}
        onChange={(e) => onTermChange(e.target.value)}
      />
      <Select
        className="sm:w-52"
        aria-label="Filtrar por status"
        options={STATUS_OPTIONS}
        value={searchParams.get("status") ?? "all"}
        onChange={(e) => pushParams({ status: e.target.value })}
      />
    </div>
  );
}
