/**
 * Theme constants shared between the no-flash inline script and
 * the client-side toggle. Keep this file pure — the inline script
 * is stringified by stripping its source, so any imports here are
 * inlined alongside.
 */

export const THEME_STORAGE_KEY = 'marketing-theme';
export type Theme = 'light' | 'dark';
export const DEFAULT_THEME: Theme = 'light';
