interface IconProps { name: string; className?: string }

export function Icon({ name, className = "" }: IconProps) {
  return <i className={`bi bi-${name} ${className}`} aria-hidden="true" />;
}
