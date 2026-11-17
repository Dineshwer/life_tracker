import type { Item } from '../sync/types';
/** STUB (the store/integrity agent replaces it): is this item well-formed for its collection? The sync engine quarantines invalid server rows instead of applying them. */
export function validateItem(_collection: string, item: unknown): item is Item { return !!item && typeof item === 'object' && !Array.isArray(item); }
