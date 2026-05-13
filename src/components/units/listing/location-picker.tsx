"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import Map, {
  Marker,
  NavigationControl,
  type MapRef,
  type MarkerDragEvent,
  type MapMouseEvent,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  AlertCircle,
  Check,
  Loader2,
  Locate,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CORDOBA = { latitude: -31.42, longitude: -64.19 };

type Suggestion = {
  id: string;
  primary: string;
  secondary: string;
  latitude: number;
  longitude: number;
  neighborhood: string | null;
  fullAddress: string;
};

export type LocationValue = {
  address: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  initial: LocationValue;
  mapboxToken: string | null;
  onSave: (v: LocationValue) => Promise<void>;
};

type MapboxFeature = {
  id: string;
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    name_preferred?: string;
    full_address?: string;
    place_formatted?: string;
    context?: Record<
      string,
      { name?: string } | undefined
    >;
  };
};

export function LocationPicker({ initial, mapboxToken, onSave }: Props) {
  const listboxId = useId();
  const [query, setQuery] = useState(initial.address);
  const [address, setAddress] = useState(initial.address);
  const [neighborhood, setNeighborhood] = useState(initial.neighborhood);
  const [lat, setLat] = useState<number | null>(initial.latitude);
  const [lng, setLng] = useState<number | null>(initial.longitude);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  const mapRef = useRef<MapRef | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSearch = useRef(false);

  // Close suggestions when clicking outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced forward geocoding
  useEffect(() => {
    if (!mapboxToken) return;
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (query.trim().length < 3) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
        url.searchParams.set("q", query);
        url.searchParams.set("access_token", mapboxToken);
        url.searchParams.set("country", "ar");
        url.searchParams.set("language", "es");
        url.searchParams.set("limit", "6");
        url.searchParams.set(
          "proximity",
          `${CORDOBA.longitude},${CORDOBA.latitude}`,
        );
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("geocode_failed");
        const data = (await res.json()) as { features: MapboxFeature[] };
        const items = data.features.map(toSuggestion);
        setSuggestions(items);
        setOpen(items.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mapboxToken]);

  const reverseGeocode = useCallback(
    async (latitude: number, longitude: number) => {
      if (!mapboxToken) return;
      setReversing(true);
      try {
        const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
        url.searchParams.set("longitude", String(longitude));
        url.searchParams.set("latitude", String(latitude));
        url.searchParams.set("access_token", mapboxToken);
        url.searchParams.set("language", "es");
        url.searchParams.set("limit", "1");
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const data = (await res.json()) as { features: MapboxFeature[] };
        const f = data.features?.[0];
        if (!f) return;
        const s = toSuggestion(f);
        skipNextSearch.current = true;
        setAddress(s.fullAddress);
        setQuery(s.primary);
        if (s.neighborhood) setNeighborhood(s.neighborhood);
        setOpen(false);
      } catch {
        // silent
      } finally {
        setReversing(false);
      }
    },
    [mapboxToken],
  );

  const selectSuggestion = useCallback((s: Suggestion) => {
    skipNextSearch.current = true;
    setLat(s.latitude);
    setLng(s.longitude);
    setAddress(s.fullAddress);
    setQuery(s.primary);
    if (s.neighborhood) setNeighborhood(s.neighborhood);
    setSuggestions([]);
    setOpen(false);
    setDirty(true);
    mapRef.current?.flyTo({
      center: [s.longitude, s.latitude],
      zoom: 16,
      duration: 700,
    });
    inputRef.current?.blur();
  }, []);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("Tu navegador no soporta geolocalización");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude);
        setLng(longitude);
        setDirty(true);
        mapRef.current?.flyTo({
          center: [longitude, latitude],
          zoom: 16,
          duration: 700,
        });
        void reverseGeocode(latitude, longitude);
      },
      () => toast.error("No pudimos obtener tu ubicación"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [reverseGeocode]);

  const onMarkerDragEnd = useCallback(
    (e: MarkerDragEvent) => {
      setLat(e.lngLat.lat);
      setLng(e.lngLat.lng);
      setDirty(true);
      void reverseGeocode(e.lngLat.lat, e.lngLat.lng);
    },
    [reverseGeocode],
  );

  const onMapClick = useCallback(
    (e: MapMouseEvent) => {
      setLat(e.lngLat.lat);
      setLng(e.lngLat.lng);
      setDirty(true);
      void reverseGeocode(e.lngLat.lat, e.lngLat.lng);
    },
    [reverseGeocode],
  );

  function clearSearch() {
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await onSave({ address, neighborhood, latitude: lat, longitude: lng });
        setDirty(false);
        toast.success("Ubicación guardada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al guardar");
      }
    });
  }

  if (!mapboxToken) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
        <AlertCircle className="mx-auto mb-3 text-muted-foreground" size={32} />
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Para activar el selector de mapa configurá la variable{" "}
          <code className="text-foreground font-mono text-xs px-1.5 py-0.5 bg-muted rounded">
            NEXT_PUBLIC_MAPBOX_TOKEN
          </code>
          .
        </p>
      </div>
    );
  }

  const hasPin = lat !== null && lng !== null;

  return (
    <div className="space-y-5">
      {/* Search */}
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setDirty(true);
              if (e.target.value.trim().length < 3) {
                setSuggestions([]);
                setOpen(false);
              }
            }}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Buscá la dirección o el lugar"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            className="w-full h-14 pl-12 pr-12 rounded-2xl border border-border bg-background text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition shadow-sm"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searching || reversing ? (
              <Loader2
                size={16}
                className="text-muted-foreground animate-spin"
              />
            ) : null}
            {query && !searching ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Limpiar"
                className="size-8 grid place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>

        {open && suggestions.length > 0 ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute z-40 mt-2 w-full rounded-2xl border border-border bg-popover shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
          >
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => selectSuggestion(s)}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-accent transition text-left border-b border-border last:border-b-0"
              >
                <div className="mt-0.5 size-9 rounded-full bg-muted grid place-items-center shrink-0">
                  <MapPin size={15} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">
                    {s.primary}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {s.secondary}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={useMyLocation}
        >
          <Locate size={14} />
          Usar mi ubicación actual
        </Button>
        <div
          className={cn(
            "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors",
            hasPin
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
          )}
        >
          {hasPin ? (
            <>
              <Check size={12} />
              Pin marcado en el mapa
            </>
          ) : (
            <>
              <AlertCircle size={12} />
              Falta marcar el punto exacto
            </>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="relative aspect-[16/9] sm:aspect-[2/1] rounded-2xl overflow-hidden border border-border bg-muted shadow-sm">
        <Map
          ref={mapRef}
          mapboxAccessToken={mapboxToken}
          initialViewState={{
            latitude: lat ?? CORDOBA.latitude,
            longitude: lng ?? CORDOBA.longitude,
            zoom: hasPin ? 16 : 12,
          }}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          style={{ width: "100%", height: "100%" }}
          attributionControl={false}
          onClick={onMapClick}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {hasPin ? (
            <Marker
              latitude={lat as number}
              longitude={lng as number}
              anchor="bottom"
              draggable
              onDragEnd={onMarkerDragEnd}
            >
              <DraggablePin />
            </Marker>
          ) : null}
        </Map>
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex justify-center">
          <div className="pointer-events-auto inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-background/95 backdrop-blur border border-border text-muted-foreground shadow-sm">
            <MapPin size={12} />
            {hasPin
              ? "Arrastrá el pin o tocá el mapa para ajustar el punto exacto"
              : "Tocá el mapa para marcar el punto exacto"}
          </div>
        </div>
      </div>

      {/* Resolved info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Dirección
          </div>
          <div className="text-sm font-medium text-foreground mt-1 leading-snug">
            {address || (
              <span className="text-muted-foreground italic font-normal">
                Buscá una dirección arriba
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <label className="block">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Barrio
            </div>
            <input
              value={neighborhood}
              onChange={(e) => {
                setNeighborhood(e.target.value);
                setDirty(true);
              }}
              placeholder="Detectamos uno automáticamente"
              className="w-full mt-1 text-sm font-medium text-foreground bg-transparent focus:outline-none placeholder:text-muted-foreground placeholder:italic placeholder:font-normal"
            />
          </label>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground">
          La latitud y longitud se guardan automáticamente al mover el pin.
        </p>
        <Button onClick={handleSave} disabled={pending || !dirty} size="lg">
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          Guardar ubicación
        </Button>
      </div>
    </div>
  );
}

function DraggablePin() {
  return (
    <div className="group relative cursor-grab active:cursor-grabbing">
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 h-1.5 w-4 rounded-full bg-black/40 blur-[3px]" />
      <div className="relative h-10 w-10 rounded-full bg-primary border-[3px] border-background shadow-lg grid place-items-center transition-transform group-hover:scale-110 group-active:scale-95">
        <MapPin
          size={18}
          className="text-primary-foreground"
          fill="currentColor"
          strokeWidth={0}
        />
        <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
      </div>
    </div>
  );
}

function toSuggestion(f: MapboxFeature): Suggestion {
  const ctx = f.properties.context ?? {};
  const neighborhood =
    ctx.neighborhood?.name ?? ctx.locality?.name ?? null;
  const primary =
    f.properties.name_preferred ?? f.properties.name ?? "Sin nombre";
  const secondary =
    f.properties.place_formatted ??
    f.properties.full_address?.replace(`${primary}, `, "") ??
    "";
  const fullAddress =
    f.properties.full_address ??
    (secondary ? `${primary}, ${secondary}` : primary);
  return {
    id: f.id,
    primary,
    secondary,
    latitude: f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
    neighborhood,
    fullAddress,
  };
}
