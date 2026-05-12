import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 mt-16">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h4 className="font-semibold text-sm text-neutral-900 mb-3">Soporte</h4>
            <ul className="space-y-2 text-sm text-neutral-600">
              <li><Link href="/buscar" className="hover:underline">Centro de ayuda</Link></li>
              <li><Link href="/legal/privacidad" className="hover:underline">Cancelaciones</Link></li>
              <li><Link href="/legal/privacidad" className="hover:underline">Reportar un problema</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm text-neutral-900 mb-3">Anfitriones</h4>
            <ul className="space-y-2 text-sm text-neutral-600">
              <li><Link href="/login" className="hover:underline">Panel de gestión</Link></li>
              <li><Link href="/login" className="hover:underline">Publicar mi unidad</Link></li>
              <li><Link href="/login" className="hover:underline">Recursos</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm text-neutral-900 mb-3">rentOS</h4>
            <ul className="space-y-2 text-sm text-neutral-600">
              <li><Link href="/" className="hover:underline">Descubrir</Link></li>
              <li><Link href="/buscar" className="hover:underline">Explorar destinos</Link></li>
              <li><Link href="/favoritos" className="hover:underline">Favoritos</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm text-neutral-900 mb-3">Legal</h4>
            <ul className="space-y-2 text-sm text-neutral-600">
              <li><Link href="/legal/terminos" className="hover:underline">Términos</Link></li>
              <li><Link href="/legal/privacidad" className="hover:underline">Privacidad</Link></li>
              <li><Link href="/legal/eliminacion-de-datos" className="hover:underline">Eliminación de datos</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-neutral-200 flex flex-col md:flex-row justify-between gap-3 text-xs text-neutral-500">
          <div>© {new Date().getFullYear()} rentOS — Reservá tu próximo lugar</div>
          <div>Hecho en Argentina · Pesos argentinos (ARS)</div>
        </div>
      </div>
    </footer>
  );
}
