import type { RecordType } from "@/apis/corpusTypes";

/** A record type's chart colour, as a CSS variable. Fixed per type so it never changes with rank. */
export const typeColor = (type: RecordType | "all"): string => `var(--type-${type}, var(--muted-foreground))`;
