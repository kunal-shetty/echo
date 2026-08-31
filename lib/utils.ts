/**
 * @file utils.ts
 * @description General purpose utility functions used throughout the application.
 */

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges Tailwind CSS classes without conflicts.
 * Combines `clsx` for conditional classes and `twMerge` for priority resolution.
 * @param inputs A list of class values (strings, arrays, or objects).
 * @returns A single, merged class string.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
