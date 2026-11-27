import type { AgeBand } from "@little-quest/api-client";

export const ageRanges: { value: AgeBand; label: string }[] = [
  { value: "3-4", label: "3–4" },
  { value: "7-8", label: "7–8" },
  { value: "9-10", label: "9–10" },
];

export function ageRangeLabels(bands: AgeBand[]) {
  return ageRanges
    .filter(({ value }) => bands.includes(value))
    .map(({ label }) => label)
    .join(", ");
}
