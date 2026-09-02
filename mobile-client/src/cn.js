/**
 * cn — lightweight classnames merge (like clsx + tailwind-merge).
 * Usage: cn('px-4 py-2', isActive && 'bg-green-500', className)
 */
export function cn(...inputs) {
  return inputs
    .flat()
    .filter(Boolean)
    .join(' ');
}
