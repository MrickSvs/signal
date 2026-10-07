import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A number that opens its proof (SPEC §12.1): the metrics behind it, the ids it counts. Values
 * arrive computed and formatted by the server: nothing is computed here.
 */
export function ProofNumber({
  label,
  value,
  className,
  children,
}: {
  label: string;
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} : ${value}, voir le détail`}
        className={cn(
          "cursor-pointer rounded-sm text-left font-semibold tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-signal focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          className,
        )}
      >
        {value}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[70vh] w-[28rem] gap-3 overflow-y-auto p-3.5 text-sm"
      >
        <p className="font-medium">{label}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}
