// Registers the document tables with the household sync layer at module load (V-02.1).
// Imported by the tab layout, so the tables exist before the local copy opens.
import { defineSyncTable } from '@/lib/sync';

import { DOCUMENT_SHARES, DOCUMENTS, EVENT_DOCUMENTS } from './tables';

defineSyncTable(DOCUMENTS);
defineSyncTable(DOCUMENT_SHARES);
defineSyncTable(EVENT_DOCUMENTS);
