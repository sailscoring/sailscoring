export interface Series {
  id: string;
  name: string;
  venue: string;
  date: string;        // ISO date string, e.g. "2025-06-14"
  createdAt: number;   // Date.now()
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
  racePoints: number[];   // points per race, in race order
  totalPoints: number;
}
