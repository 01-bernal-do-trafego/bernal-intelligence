"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, type SelectOption } from "@/components/ui/select";
import type { AdAccount, Campaign } from "@/types/domain";

interface DashboardScopeFiltersProps {
  accounts: AdAccount[];
  campaigns: Campaign[];
  currentAccount: string;
  currentCampaign: string;
}

export function DashboardScopeFilters({
  accounts,
  campaigns,
  currentAccount,
  currentCampaign,
}: DashboardScopeFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(params: URLSearchParams) {
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function onAccountChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("account");
    else params.set("account", value);
    // Trocar de conta invalida a campanha selecionada.
    params.delete("campaign");
    push(params);
  }

  function onCampaignChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("campaign");
    else params.set("campaign", value);
    push(params);
  }

  const accountOptions: SelectOption[] = [
    { value: "all", label: "Todas as contas" },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  const campaignOptions: SelectOption[] = [
    { value: "all", label: "Todas as campanhas" },
    ...campaigns.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {accounts.length > 0 && (
        <Select
          aria-label="Conta de anúncios"
          className="sm:w-56"
          options={accountOptions}
          value={currentAccount}
          onChange={(e) => onAccountChange(e.target.value)}
        />
      )}
      <Select
        aria-label="Campanha"
        className="sm:w-64"
        options={campaignOptions}
        value={currentCampaign}
        onChange={(e) => onCampaignChange(e.target.value)}
      />
    </div>
  );
}
