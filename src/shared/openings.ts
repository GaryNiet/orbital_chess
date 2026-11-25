import type { OpeningInfo } from './api.ts';

/**
 * Each day's game starts where one of these well-known opening lines ends.
 * The opening for a date is picked deterministically, so every server and
 * client agree on it without storing anything.
 */
export const OPENINGS: OpeningInfo[] = [
  { name: 'Ruy Lopez, Closed', san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'] },
  { name: 'Italian Game, Giuoco Piano', san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6'] },
  { name: 'Sicilian Defence, Najdorf', san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { name: 'Sicilian Defence, Dragon', san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'] },
  { name: 'French Defence, Winawer', san: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4'] },
  { name: 'Caro-Kann Defence, Classical', san: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'] },
  { name: "Queen's Gambit Declined", san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7'] },
  { name: 'Slav Defence', san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4'] },
  {
    name: "King's Indian Defence, Classical",
    san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5'],
  },
  { name: 'Nimzo-Indian Defence', san: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  {
    name: 'Grünfeld Defence, Exchange',
    san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7'],
  },
  { name: 'English Opening, Symmetrical', san: ['c4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7'] },
  { name: 'Scandinavian Defence', san: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'] },
  { name: 'Pirc Defence', san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6'] },
  { name: "King's Gambit Accepted", san: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'g5'] },
  { name: 'Scotch Game', san: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'] },
  { name: 'Petrov Defence', san: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4'] },
  { name: 'London System', san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Nc6'] },
  { name: 'Dutch Defence, Leningrad', san: ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'g6', 'Nf3', 'Bg7'] },
  { name: 'Modern Benoni', san: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6', 'Nc3', 'exd5', 'cxd5', 'd6'] },
  { name: 'Catalan Opening', san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O'] },
  { name: 'Two Knights Defence', san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5'] },
  { name: 'Alekhine Defence', san: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6', 'Nf3'] },
  { name: 'Evans Gambit', san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5'] },
  { name: 'Vienna Game', san: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5'] },
];

/** UTC calendar day, e.g. "2026-11-25". */
export const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Start of the next UTC day, in epoch ms. */
export const dayEndsAt = (day: string) => Date.parse(`${day}T00:00:00Z`) + 86_400_000;

export const openingFor = (day: string): OpeningInfo => {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  // Step by a number coprime with the list length so neighbouring days differ.
  return OPENINGS[(((n * 7) % OPENINGS.length) + OPENINGS.length) % OPENINGS.length]!;
};
