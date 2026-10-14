import { createCountStore } from './countStore';
import { projectsApi } from './projectsApi';

/** Hour requests awaiting the signed-in manager's approval (sidebar badge). */
const store = createCountStore(async () => (await projectsApi.approvals()).total);

export const refreshApprovalCount = store.refresh;
export const clearApprovalCount = store.clear;
export const useApprovalCount = store.useCount;
