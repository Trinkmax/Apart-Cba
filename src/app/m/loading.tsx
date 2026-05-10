import { Skeleton } from "@/components/ui/skeleton";

export default function MobileLoading() {
  return (
    <div className="p-4 space-y-3 pb-24">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-56" />
      <div className="grid grid-cols-2 gap-3 mt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-32 rounded-xl mt-2" />
    </div>
  );
}
