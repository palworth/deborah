const DEFAULT_MEETING_TIME_ZONE = "America/Denver";

export function inferMeetingSeries(title: string): string | undefined {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");

  if (
    normalized === "leadership team daily sync" ||
    normalized === "hts meet" ||
    normalized === "hts meets"
  ) {
    return "HTS";
  }

  return undefined;
}

export function localDateFromCreatedAt(
  createdAt: Date | undefined,
  timeZone = DEFAULT_MEETING_TIME_ZONE,
): string | undefined {
  if (!createdAt || Number.isNaN(createdAt.getTime())) return undefined;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(createdAt);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

export function sqliteDateTimeFromDate(createdAt: Date | undefined): string | undefined {
  if (!createdAt || Number.isNaN(createdAt.getTime())) return undefined;
  return createdAt.toISOString().slice(0, 19).replace("T", " ");
}
