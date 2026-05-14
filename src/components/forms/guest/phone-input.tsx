"use client";

import * as React from "react";
import PhoneInputBase, {
  type Country,
} from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { cn } from "@/lib/utils";

interface PhoneInputProps {
  value: string | null | undefined;
  onChange: (value: string | undefined) => void;
  defaultCountry?: Country;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  invalid?: boolean;
}

/**
 * Envoltorio de `react-phone-number-input` con estilo shadcn (mismo border,
 * height, radius y focus ring que `<Input />`). El styling fino vive en
 * `globals.css` bajo la clase `.shadcn-phone-input`.
 */
export function PhoneInput({
  value,
  onChange,
  defaultCountry = "AR" as Country,
  id,
  placeholder,
  disabled,
  className,
  ariaLabel = "Teléfono",
  invalid,
}: PhoneInputProps) {
  return (
    <PhoneInputBase
      id={id}
      value={value ?? undefined}
      onChange={onChange}
      defaultCountry={defaultCountry}
      international
      countryCallingCodeEditable={false}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={cn("shadcn-phone-input", invalid && "is-invalid", className)}
      numberInputProps={{
        // Aseguramos que el input interno respete los mismos focus/hover/disabled
        // tokens que el <Input /> de shadcn.
        className: "shadcn-phone-input__input",
      }}
    />
  );
}
