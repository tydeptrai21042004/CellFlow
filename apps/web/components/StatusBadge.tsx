interface StatusBadgeProps {
  value: string | null | undefined;
  compact?: boolean;
}

const attention = new Set(["REJECTED", "NODE_REJECTED", "CONFLICTED", "REORGED", "EXPIRED"]);
const success = new Set(["CONFIRMED", "VERIFIED", "DELIVERED"]);
const progress = new Set([
  "PENDING", "PROPOSED", "COMMITTED", "RECONCILING", "WAITING_CONFIRMATIONS",
  "BROADCASTING", "SUBMITTED", "SUBMITTING", "PREPARED", "SUBMISSION_UNKNOWN", "UNKNOWN", "UNOBSERVED",
]);

export function statusTone(value: string | null | undefined): "success" | "danger" | "progress" | "neutral" {
  const normalized = (value ?? "UNKNOWN").toUpperCase();
  if (success.has(normalized)) return "success";
  if (attention.has(normalized)) return "danger";
  if (progress.has(normalized)) return "progress";
  return "neutral";
}

export function humanStatus(value: string | null | undefined): string {
  if (!value) return "Not available";
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (part) => part.toUpperCase());
}

export default function StatusBadge({ value, compact = false }: StatusBadgeProps) {
  const normalized = value ?? "UNKNOWN";
  return (
    <span className={`status-badge status-${statusTone(normalized)}${compact ? " status-compact" : ""}`}>
      <span className="status-dot" aria-hidden="true" />
      {humanStatus(normalized)}
    </span>
  );
}
