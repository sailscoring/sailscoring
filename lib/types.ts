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
}

export interface Competitor {
  id: string;
  seriesId: string;
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

export type ResultCode = 'DNC' | 'DNF' | 'OCS';

export interface Finish {
  id: string;
  raceId: string;
  competitorId: string;
  finishPosition: number | null;  // null if result code is set
  resultCode: ResultCode | null;  // null if finish position is set
  startPresent: boolean | null;   // true if observed in starting area; null if not recorded
}

// Calculated, not stored
export interface RaceScore {
  competitorId: string;
  points: number;
  place: number | null;   // null for coded finishes
  resultCode: ResultCode | null;
}

export interface Standing {
  rank: number;
  competitor: Competitor;
  racePoints: number[];             // points per race, in race order
  raceCodes: (ResultCode | null)[]; // result code per race (null = normal finish)
  totalPoints: number;
  netPoints: number;                // totalPoints minus discarded points
  raceDiscards: boolean[];          // true = this race is discarded from series total
}
