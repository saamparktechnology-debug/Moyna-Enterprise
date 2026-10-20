import { z } from 'zod';

export const SEARCH_TYPES = ['ITEM', 'SERIAL', 'INVOICE', 'CUSTOMER'] as const;
export const SearchTypeSchema = z.enum(SEARCH_TYPES);
export type SearchType = z.infer<typeof SearchTypeSchema>;

export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  ITEM: 'Items',
  SERIAL: 'Serial numbers',
  INVOICE: 'Invoices',
  CUSTOMER: 'Customers',
};

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LIMIT = 20;
export const SEARCH_DEFAULT_LIMIT = 5;

/** The words typed, optionally narrowed to some kinds of record (comma separated), and how many of each kind to return. */
export const SearchQuerySchema = z
  .object({
    q: z.string().trim().min(SEARCH_MIN_LENGTH, 'Type at least 2 characters').max(100),
    types: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((part) => part.trim().toUpperCase())
              .filter(Boolean)
          : undefined,
      )
      .pipe(z.array(SearchTypeSchema).min(1).optional()),
    limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT),
  })
  .strict();
export type SearchQuery = z.input<typeof SearchQuerySchema>;

export const SEARCH_MATCHES = [
  'BARCODE',
  'ITEM_CODE',
  'NAME',
  'SERIAL',
  'INVOICE_NO',
  'PHONE',
] as const;

export const SearchResultSchema = z.object({
  type: SearchTypeSchema,
  id: z.uuid(),
  title: z.string(),
  subtitle: z.string(),
  /** The page that lists this kind of record. */
  link: z.string(),
  matchedOn: z.enum(SEARCH_MATCHES),
  /** True when the whole value matched, not just part of it. */
  exact: z.boolean(),
  branchCode: z.string().nullable(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  /** Exact matches first within each kind; kinds in the order items, serial numbers, invoices, customers. */
  results: z.array(SearchResultSchema),
  /** The kinds that were searched: those asked for that the user may see. */
  searched: z.array(SearchTypeSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
