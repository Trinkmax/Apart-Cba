import {
  AirVent,
  Bath,
  Bed,
  Box,
  Car,
  CigaretteOff,
  Coffee,
  Dumbbell,
  Flame,
  Fan,
  Flower2,
  Lightbulb,
  Microwave,
  Monitor,
  Mountain,
  PawPrint,
  Refrigerator,
  Shirt,
  Snowflake,
  Sofa,
  Sparkles,
  Sprout,
  Tv,
  Utensils,
  WashingMachine,
  Waves,
  Wifi,
  Wind,
  type LucideIcon,
} from "lucide-react";

export interface AmenityIconDef {
  name: string;
  label: string;
  icon: LucideIcon;
  category?: string;
}

/** Mapa centralizado de íconos disponibles para el catálogo. */
export const AMENITY_ICONS: AmenityIconDef[] = [
  // Climatización
  { name: "air-vent", label: "Aire acondicionado", icon: AirVent, category: "Climatización" },
  { name: "fan", label: "Ventilador", icon: Fan, category: "Climatización" },
  { name: "snowflake", label: "Frío", icon: Snowflake, category: "Climatización" },
  { name: "flame", label: "Calefacción", icon: Flame, category: "Climatización" },

  // Cocina
  { name: "utensils", label: "Cocina", icon: Utensils, category: "Cocina" },
  { name: "microwave", label: "Microondas", icon: Microwave, category: "Cocina" },
  { name: "refrigerator", label: "Heladera", icon: Refrigerator, category: "Cocina" },
  { name: "coffee", label: "Café", icon: Coffee, category: "Cocina" },

  // Lavadero
  { name: "washing-machine", label: "Lavarropas", icon: WashingMachine, category: "Lavadero" },
  { name: "wind", label: "Secarropas", icon: Wind, category: "Lavadero" },
  { name: "shirt", label: "Blanquería", icon: Shirt, category: "Lavadero" },

  // Conectividad / entretenimiento
  { name: "wifi", label: "WiFi", icon: Wifi, category: "Conectividad" },
  { name: "tv", label: "TV / Streaming", icon: Tv, category: "Entretenimiento" },
  { name: "monitor", label: "Workspace", icon: Monitor, category: "Trabajo" },

  // Dormitorio / baño
  { name: "bed", label: "Dormitorio", icon: Bed, category: "Dormitorio" },
  { name: "bath", label: "Baño / toallas", icon: Bath, category: "Baño" },
  { name: "sofa", label: "Living", icon: Sofa, category: "Living" },

  // Edificio
  { name: "dumbbell", label: "Gimnasio", icon: Dumbbell, category: "Edificio" },
  { name: "waves", label: "Pileta", icon: Waves, category: "Edificio" },
  { name: "car", label: "Cochera", icon: Car, category: "Edificio" },
  { name: "mountain", label: "Vista / balcón", icon: Mountain, category: "Edificio" },

  // Servicio
  { name: "sparkles", label: "Limpieza", icon: Sparkles, category: "Servicio" },
  { name: "sprout", label: "Eco friendly", icon: Sprout, category: "Servicio" },
  { name: "flower2", label: "Decoración", icon: Flower2, category: "Servicio" },

  // Políticas
  { name: "paw-print", label: "Pet friendly", icon: PawPrint, category: "Políticas" },
  { name: "cigarette-off", label: "No fumar", icon: CigaretteOff, category: "Políticas" },

  // Genérico
  { name: "lightbulb", label: "Iluminación", icon: Lightbulb, category: "Otros" },
  { name: "box", label: "Otro", icon: Box, category: "Otros" },
];

const ICON_BY_NAME = new Map<string, LucideIcon>(
  AMENITY_ICONS.map((d) => [d.name, d.icon])
);

export function resolveAmenityIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Box;
  return ICON_BY_NAME.get(name) ?? Box;
}

/** Capitaliza una categoría que viene en lowercase desde la DB. */
export function prettyCategory(raw: string | null | undefined): string {
  if (!raw) return "Sin categoría";
  // pequeñas correcciones de tildes
  const fixes: Record<string, string> = {
    climatizacion: "Climatización",
    cocina: "Cocina",
    conectividad: "Conectividad",
    consumibles: "Consumibles",
    edificio: "Edificio",
    entretenimiento: "Entretenimiento",
    estacionamiento: "Estacionamiento",
    exterior: "Exterior",
    politicas: "Políticas",
    servicio: "Servicio",
    trabajo: "Trabajo",
    bano: "Baño",
    "baño": "Baño",
    dormitorio: "Dormitorio",
    living: "Living",
    lavadero: "Lavadero",
    otros: "Otros",
  };
  const key = raw.toLowerCase().trim();
  return fixes[key] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}
