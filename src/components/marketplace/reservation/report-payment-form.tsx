"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, FileText, ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { Field, FormAlert, inputClass } from "@/components/marketplace/shell/form-fields";
import { reportDepositPayment } from "@/lib/actions/reservation-status";
import { compressImage } from "@/lib/marketplace/image-compress";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { parseAmountInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { amountInputValue, fileSizeLabel } from "./format";

/**
 * Mismo tope que la acción (4 MB): Vercel rechaza los cuerpos de Server Action
 * de más de 4,5 MB antes de llegar al server, aunque el bucket admita 10 MB.
 */
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const RECEIPT_TOO_BIG = "El archivo pesa más de 4 MB. Mandá una captura o comprimilo.";
/** Por debajo de esto una imagen común se sube como está (capturas nítidas). */
const COMPRESS_FROM_BYTES = 1.5 * 1024 * 1024;

const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function receiptKind(file: File): "image" | "heic" | "pdf" | null {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/.test(name)) return "heic";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp)$/.test(name)) return "image";
  return null;
}

interface PreparedReceipt {
  file: File;
  kind: "image" | "heic" | "pdf";
  previewUrl: string | null;
}

/**
 * Prepara el comprobante para subir: las fotos pesadas y las HEIC (que los
 * navegadores del panel no muestran) pasan a JPEG en el navegador. Si la
 * compresión falla, se sube el archivo original: nunca bloqueamos el aviso.
 */
async function prepareReceipt(file: File): Promise<PreparedReceipt | { error: string }> {
  const kind = receiptKind(file);
  if (!kind) return { error: "Subí una imagen (JPG, PNG o HEIC) o un PDF." };

  let upload = file;
  if (kind !== "pdf" && (kind === "heic" || file.size > COMPRESS_FROM_BYTES)) {
    const compressed = await compressImage(file);
    if (compressed && compressed.blob.size < file.size * 1.1) {
      const base = file.name.replace(/\.[^.]+$/, "") || "comprobante";
      upload = new File([compressed.blob], `${base}.jpg`, { type: "image/jpeg" });
    }
  }
  if (upload.size > MAX_RECEIPT_BYTES) return { error: RECEIPT_TOO_BIG };
  const finalKind = upload.type === "image/jpeg" && kind === "heic" ? "image" : kind;
  const previewUrl = PREVIEWABLE.has(upload.type) ? URL.createObjectURL(upload) : null;
  return { file: upload, kind: finalKind, previewUrl };
}

export interface ReportPaymentFormProps {
  /** Link del seguimiento (sin sesión) o, con sesión, el id de la solicitud/reserva. */
  token?: string | null;
  requestId?: string | null;
  /** Monto para prellenar (la seña, o lo que falta de ella); null = vacío. */
  sena: number | null;
  currency: string;
  /** Ayuda bajo el monto; por defecto, "La seña es de $ X." con el monto prellenado. */
  amountHint?: string;
  /** Formulario abierto de entrada (si no, se despliega con el botón). */
  defaultOpen?: boolean;
  /** Texto del botón que despliega el formulario. */
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary";
  title?: string;
  intro?: string;
  className?: string;
}

/**
 * "¿Ya transferiste?" → "Avisar que transferí": monto (prellenado con la
 * seña), comprobante opcional (foto o PDF) y una nota. Es un AVISO, no un
 * cobro: el equipo lo verifica y registra el pago en Caja.
 */
export function ReportPaymentForm({
  token,
  requestId,
  sena,
  currency,
  amountHint,
  defaultOpen = false,
  triggerLabel = "Avisar que transferí",
  triggerVariant = "primary",
  title = "¿Ya transferiste?",
  intro = "Avisanos y lo verificamos. Si tenés el comprobante, sumalo: nos ayuda a encontrar la transferencia más rápido.",
  className,
}: ReportPaymentFormProps) {
  const router = useRouter();
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [amount, setAmount] = useState(() => amountInputValue(sena));
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<PreparedReceipt | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // Libera la vista previa al cambiarla o al desmontar.
  useEffect(() => {
    const url = receipt?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [receipt]);

  function expand() {
    setOpen(true);
    window.setTimeout(() => amountRef.current?.focus(), 30);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = "";
    setReceiptError(null);
    if (!picked) return;
    setPreparing(true);
    try {
      const res = await prepareReceipt(picked);
      if ("error" in res) {
        setReceiptError(res.error);
        return;
      }
      setReceipt(res);
    } finally {
      setPreparing(false);
    }
  }

  // Se deja tipear libre ("70.000", "70000", "$ 70.000,00" pegado del home
  // banking) y se interpreta con la regla es-AR del proyecto (parseAmountInput:
  // punto = miles, coma = decimales). Al salir del campo se muestra prolijo.
  function onAmountChange(raw: string) {
    setAmount(raw.replace(/[^\d.,$\s]/g, "").slice(0, 24));
    if (amountError) setAmountError(null);
  }

  function parsedAmount(): number | null {
    const v = parseAmountInput(amount.replace(/[$\s]/g, ""));
    return v != null && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }

  function onAmountBlur() {
    const v = parsedAmount();
    if (v != null) setAmount(amountInputValue(v));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || preparing) return;
    setError(null);
    const value = parsedAmount();
    if (value == null) {
      setAmountError("Indicá el monto que transferiste.");
      amountRef.current?.focus();
      return;
    }
    const fd = new FormData();
    if (token) fd.set("token", token);
    else if (requestId) fd.set("requestId", requestId);
    fd.set("amount", String(value));
    fd.set("note", note.trim());
    if (receipt) fd.set("receipt", receipt.file, receipt.file.name);

    startTransition(async () => {
      try {
        const res = await reportDepositPayment(fd);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setDone(true);
        router.refresh();
      } catch {
        setError("No pudimos enviar el aviso. Revisá tu conexión y probá de nuevo. Si sigue sin andar, escribinos y mandanos el comprobante.");
      }
    });
  }

  if (done) {
    return (
      <div role="status" className={cn("rounded-3xl bg-leaf-100 p-5 ring-1 ring-leaf-300 sm:p-6", className)}>
        <p className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.01em] text-forest-700">
          <CircleCheck className="size-6 shrink-0" aria-hidden />
          ¡Gracias! Recibimos tu aviso.
        </p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-forest-800">
          Lo revisamos y te confirmamos por WhatsApp y por mail apenas veamos la transferencia acreditada.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={`${formId}-title`}
      className={cn("rounded-3xl bg-cream-200/70 p-5 ring-1 ring-cream-300 sm:p-6", className)}
    >
      <h3 id={`${formId}-title`} className="text-lg font-extrabold tracking-[-0.01em] text-forest-700">
        {title}
      </h3>
      <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-700">{intro}</p>

      {!open ? (
        <ApartButton
          type="button"
          variant={triggerVariant}
          size="lg"
          onClick={expand}
          aria-expanded={false}
          aria-controls={formId}
          className="mt-4 w-full sm:w-auto"
        >
          {triggerLabel}
        </ApartButton>
      ) : (
        <form id={formId} onSubmit={submit} noValidate className="mt-5 space-y-5">
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}

          <Field
            label="Monto que transferiste"
            error={amountError}
            hint={amountHint ?? (sena ? `La seña es de ${formatCurrency(sena, currency)}.` : undefined)}
          >
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-ink-500">
                  $
                </span>
                <input
                  ref={amountRef}
                  id={id}
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => onAmountChange(e.target.value)}
                  onBlur={onAmountBlur}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  className={cn(inputClass, "pl-9 font-semibold tabular-nums")}
                />
              </div>
            )}
          </Field>

          <div className="space-y-2">
            <p className="block text-[0.9375rem] font-semibold text-ink-900" id={`${formId}-receipt-label`}>
              Comprobante <span className="ml-1 font-medium text-ink-500">(opcional)</span>
            </p>
            {receipt ? (
              <div className="flex items-center gap-3 rounded-2xl bg-paper p-2.5 pr-1.5 ring-1 ring-cream-300">
                {receipt.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
                  <img src={receipt.previewUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-leaf-100 text-forest-700">
                    {receipt.kind === "pdf" ? <FileText className="size-6" aria-hidden /> : <ImageIcon className="size-6" aria-hidden />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">{receipt.file.name}</p>
                  <p className="text-[0.8125rem] text-ink-500">
                    {receipt.kind === "pdf" ? "PDF" : "Imagen"} · {fileSizeLabel(receipt.file.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReceipt(null)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-500 outline-none transition-colors hover:bg-forest-700/[0.06] hover:text-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
                  aria-label="Quitar comprobante"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
            ) : (
              <label
                className={cn(
                  "flex min-h-[4.5rem] cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-cream-400 bg-paper/70 px-4 py-3",
                  "transition-colors hover:border-forest-600/50 hover:bg-paper focus-within:border-forest-600 focus-within:ring-[3px] focus-within:ring-forest-500/25",
                  preparing && "pointer-events-none opacity-70",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-forest-700">
                  {preparing ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Paperclip className="size-5" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.9375rem] font-semibold text-forest-700">
                    {preparing ? "Preparando el archivo…" : "Elegir foto, captura o PDF"}
                  </span>
                  <span className="block text-[0.8125rem] text-ink-500">Hasta 4 MB</span>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.heic,.heif,.pdf"
                  onChange={onPickFile}
                  disabled={preparing}
                  aria-labelledby={`${formId}-receipt-label`}
                  aria-describedby={receiptError ? `${formId}-receipt-error` : undefined}
                  className="sr-only"
                />
              </label>
            )}
            {receiptError ? (
              <p id={`${formId}-receipt-error`} role="alert" className="text-sm font-medium text-[#b42318]">
                {receiptError}
              </p>
            ) : null}
          </div>

          <Field label="Nota" optional>
            {({ id, describedBy }) => (
              <textarea
                id={id}
                name="note"
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-describedby={describedBy}
                placeholder="Ej.: la hice desde la cuenta de Juan Pérez."
                className={cn(inputClass, "h-auto min-h-24 resize-y py-3 leading-relaxed")}
              />
            )}
          </Field>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ApartButton
              type="submit"
              variant="cta"
              size="lg"
              disabled={pending || preparing}
              aria-busy={pending}
              className="w-full sm:w-auto"
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Enviando aviso…" : "Enviar aviso"}
            </ApartButton>
            {!defaultOpen ? (
              <ApartButton
                type="button"
                variant="ghost"
                size="lg"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setAmountError(null);
                  setReceiptError(null);
                }}
                className="w-full sm:w-auto"
              >
                Ahora no
              </ApartButton>
            ) : null}
          </div>
          <p className="text-[0.8125rem] leading-relaxed text-ink-500">
            Tu aviso no confirma el pago por sí solo: lo verificamos con el banco y te escribimos.
          </p>
        </form>
      )}
    </section>
  );
}
