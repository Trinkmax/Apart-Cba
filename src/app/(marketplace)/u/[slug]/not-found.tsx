import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center">
      <div className="text-6xl mb-4">🔍</div>
      <h1 className="text-2xl font-semibold text-neutral-900">Esta unidad no existe o ya no está disponible</h1>
      <p className="mt-3 text-neutral-600">
        Tal vez el anfitrión la quitó del marketplace. Mirá otras opciones increíbles.
      </p>
      <Link
        href="/buscar"
        className="mt-6 inline-flex items-center justify-center rounded-full bg-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-800"
      >
        Ver más lugares
      </Link>
    </div>
  );
}
