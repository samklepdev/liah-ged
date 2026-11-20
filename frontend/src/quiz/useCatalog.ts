import { useOutletContext } from 'react-router';
import type { SubjectSummary } from './api';

export type CatalogContext = {
  subjects: SubjectSummary[];
  /** Drops the sidebar's cached course list for a subject, so the next time
   * it's open it refetches — used after a quiz attempt is submitted so a
   * newly-earned pass tick shows up without a reload. */
  refreshSubject: (slug: string) => void;
};

/**
 * The subject list fetched once by CatalogLayout. Lives apart from the layout
 * component so that file only exports components — Fast Refresh needs that.
 */
export function useCatalog(): CatalogContext {
  return useOutletContext<CatalogContext>();
}
