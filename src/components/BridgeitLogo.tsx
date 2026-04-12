export function BridgeitLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="40 40 30 30"
      className={className}
      aria-hidden
    >
      <path fill="#E8B059" d="M40 61h9v9h-9zM40 50.5h9v9h-9zM50.5 61h9v9h-9z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M61 40H50.5v9H61v10.5h9V40h-9z"
        fill="#E8B059"
      />
    </svg>
  );
}
