import { SearchPageSkeleton } from "@/components/marketplace/search/search-page-skeleton";

// Mientras llega /buscar: la misma geometría que la página (barra sticky,
// chips, título y grilla) para que nada salte al aparecer los resultados.
export default function BuscarLoading() {
  return <SearchPageSkeleton />;
}
