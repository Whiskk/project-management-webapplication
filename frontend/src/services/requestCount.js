import { createCountStore } from './countStore';
import { projectsApi } from './projectsApi';

/** Pending project requests awaiting an admin decision (sidebar badge). */
const store = createCountStore(async () => (await projectsApi.requests({ status: 'pending' })).pending);

export const refreshRequestCount = store.refresh;
export const useRequestCount = store.useCount;
