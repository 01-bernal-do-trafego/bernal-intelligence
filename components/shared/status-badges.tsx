import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
  CAMPAIGN_STATUS_LABEL,
  CLIENT_STATUS_LABEL,
  META_STATUS_LABEL,
  type CampaignStatus,
  type ClientStatus,
  type MetaConnectionStatus,
} from "@/types/domain";

const CLIENT_TONE: Record<ClientStatus, BadgeTone> = {
  onboarding: "accent",
  active: "positive",
  paused: "warning",
  archived: "muted",
};

const META_TONE: Record<MetaConnectionStatus, BadgeTone> = {
  connected: "positive",
  not_connected: "muted",
  error: "negative",
};

const CAMPAIGN_TONE: Record<CampaignStatus, BadgeTone> = {
  active: "positive",
  paused: "warning",
  ended: "muted",
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return (
    <Badge tone={CLIENT_TONE[status]} dot>
      {CLIENT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function MetaStatusBadge({ status }: { status: MetaConnectionStatus }) {
  return (
    <Badge tone={META_TONE[status]} dot>
      {META_STATUS_LABEL[status]}
    </Badge>
  );
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge tone={CAMPAIGN_TONE[status]}>{CAMPAIGN_STATUS_LABEL[status]}</Badge>;
}

/** Health score 0–100. Mostra "—" quando não há Meta conectada. */
export function HealthScore({
  value,
  connected,
}: {
  value: number;
  connected: boolean;
}) {
  if (!connected) return <span className="text-muted">—</span>;
  const tone =
    value >= 70 ? "text-positive" : value >= 45 ? "text-warning" : "text-negative";
  return <span className={`font-medium tabular-nums ${tone}`}>{value}</span>;
}
