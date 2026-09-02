/** A single entry in the canonical national-letters list. The generated
 *  metadata module is shaped against this — UI surfaces import only this
 *  module (no SVG payload) so the client bundle stays small. */
export interface NationalCode {
  /** Canonical 3-letter code (uppercase, [A-Z]{3}). */
  readonly code: string;
  /** English country/territory name as published by the dataset. */
  readonly name: string;
  readonly iso3166Alpha2: string | null;
  readonly iso3166Alpha3: string | null;
}

/** Cross-reference from a non-canonical sail-letters spelling to the
 *  canonical code (e.g. Sailwave's `BVI` → RRS `IVB`). */
export interface NationalAlias {
  readonly canonical: string;
  readonly note?: string;
}

/** A flag as the renderer stitches it into one deduped `<defs>` block:
 *  `<symbol id="flag-XXX">…</symbol>` + `<use href="#flag-XXX"/>` per row.
 *  Most flags are small vector art and keep their markup; the few that are
 *  coat-of-arms line art running to tens of KB are rasterized at sync time,
 *  since they are only ever drawn into a 20×13 px box. */
export type NationalFlag = NationalFlagVector | NationalFlagRaster;

export interface NationalFlagVector {
  /** viewBox attribute from the source SVG, e.g. `"0 0 1200 600"`. */
  readonly viewBox: string;
  /** Markup inside the outer `<svg>` tag, ready to embed in a `<symbol>`. */
  readonly inner: string;
  readonly raster?: undefined;
}

export interface NationalFlagRaster {
  /** `"0 0 w h"` for the raster's pixel dimensions. */
  readonly viewBox: string;
  readonly inner?: undefined;
  readonly raster: {
    /** A `data:image/webp;base64,…` URI. */
    readonly src: string;
    readonly width: number;
    readonly height: number;
  };
}
