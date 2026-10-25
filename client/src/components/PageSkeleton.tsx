import { Skeleton } from "@/components/ui/skeleton";

// Stand-in for a whole page while the session resolves. Deliberately generic:
// the route guards render this before they know which page is coming, so it
// suggests "a page is loading" rather than mimicking any particular one.
export function PageSkeleton() {
  return (
    <main className="p-8 font-sans text-gray-900" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-4 w-full max-w-sm" />
        <Skeleton className="h-4 w-32" />
      </div>
    </main>
  );
}
