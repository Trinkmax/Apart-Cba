// Resolución del propietario al que se le imputa un gasto/cargo de una unidad.
//
// IMPORTANTE: NO depender solo de `unit_owners.is_primary` — en la base la
// mayoría de las unidades de un solo dueño tienen is_primary=false, así que
// resolver por is_primary dejaba egresos sin owner y fuera de la liquidación.
//
// Regla (decidida con el usuario: "completo al dueño principal"), robusta:
//   • 1 dueño        → ese dueño (aunque no esté flageado principal)
//   • varios + is_primary → el principal
//   • varios sin principal → el de mayor % de propiedad (primero en empate)

export type UnitOwnerLite = {
  owner_id: string;
  is_primary?: boolean | null;
  ownership_pct?: number | null;
};

export function pickChargeOwner(owners: UnitOwnerLite[]): string | null {
  if (owners.length === 0) return null;
  if (owners.length === 1) return owners[0].owner_id;
  const primary = owners.find((o) => o.is_primary);
  if (primary) return primary.owner_id;
  return [...owners].sort(
    (a, b) => Number(b.ownership_pct ?? 0) - Number(a.ownership_pct ?? 0),
  )[0].owner_id;
}
