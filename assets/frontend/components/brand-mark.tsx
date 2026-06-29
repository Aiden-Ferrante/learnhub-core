// Channel brand mark for txt2kg — a small knowledge graph (text → nodes → learn).
// Uses currentColor so callers set the hue (brand blue via text-nvidia-green / text-primary).
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      {/* edges */}
      <g strokeWidth="2" strokeLinecap="round" opacity="0.55">
        <line x1="13" y1="15" x2="33" y2="11" />
        <line x1="13" y1="15" x2="16" y2="34" />
        <line x1="33" y1="11" x2="35" y2="29" />
        <line x1="16" y1="34" x2="35" y2="29" />
      </g>
      {/* nodes */}
      <g fill="currentColor" stroke="none">
        <circle cx="13" cy="15" r="4.2" />
        <circle cx="33" cy="11" r="3.2" opacity="0.8" />
        <circle cx="16" cy="34" r="3.2" opacity="0.8" />
        <circle cx="35" cy="29" r="5" />
      </g>
    </svg>
  )
}
