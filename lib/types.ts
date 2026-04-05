export interface DiscardThreshold {
  minRaces: number;     // apply this rule when races.length >= minRaces
  discardCount: number; // number of worst scores to drop
}

export interface Series {
  id: string;
  name: string;
  venue: string;
  startDate: string;   // ISO date string, e.g. "2025-06-14"
  endDate: string;     // ISO date string; empty string if single-day or unknown
  venueLogoUrl: string;
  eventLogoUrl: string;
  createdAt: number;   // Date.now()
  // File tracking
  lastSnapshotId: string | null;  // snapshotId of last Save to File or Open from File
  lastSavedAt: number | null;     // Date.now() of last Save to File
  lastModifiedAt: number;         // Date.now() of last data change
  snapshotHistory: string[];      // ordered lineage of all snapshot IDs
  // Scoring rules
  discardThresholds: DiscardThreshold[];
  dnfScoring: 'seriesEntries' | 'startingArea';  // A5.2 (default) or A5.3
  // Publishing
  ftpHost: string;   // saved FTP server host for this series (empty if not yet published)
  ftpPath: string;   // saved remote path for this series (empty if not yet published)
  bilgeBundle: BilgeBundle | null;
  includeJsonExport: boolean;  // embed public JSON export in exported HTML (default true)
}

export interface Fleet {
  id: string;
  seriesId: string;
  name: string;
  displayOrder: number;
}

export interface Competitor {
  id: string;
  seriesId: string;
  fleetId: string;
  sailNumber: string;
  name: string;
  club: string;
  gender: 'M' | 'F' | '';
  age: number | null;
  createdAt: number;
}

export interface Race {
  id: string;
  seriesId: string;
  raceNumber: number;
  date: string;        // ISO date string
  createdAt: number;
}

export type ResultCode =
  // Position-replacing codes (replace finish; boat receives penalty score)
  | 'DNC'   // Did Not Come to start area — always entries+1
  | 'DNS'   // Did Not Start
  | 'OCS'   // On Course Side
  | 'NSC'   // Did Not Sail the Course
  | 'DNF'   // Did Not Finish
  | 'RET'   // Retired
  | 'DSQ'   // Disqualified (excludable)
  | 'DNE'   // Disqualification Not Excludable — cannot be discarded
  | 'UFD'   // U Flag Disqualification (rule 30.3) — discardable
  | 'BFD';  // Black Flag Disqualification (rule 30.4) — cannot be discarded

export interface Finish {
  id: string;
  raceId: string;
  competitorId: string | null;    // null for unresolved unknown finishes
  unknownSailNumber?: string;     // set when competitorId is null
  finishPosition: number | null;  // null if result code is set
  resultCode: ResultCode | null;  // null if finish position is set
  startPresent: boolean | null;   // true if observed in starting area; null if not recorded
}

// Calculated, not stored
export interface RaceScore {
  competitorId: string;
  points: number;
  place: number | null;   // raw cross-fleet finish position; null for coded finishes
  rank: number | null;    // within-fleet finish rank (base, before averaging); null for coded finishes
  resultCode: ResultCode | null;
}

export interface BilgeBundle {
  uuid: string;                 // bilge namespace owner token (travels in series file)
  prefix: string;               // e.g. "hyc-autumn-league-2026"
  slug: string;                 // primary slug, e.g. "hyc-autumn-league-2026/standings"
  email?: string;               // scorer email — local only, NOT written to series file
  status: 'unpublished' | 'pending' | 'published';
  publishedUrl: string | null;  // primary (first fleet) published URL
  lastPublishedAt: number | null;
  // Multi-fleet: per-fleet published URLs. Absent for single-fleet bundles.
  fleets?: { name: string; url: string | null }[];
}

export interface FtpServer {
  id?: number;   // auto-increment primary key; undefined before first save
  host: string;
  port: number;
  username: string;
  password: string;
  ftps: boolean;
}

export interface Standing {
  rank: number;
  competitor: Competitor;
  racePoints: number[];             // points per race, in race order
  raceCodes: (ResultCode | null)[]; // result code per race (null = normal finish)
  totalPoints: number;
  netPoints: number;                // totalPoints minus discarded points
  raceDiscards: boolean[];          // true = this race is discarded from series total
  raceNonDiscardable: boolean[];    // true = this code cannot be excluded by discard rules (DNE, BFD)
}
