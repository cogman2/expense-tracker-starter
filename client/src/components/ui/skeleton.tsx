import { cn } from "@/lib/utils"

// Decorative by definition: aria-hidden lives here rather than at the call
// sites so no skeleton can leak into the accessibility tree. Regions that
// swap a skeleton for real content carry aria-busy instead.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
