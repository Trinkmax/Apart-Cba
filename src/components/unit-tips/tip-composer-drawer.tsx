"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import {
  Camera,
  Check,
  ChevronsUpDown,
  ImagePlus,
  Loader2,
  Lock,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  UNIT_TIP_CATEGORIES,
  UNIT_TIP_CATEGORY_META,
} from "@/lib/constants";
import { createUnitTip, uploadTipPhoto } from "@/lib/actions/unit-tips";
import { prepareImageForUpload } from "@/lib/image-compress";
import { cn } from "@/lib/utils";
import type { UnitRef, UnitTipCategory } from "@/lib/types/database";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unidad pre-seleccionada y bloqueada (cuando se abre desde una task). */
  lockedUnit?: UnitRef;
  /** Catálogo de unidades disponibles para el picker (cuando no hay lockedUnit). */
  unitsForPicker?: UnitRef[];
  /** Categoría inicial sugerida. */
  defaultCategory?: UnitTipCategory;
  /** Callback opcional luego de crear (para optimistic insert local). */
  onCreated?: () => void;
}

export function TipComposerDrawer({
  open,
  onOpenChange,
  lockedUnit,
  unitsForPicker = [],
  defaultCategory = "general",
  onCreated,
}: Props) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<UnitTipCategory>(defaultCategory);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(lockedUnit?.id ?? null);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [isSubmitting, startTransition] = useTransition();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Reset on close vía state-derivado (en lugar de useEffect+setState, que
  // dispara warnings de react-hooks/set-state-in-effect). Mismo patrón que
  // cleaning-detail-dialog.tsx con "previous value".
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setContent("");
      setCategory(defaultCategory);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
      setPhotoUrl(null);
      setPhotoUploading(false);
      setSelectedUnitId(lockedUnit?.id ?? null);
    }
  }

  const selectedUnit: UnitRef | null = useMemo(() => {
    if (lockedUnit) return lockedUnit;
    if (!selectedUnitId) return null;
    return unitsForPicker.find((u) => u.id === selectedUnitId) ?? null;
  }, [lockedUnit, selectedUnitId, unitsForPicker]);

  const charCount = content.trim().length;
  const canSubmit =
    !!selectedUnit &&
    charCount >= 3 &&
    charCount <= 2000 &&
    !photoUploading &&
    !isSubmitting;

  async function handlePhotoFile(file: File) {
    setPhotoUploading(true);
    try {
      const prepared = await prepareImageForUpload(file);
      const previewBlobUrl = URL.createObjectURL(prepared);
      setPhotoPreview(previewBlobUrl);

      const fd = new FormData();
      fd.append("file", prepared);
      const res = await uploadTipPhoto(fd);
      if (!res.ok) {
        toast.error("No se pudo subir la foto", { description: res.error });
        URL.revokeObjectURL(previewBlobUrl);
        setPhotoPreview(null);
        return;
      }
      setPhotoUrl(res.url);
    } finally {
      setPhotoUploading(false);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function removePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoUrl(null);
  }

  function handleSubmit() {
    if (!selectedUnit || !canSubmit) return;
    startTransition(async () => {
      try {
        await createUnitTip({
          unit_id: selectedUnit.id,
          content: content.trim(),
          category,
          photo_url: photoUrl,
        });
        toast.success("¡Consejo compartido!");
        onCreated?.();
        onOpenChange(false);
      } catch (e) {
        toast.error("No se pudo compartir", { description: (e as Error).message });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[92vh] flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-base flex items-center gap-2">
            <span className="text-lg">💡</span>
            Compartir un consejo
          </SheetTitle>
          <SheetDescription className="text-xs">
            Pasale tu experiencia al resto del equipo
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Unidad */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Departamento
            </label>
            {lockedUnit ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border">
                <Lock size={13} className="text-muted-foreground shrink-0" />
                <span className="font-mono text-xs text-muted-foreground">{lockedUnit.code}</span>
                <span className="text-sm truncate flex-1">{lockedUnit.name}</span>
              </div>
            ) : (
              <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal h-11"
                  >
                    {selectedUnit ? (
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono text-xs text-muted-foreground">
                          {selectedUnit.code}
                        </span>
                        <span className="truncate">{selectedUnit.name}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Elegí un departamento…</span>
                    )}
                    <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[calc(100vw-2.5rem)] sm:w-96" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar por código o nombre…" />
                    <CommandList>
                      <CommandEmpty>Sin resultados</CommandEmpty>
                      <CommandGroup>
                        {unitsForPicker.map((u) => (
                          <CommandItem
                            key={u.id}
                            value={`${u.code} ${u.name}`}
                            onSelect={() => {
                              setSelectedUnitId(u.id);
                              setUnitPickerOpen(false);
                            }}
                          >
                            <Check
                              size={14}
                              className={cn(
                                "mr-2",
                                selectedUnitId === u.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="font-mono text-xs text-muted-foreground mr-2">
                              {u.code}
                            </span>
                            <span className="truncate">{u.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Categoría */}
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Categoría
            </label>
            <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1 scrollbar-none">
              {UNIT_TIP_CATEGORIES.map((cat) => {
                const meta = UNIT_TIP_CATEGORY_META[cat];
                const active = cat === category;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-medium transition-all",
                      active
                        ? "ring-2 ring-offset-1"
                        : "border-input bg-muted/30 text-muted-foreground hover:bg-muted"
                    )}
                    style={
                      active
                        ? {
                            backgroundColor: meta.color + "1a",
                            color: meta.color,
                            borderColor: meta.color + "60",
                            ["--tw-ring-color" as string]: meta.color + "80",
                          }
                        : undefined
                    }
                  >
                    <span className="text-sm leading-none">{meta.emoji}</span>
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contenido */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Tu consejo
              </label>
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  charCount > 1900 ? "text-amber-600" : "text-muted-foreground"
                )}
              >
                {charCount}/2000
              </span>
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Ej: La hornalla #3 hay que girarla dos veces antes de prender. La llave de paso del agua está atrás del lavarropas."
              className="resize-none text-base"
              autoFocus={!lockedUnit}
            />
          </div>

          {/* Foto opcional */}
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Foto (opcional)
            </label>
            {photoPreview ? (
              <div className="relative inline-block">
                <div className="relative w-32 h-32 rounded-xl overflow-hidden border">
                  <Image
                    src={photoPreview}
                    alt="Preview"
                    fill
                    sizes="128px"
                    unoptimized
                    className="object-cover"
                  />
                  {photoUploading && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Loader2 className="size-5 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={photoUploading}
                  className="absolute -top-1.5 -right-1.5 size-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-sm hover:scale-105 active:scale-95 transition-transform"
                  aria-label="Quitar foto"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 h-11"
                  onClick={() => cameraRef.current?.click()}
                >
                  <Camera size={16} />
                  Cámara
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 h-11"
                  onClick={() => galleryRef.current?.click()}
                >
                  <ImagePlus size={16} />
                  Galería
                </Button>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePhotoFile(f);
                  }}
                />
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePhotoFile(f);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer fijo */}
        <div className="border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full h-12 gap-2 text-base bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md"
          >
            {isSubmitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            Compartir consejo
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
