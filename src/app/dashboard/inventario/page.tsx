import { Boxes, Plus } from "lucide-react";
import { listAmenities } from "@/lib/actions/amenities";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AmenityFormDialog } from "@/components/amenities/amenity-form-dialog";

export default async function InventarioPage() {
  const amenities = await listAmenities();

  // Agrupar por categoría
  const grouped = amenities.reduce<Record<string, typeof amenities>>((acc, a) => {
    const cat = a.category ?? "Sin categoría";
    acc[cat] = acc[cat] ?? [];
    acc[cat].push(a);
    return acc;
  }, {});

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Boxes className="size-5 text-primary" />
            Inventario y Amenities
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {amenities.length} ítems en el catálogo
          </p>
        </div>
        <AmenityFormDialog>
          <Button className="gap-2"><Plus size={16} /> Nuevo ítem</Button>
        </AmenityFormDialog>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Boxes className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Catálogo vacío</p>
          <p className="text-xs text-muted-foreground mt-1">
            Agregá items reutilizables (ej. Toallas, Café, Papel higiénico)
          </p>
        </Card>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((a) => (
                <Card key={a.id} className="p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-lg shrink-0">
                      {a.icon ?? "📦"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {a.consumable && (
                          <Badge variant="secondary" className="text-[10px]">Consumible</Badge>
                        )}
                        {a.default_par_level !== null && (
                          <Badge variant="outline" className="text-[10px]">
                            Stock mín: {a.default_par_level} {a.unit_label ?? ""}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
