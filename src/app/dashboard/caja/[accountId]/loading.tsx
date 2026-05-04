import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="page-x page-y space-y-5 max-w-[1600px] mx-auto">
      <Skeleton className="h-5 w-24" />
      <Card className="p-6">
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24 ml-auto" />
            <Skeleton className="h-9 w-40 ml-auto" />
            <Skeleton className="h-12 w-72" />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24 mt-2" />
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="p-3 flex items-center gap-3">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
