/**
 * Region registry.
 *
 * A region is named once, source-neutrally, and each source translates it into whatever
 * identifier it happens to use — ALA a contextual-layer string, iNaturalist a numeric place id.
 * This is "tailor the adapter, not the record" applied to configuration: the harvest definition
 * says "New South Wales" and never has to know that one source wants `cl22:"New South Wales"`
 * and the other wants `place_id=6825`.
 */
export interface Region {
  key: string;
  label: string;
  /** Value of ALA's cl22 contextual layer (Australian states and territories). */
  alaStateProvince: string;
  /** iNaturalist place id. Verified against /v1/places/autocomplete on 29 Aug 2026. */
  inatPlaceId: number;
}

export const REGIONS: Record<string, Region> = {
  nsw: {
    key: "nsw",
    label: "New South Wales",
    alaStateProvince: "New South Wales",
    inatPlaceId: 6825,
  },
};
