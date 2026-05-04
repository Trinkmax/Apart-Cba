import { splitBookingSegments, nightsBetween } from "./src/lib/booking-split.ts";

const cases = [
  ["2026-05-01", "2026-05-04", "3n → no split"],
  ["2026-05-01", "2026-05-31", "30n → no split (exacto)"],
  ["2026-05-01", "2026-06-01", "31n → 30 + 1"],
  ["2026-05-01", "2026-06-02", "32n → 30 + 2 (CASO USUARIO)"],
  ["2026-05-01", "2026-06-30", "60n → 30 + 30 (CASO USUARIO)"],
  ["2026-05-01", "2026-07-15", "75n → 30 + 30 + 15"],
];
for (const [ci, co, label] of cases) {
  const total = nightsBetween(ci, co);
  const segs = splitBookingSegments(ci, co);
  const sum = segs.reduce((a, s) => a + s.nights, 0);
  console.log(`\n${label}`);
  console.log(`  total=${total}n  segments=${segs.length}  sum=${sum}`);
  segs.forEach((s, i) => console.log(`  [${i}] ${s.from} → ${s.to}  ${s.nights}n  isLast=${s.isLast}`));
}
