import type { AnnotationSeverity } from "./use-ax-snapshot";

const OPTIONS: Array<{ value: AnnotationSeverity; label: string }> = [
  { value: "suggestion", label: "Polish" },
  { value: "important", label: "Issue" },
  { value: "blocking", label: "Blocker" },
];

export function SeverityControl({
  value,
  onChange,
}: {
  value: AnnotationSeverity;
  onChange: (value: AnnotationSeverity) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/18 p-1" aria-label="Annotation severity">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`h-7 rounded-md text-[10px] font-medium [transition-property:background,color,scale] duration-150 active:scale-[0.96] ${
            value === option.value
              ? "bg-white/[0.13] text-white"
              : "bg-transparent text-white/45 hover:text-white/75"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
