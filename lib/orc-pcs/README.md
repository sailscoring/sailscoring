# orc-pcs — ORC Performance Curve Scoring

A TypeScript implementation of ORC Performance Curve Scoring (PCS): the
scoring method of ORC Rating Systems rule 402, in which each boat's
performance curve — built from its certificate's time-allowance matrix over
a pre-defined course model or a constructed course — is inverted at the
boat's achieved speed to find its **implied wind**, the fleet's best implied
wind becomes the race's **scoring wind**, and every boat's allowance at that
wind produces its corrected time.

## Provenance and fidelity

This is a faithful port of ORC's own PCS module (`PCSLib.pas` +
`spline3.pas`, module version 1.4.0.10), which ORC provides **to the public
domain** at <https://data.orc.org/tools.php?c=pcs> for embedding in race
scoring software, together with its specification (`PCS_Module_Specs.pdf`)
and a test application. Rule 402.13 points scoring software at exactly this
code.

Fidelity is the design goal: the parabolically-terminated cubic spline
(ALGLIB-derived), the 4-point Lagrange interpolation over the polar, the VMG
cos-projections inside the optimum beat/gybe angles, the current
correction, the 1e-5 bisection, and each individual rounding all match the
reference module — including its oddities (the ±2° polar padding points
"kept for Altura compatibility", and the current correction's asymmetry
between the VMG and mid-range branches), because matching the results boats
actually receive matters more than tidiness.

## Scope and dependencies

- Zero dependencies, and no imports from the rest of the application — the
  module is deliberately hermetic and destined for a standalone repository
  under the `sailscoring` org once its parity suite has survived a real
  season.
- Input is the certificate's `Allowances` block exactly as the ORC
  database's JSON serves it, plus per-leg course data for constructed
  courses; output is per-boat implied wind, allowance at the scoring wind,
  corrected seconds, and the full course curve for publication.
- Rule 402.9 (fleet-wide scoring wind) is the default; 402.10 (per-boat
  implied wind) and 402.12 (race-committee scoring-wind override) are
  supported via input flags.

## Validation

The test suite exercises the module against real certificates from the ORC
database and against reference outputs from ORC's own scoring service
(`https://data.orc.org/public/WPCS.dll`, the online twin of the DLL this
code ports) — see `tests/orc-pcs*.test.ts` and `tests/fixtures/orc-pcs/`.
