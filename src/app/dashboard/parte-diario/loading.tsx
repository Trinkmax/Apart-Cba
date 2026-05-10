import { Skeleton } from "@/components/ui/skeleton";

export default function ParteDiarioLoading() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 border rounded-xl p-4">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 3 }).map((__, j) => (
              <Skeleton key={j} className="h-10 rounded-md" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
