/**
 * Pure matching primitives for the cross-series competitor-identity spine
 * (#212). Where `rating-match.ts` matches a competitor to an external *rating*
 * by sail number and boat name, this module matches a competitor to a recurring
 * *person* across series — the signals the reconcile pass clusters on.
 *
 * Pure: no `server-only`, no network, no DB. Designed for a single-handed
 * junior dinghy class (IODAI Optimists) where the recurring identity is a
 * person, so the spine is the person's name, corroborated by club and (where
 * present) implied birth year. Sail-number continuity is handled by
 * `rating-match.ts` (`sailNumberParts` / `sailNumbersMatch`).
 *
 * The deliberate bias: across a 17-year corpus, names recur and sail numbers
 * turn over, so name is the cross-season spine and the matcher tolerates
 * initial-vs-full given names. It refuses to fuse two different given names
 * sharing a surname (`Jack` vs `John Keating`) — namesakes stay split, because
 * a wrong split is one click to fix in the reconcile UI and a wrong merge
 * silently corrupts a career arc.
 */

/** A person's name decomposed for matching. `full` never matches when empty. */
export interface NormalizedPersonName {
  /** Normalised surname (last whitespace-separated token). */
  surname: string;
  /** Normalised given-name tokens, in order. */
  given: string[];
  /** All tokens joined by a space — a stable canonical form for display/debug. */
  full: string;
}

/** Lowercase, strip diacritics, drop everything that isn't a letter. */
function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z]/g, '');
}

/**
 * Decompose a `"Firstname … Surname"` string into normalised given tokens and a
 * surname. Apostrophes, hyphens, accents and case are folded
 * (`"Aoife O'Toole"` → given `["aoife"]`, surname `"otoole"`). The last
 * whitespace-separated token is taken as the surname — correct for the Irish
 * junior-sailing names this targets; compound surnames (`"van der Berg"`) fold
 * to their final token, which is conservative (more likely to split than fuse).
 * Empty / punctuation-only input yields an all-empty result that never matches.
 */
export function normalizePersonName(name: string | undefined): NormalizedPersonName {
  const tokens = (name ?? '')
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { surname: '', given: [], full: '' };
  const surname = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1);
  return { surname, given, full: tokens.join(' ') };
}

/** Whether two given-name tokens are compatible: equal, or one a single-letter
 *  initial of the other (`"j"` ~ `"john"`). */
function givenTokensCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/**
 * Whether two normalised names plausibly refer to the same person. Surnames
 * must be equal and non-empty; *both* sides must carry at least one given name,
 * and the leading given tokens must all be compatible (`givenTokensCompatible`,
 * so `"J Keating"` ~ `"John Keating"`). Differing concrete first names
 * (`"Jack"` vs `"John"`) never match.
 *
 * A **bare surname matches nobody**: a row recorded as just `"Dempsey"` is not
 * evidence that it's the *same* Dempsey as any other, and treating it as a
 * match makes it a hub that fuses every same-surname person (the real
 * three-sibling Dempsey over-merge: a lone `"Dempsey"` row bridged Ella,
 * Edward, and Jonathan into one identity). Such rows stay unlinked singletons
 * for the scorer to attach by hand — the deliberate under-merge bias.
 */
export function personNamesMatch(
  a: NormalizedPersonName,
  b: NormalizedPersonName,
): boolean {
  if (!a.surname || a.surname !== b.surname) return false;
  if (a.given.length === 0 || b.given.length === 0) return false;
  const n = Math.min(a.given.length, b.given.length);
  for (let i = 0; i < n; i++) {
    if (!givenTokensCompatible(a.given[i], b.given[i])) return false;
  }
  return true;
}

/**
 * Split a club field into its normalised constituent clubs. Sailors commonly
 * list more than one (`"WHSC / RCYC"`, `"TBSC/CHSC"`) — splitting on `/` lets a
 * later season's `"RCYC"` corroborate an earlier `"WHSC / RCYC"`. Lowercased,
 * punctuation and whitespace stripped per token.
 */
export function normalizeClubs(club: string | undefined): string[] {
  return (club ?? '')
    .split('/')
    .map((c) => c.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, ''))
    .filter((c) => c.length > 0);
}

/** Words that carry no distinguishing weight in a club name. */
const CLUB_STOP_WORDS = new Set(['the', 'of', 'and']);

/** Suffixes clubs abbreviate, expanded so `"Killaloe SC"` and `"Killaloe
 *  Sailing Club"` reduce to one form. Only applied to a *token* of a
 *  multi-word name: a club written as nothing but `"SC"` or `"MYC"` is an
 *  abbreviation of a name we haven't been told, not the words themselves. */
const CLUB_WORD_EXPANSIONS: Record<string, string[]> = {
  sc: ['sailing', 'club'],
  yc: ['yacht', 'club'],
  syc: ['sailing', 'yacht', 'club'],
  bc: ['boat', 'club'],
  dc: ['dinghy', 'club'],
};

/** The significant words of one club name, abbreviations expanded. */
function clubWords(part: string): string[] {
  const raw = part
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0 && !CLUB_STOP_WORDS.has(w));
  if (raw.length < 2) return raw;
  return raw.flatMap((w) => CLUB_WORD_EXPANSIONS[w] ?? [w]);
}

/**
 * The two forms one club name can be recognised by: its words run together,
 * and — for a name of two or more words — the acronym those words make.
 * `"Killaloe SC"` gives `{ full: 'killaloesailingclub', acronym: 'ksc' }`;
 * `"KSC"` gives `{ full: 'ksc', acronym: null }`.
 */
export function clubNameForms(part: string): { full: string; acronym: string | null } {
  const words = clubWords(part);
  return {
    full: words.join(''),
    acronym: words.length >= 2 ? words.map((w) => w[0]).join('') : null,
  };
}

/**
 * Build the club canonicaliser for one corpus: a function folding a club field
 * into the canonical tokens its clubs are known by, so that the spellings *this
 * workspace actually uses* for one club corroborate each other.
 *
 * A club stated as a bare acronym folds into a spelled-out club only when
 * exactly one spelled-out club in the corpus has those initials. That
 * restriction is the whole safety argument: `hyc-archive` writes both
 * `"Howth Yacht Club"` and `"Holywood YC"`, so `"HYC"` there stays its own
 * token, while in a corpus naming only Howth it folds. Folding globally would
 * merge Baltimore, Blessington and Bray into `BSC`.
 *
 * The fold matters because a single-club workspace is where club corroboration
 * is needed most and fails most: KSC states a club on all but 6 of 1604 rows,
 * always the same club, spelled `"KSC"`, `"Killaloe Sailing Club"` and
 * `"Killaloe SC"` — three non-overlapping tokens under the plain
 * normalisation, so no two of them ever corroborated a name match.
 */
export function buildClubCanonicalizer(
  clubs: Iterable<string | undefined>,
): (club: string | undefined) => string[] {
  const acronymToFull = new Map<string, Set<string>>();
  for (const club of clubs) {
    for (const part of (club ?? '').split('/')) {
      const { full, acronym } = clubNameForms(part);
      if (!full || !acronym) continue;
      const fulls = acronymToFull.get(acronym);
      if (fulls) fulls.add(full);
      else acronymToFull.set(acronym, new Set([full]));
    }
  }
  const fold = new Map<string, string>();
  for (const [acronym, fulls] of acronymToFull) {
    if (fulls.size === 1) fold.set(acronym, [...fulls][0]);
  }
  return (club) =>
    (club ?? '')
      .split('/')
      .map((part) => {
        const { full, acronym } = clubNameForms(part);
        // Only a name that *is* an acronym folds; a spelled-out name already
        // carries its own words, and folding it onto its own initials would
        // make every club sharing them one club.
        return acronym === null ? (fold.get(full) ?? full) : full;
      })
      .filter((c) => c.length > 0);
}

/**
 * Implied birth year from a competitor's age at a dated event:
 * `raceYear − age`. A *transient* reconciliation signal — recomputed from the
 * linked rows each pass, never persisted (see the schema note). Returns null
 * when age is unrecorded (true of most pre-2020 IODAI rows) or the race year is
 * unknown, so the matcher must treat null as "no signal", not a conflict.
 */
export function impliedBirthYear(
  age: number | null | undefined,
  raceYear: number | null | undefined,
): number | null {
  if (age == null || raceYear == null || !Number.isFinite(raceYear)) return null;
  return raceYear - age;
}

/**
 * Whether two implied birth years *conflict* — both known and more than a year
 * apart (one year of slop absorbs age-cutoff and rounding differences between
 * events). A conflict is a hard split signal: it separates two real namesakes.
 * Returns false when either year is unknown (no signal, never blocks a link).
 */
export function birthYearsConflict(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) > 1;
}

/**
 * Whether a name match on this name leans on an initial standing in for a
 * given name — `"J. Murphy"` rather than `"John Murphy"`. `personNamesMatch`
 * accepts the initial form deliberately (a sailor published as `"J Keating"`
 * one season and `"John Keating"` the next is one sailor), but an initial
 * names a much larger set of people than a given name does, so a match resting
 * on one is the weakest the matcher will make.
 *
 * This is the real shape behind the co-owner false merge the clusterer guards
 * against: `"J. & M. Murphy"` splits into two initialled fragments, either of
 * which matches any Murphy whose first name starts with the letter.
 */
export function nameLeansOnInitial(name: NormalizedPersonName): boolean {
  return name.given.length > 0 && name.given[0].length === 1;
}

/**
 * Whether a name is the archive ingest's placeholder for a blank helm field
 * ("Unknown Competitor (1620)", ADR-010). Placeholders exist so competitor
 * listings sort sensibly, but they are *not* evidence of identity: two
 * unknowns sharing a reused sail number are not the same sailor, so the
 * matcher must treat these rows exactly like blank names — never clustered,
 * never suggested.
 */
export function isPlaceholderName(name: string | undefined): boolean {
  return /^unknown competitor\b/i.test((name ?? '').trim());
}

/** Stand-ins scorers type when a crew name isn't known at publication time. */
const CREW_PLACEHOLDERS = new Set([
  'tbd',
  'tba',
  'na',
  'n/a',
  'none',
  'unknown',
  'crew',
  'guest',
  'various',
  'visitor',
]);

/**
 * Whether a name carries too little signal to be worth an identity of its own
 * (#348). Crew fields are markedly messier than the primary slot — the KSC
 * corpus publishes bare first names ("Michael"), initials ("AM"), and
 * placeholders ("???", "TBD") — and each of those would otherwise mint an
 * identity row, a vanity slug, and a public page for a person who can't be
 * recognised.
 *
 * Note this is about *noise*, not false merges: `personNamesMatch` already
 * requires a given name on both sides, so a bare "Michael" matches nobody —
 * not even another "Michael". These rows would become permanent singletons
 * rather than a hub that fuses strangers. Skipping them leaves the mention in
 * the published results, where it belongs, and out of the roster.
 */
export function isLowSignalPersonName(name: string | undefined): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return true;
  if (CREW_PLACEHOLDERS.has(trimmed.toLowerCase())) return true;
  // Two name-like tokens are the minimum for a recognisable person. This also
  // catches "??" / "?????" (no letters at all) and bare initials ("AM"),
  // since `normalizePersonName` drops everything that isn't a letter.
  const { surname, given } = normalizePersonName(trimmed);
  return !surname || given.length === 0;
}

/**
 * Split a crew cell into the people it names. Most cells hold one person, but
 * an as-published capture carries whatever the club typed, and a few cells
 * list a whole crew in one field ("Maeve Dervan, Amber Robson"). The primary
 * slot is already a list (`names`), so this only exists to give the crew field
 * the same shape.
 *
 * Conservative on purpose: it splits on the separators that unambiguously join
 * two people and never on whitespace, so a single name is returned whole. A
 * slash counts — unlike the club field, where "WHSC / RCYC" is one sailor's two
 * clubs, nobody's *name* contains one.
 */
export function splitCrewCell(cell: string | undefined): string[] {
  return (cell ?? '')
    .split(/\s*[,&+/]\s*|\s+and\s+/i)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}
