/**
 * Region registry.
 *
 * A region is named once, source-neutrally, and the source translates it into whatever
 * identifier it uses — for ALA, a value of the cl22 contextual layer (Australian states and
 * territories). A harvest with no region covers all of Australia.
 */
export interface Region {
  key: string;
  label: string;
  /** Value of ALA's cl22 contextual layer (Australian states and territories). */
  alaStateProvince: string;
}

export const REGIONS: Record<string, Region> = {
  nsw: {
    key: "nsw",
    label: "New South Wales",
    alaStateProvince: "New South Wales",
  },
};
