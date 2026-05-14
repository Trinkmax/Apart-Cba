"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { isValidPhoneNumber } from "react-phone-number-input";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createGuest,
  updateGuest,
  type GuestInput,
} from "@/lib/actions/guests";
import type { Guest } from "@/lib/types/database";
import type { Country } from "react-phone-number-input";

import { CountryCombobox } from "./country-combobox";
import { StateCombobox, getStatesOfCountry } from "./state-combobox";
import { CityCombobox } from "./city-combobox";
import { PhoneInput } from "./phone-input";

// ---------------------------------------------------------------------------
// Schema (camelCase, según spec)
// ---------------------------------------------------------------------------
const guestFormSchema = z.object({
  fullName: z.string().min(1, "Nombre requerido"),
  docType: z.enum(["DNI", "PASAPORTE", "CUIT", "OTRO"]),
  docNumber: z.string().min(1, "Número requerido"),
  email: z
    .string()
    .email("Email inválido")
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .refine((v) => !v || isValidPhoneNumber(v), "Teléfono inválido")
    .optional()
    .or(z.literal("")),
  countryCode: z.string().length(2, "País requerido"),
  stateCode: z.string().optional(),
  cityName: z.string().optional(),
  notes: z.string().optional(),
});

export type GuestFormValues = z.infer<typeof guestFormSchema>;

// ---------------------------------------------------------------------------

interface NewGuestFormProps {
  /** Si se pasa, el form actúa como "Editar". Si no, crea. */
  guest?: Guest;
  onSubmitted?: (g: Guest) => void;
  onCancel?: () => void;
}

function defaultsFromGuest(guest: Guest | undefined): GuestFormValues {
  const docType = (() => {
    const t = (guest?.document_type ?? "DNI").toUpperCase();
    if (t === "DNI" || t === "PASAPORTE" || t === "CUIT" || t === "OTRO") return t;
    // Legacy: "Pasaporte" → "PASAPORTE", "otro" → "OTRO"
    if (t === "PASAPORTE") return "PASAPORTE";
    return "OTRO";
  })() as GuestFormValues["docType"];

  return {
    fullName: guest?.full_name ?? "",
    docType,
    docNumber: guest?.document_number ?? "",
    email: guest?.email ?? "",
    phone: guest?.phone_e164 ?? guest?.phone ?? "",
    countryCode: guest?.country_code ?? "AR",
    stateCode: guest?.state_code ?? undefined,
    cityName: guest?.city_name ?? guest?.city ?? undefined,
    notes: guest?.notes ?? "",
  };
}

export function NewGuestForm({ guest, onSubmitted, onCancel }: NewGuestFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!guest;

  const initial = useMemo(() => defaultsFromGuest(guest), [guest]);

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<GuestFormValues>({
    resolver: zodResolver(guestFormSchema),
    defaultValues: initial,
    mode: "onSubmit",
  });

  const countryCode = watch("countryCode");
  const stateCode = watch("stateCode");

  // Cascada: cambio de país limpia provincia y ciudad.
  // Sólo limpia si los valores actuales NO corresponden al país nuevo
  // (evita pisar la prellena en el primer render al editar).
  useEffect(() => {
    if (!countryCode) return;
    const states = getStatesOfCountry(countryCode);
    const stateBelongs = stateCode
      ? states.some((s) => s.code === stateCode)
      : true;
    if (!stateBelongs) {
      setValue("stateCode", undefined, { shouldDirty: true });
      setValue("cityName", undefined, { shouldDirty: true });
    }
  }, [countryCode, stateCode, setValue]);

  // Cambiar provincia limpia ciudad (sólo si la ciudad actual no estaba ya
  // ligada al state nuevo; en este caso es más simple: cualquier cambio limpia).
  // RHF nos da el `setValue` directo; lo hacemos en el handler del combobox
  // para que el reset sea inmediato y previsible.

  // Submit -----------------------------------------------------------------
  function onSubmit(values: GuestFormValues) {
    // Mapeo camelCase → snake_case del action. Escribimos tanto las columnas
    // nuevas (country_code/state_code/city_name/phone_e164) como las legacy
    // (country/state_or_province/city/phone) para no romper consumers viejos.
    const stateName = values.stateCode
      ? getStatesOfCountry(values.countryCode).find((s) => s.code === values.stateCode)?.name ??
        null
      : null;

    const payload: GuestInput = {
      full_name: values.fullName.trim(),
      document_type: values.docType,
      document_number: values.docNumber.trim(),
      email: values.email?.trim() || null,
      phone: values.phone || null,
      country: values.countryCode,
      state_or_province: stateName,
      city: values.cityName?.trim() || null,
      country_code: values.countryCode,
      state_code: values.stateCode || null,
      city_name: values.cityName?.trim() || null,
      phone_e164: values.phone || null,
      notes: values.notes?.trim() || null,
    };

    startTransition(async () => {
      try {
        const result =
          isEdit && guest
            ? await updateGuest(guest.id, payload)
            : await createGuest(payload);
        toast.success(isEdit ? "Huésped actualizado" : "Huésped creado");
        onSubmitted?.(result);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        // Evita que el submit burbujee a un <form> padre en el árbol de React
        // (este form se puede abrir dentro de BookingFormDialog).
        e.stopPropagation();
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-4 mt-2"
      noValidate
    >
      {/* Nombre completo */}
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Nombre completo *</Label>
        <Input
          id="fullName"
          autoFocus
          aria-invalid={!!errors.fullName || undefined}
          placeholder="María González"
          {...register("fullName")}
        />
        {errors.fullName && (
          <p className="text-xs text-destructive">{errors.fullName.message}</p>
        )}
      </div>

      {/* Documento */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="docType">Tipo doc.</Label>
          <Controller
            control={control}
            name="docType"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="docType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DNI">DNI</SelectItem>
                  <SelectItem value="PASAPORTE">Pasaporte</SelectItem>
                  <SelectItem value="CUIT">CUIT</SelectItem>
                  <SelectItem value="OTRO">Otro</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="docNumber">Número *</Label>
          <Input
            id="docNumber"
            aria-invalid={!!errors.docNumber || undefined}
            {...register("docNumber")}
          />
          {errors.docNumber && (
            <p className="text-xs text-destructive">{errors.docNumber.message}</p>
          )}
        </div>
      </div>

      {/* Email + Teléfono */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            aria-invalid={!!errors.email || undefined}
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Teléfono</Label>
          <Controller
            control={control}
            name="phone"
            render={({ field }) => (
              <PhoneInput
                id="phone"
                value={field.value}
                onChange={(v) => field.onChange(v ?? "")}
                defaultCountry={"AR" as Country}
                placeholder="+54..."
                invalid={!!errors.phone}
              />
            )}
          />
          {errors.phone && (
            <p className="text-xs text-destructive">{errors.phone.message}</p>
          )}
        </div>
      </div>

      {/* País / Provincia / Ciudad */}
      <CountryStateCityFields
        countryCode={countryCode}
        stateCode={stateCode}
        setStateCode={(v) => {
          setValue("stateCode", v, { shouldDirty: true });
          // Cambio de provincia limpia ciudad
          setValue("cityName", undefined, { shouldDirty: true });
        }}
        setCountryCode={(v) => {
          setValue("countryCode", v, { shouldDirty: true });
        }}
        setCityName={(v) => setValue("cityName", v, { shouldDirty: true })}
        cityName={watch("cityName")}
        errors={{
          countryCode: errors.countryCode?.message,
        }}
      />

      {/* Notas */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notas</Label>
        <Textarea
          id="notes"
          rows={2}
          placeholder="Preferencias, alergias, observaciones…"
          {...register("notes")}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" />}
          {isEdit ? "Guardar" : "Crear huésped"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente para país/provincia/ciudad. Aislado para mantener legibilidad.

interface CountryStateCityFieldsProps {
  countryCode: string;
  stateCode: string | undefined;
  cityName: string | undefined;
  setCountryCode: (v: string) => void;
  setStateCode: (v: string) => void;
  setCityName: (v: string) => void;
  errors: { countryCode?: string };
}

function CountryStateCityFields({
  countryCode,
  stateCode,
  cityName,
  setCountryCode,
  setStateCode,
  setCityName,
  errors,
}: CountryStateCityFieldsProps) {
  const states = useMemo(
    () => (countryCode ? getStatesOfCountry(countryCode) : []),
    [countryCode]
  );
  const hasStates = states.length > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="countryCode">País *</Label>
        <CountryCombobox
          id="countryCode"
          value={countryCode || null}
          onChange={setCountryCode}
        />
        {errors.countryCode && (
          <p className="text-xs text-destructive">{errors.countryCode}</p>
        )}
      </div>

      {hasStates && (
        <div className="space-y-1.5">
          <Label htmlFor="stateCode">Provincia / Estado</Label>
          <StateCombobox
            id="stateCode"
            countryCode={countryCode || null}
            value={stateCode || null}
            onChange={setStateCode}
          />
        </div>
      )}

      <div className={`space-y-1.5 ${!hasStates ? "sm:col-span-2" : ""}`}>
        <Label htmlFor="cityName">Ciudad</Label>
        <CityCombobox
          id="cityName"
          countryCode={countryCode || null}
          stateCode={stateCode || null}
          value={cityName || null}
          onChange={setCityName}
        />
      </div>
    </div>
  );
}
