import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
export function cleanWarehouseName(name) {
  if (!name) return 'Warehouse 1';
  return (
    name
      .replace(/^Dhaka\s+Jute\s+Mill\s*[—–-]\s*/i, '')
      .replace(/^Khulna\s+Jute\s+Mill\s*[—–-]\s*/i, '')
      .replace(/^Main\s+Warehouse$/i, 'Warehouse 1')
      .trim() || 'Warehouse 1'
  );
}
