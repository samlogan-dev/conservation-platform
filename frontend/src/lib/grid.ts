/** Types shared by the database grid and the views that configure it. */

export interface GridColumn {
  /** Dotted path into the row (`provenance.source`). */
  key: string;
  /** Column header. Usually the last path segment. */
  label: string;
  /** Declared type, shown beside the name the way a table editor shows `text` or `int8`. */
  type: string;
  width: number;
  required?: boolean;
  /** Primary key: shown with a key icon and pinned while scrolling horizontally. */
  primary?: boolean;
  /** Schema group. Where a new group begins its label is shown above the column name. */
  group?: string;
  /** Shown as the header tooltip. */
  description?: string;
  mono?: boolean;
}

export type CellKind = "missing" | "mismatch" | "withheld" | "fuzzed";

export interface CellState {
  kind: CellKind;
  title?: string;
}
