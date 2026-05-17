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

/** A single flag SVG, decomposed so a renderer can stitch many flags into
 *  one deduped `<defs>` block via `<symbol id="flag-XXX">…inner…</symbol>`
 *  + `<use href="#flag-XXX"/>`. */
export interface NationalFlag {
  /** viewBox attribute from the source SVG, e.g. `"0 0 1200 600"`. */
  readonly viewBox: string;
  /** Markup inside the outer `<svg>` tag, ready to embed in a `<symbol>`. */
  readonly inner: string;
}
