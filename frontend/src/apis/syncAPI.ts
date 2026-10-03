import apiClient from "./apiClient";
import type { LivePage, SyncJobSummary, SyncState } from "./syncTypes";

export const getSyncStateAPI = async (): Promise<SyncState> => (await apiClient.get("/console/sync")).data;

export const startSyncAPI = async (windowKey: string): Promise<SyncJobSummary> =>
  (await apiClient.post("/console/sync", { windowKey })).data;

export const cancelSyncAPI = async (jobId: string): Promise<void> => {
  await apiClient.post(`/console/sync/${jobId}/cancel`);
};

export const getLivePageAPI = async (jobId: string, harvestKey: string, file: string): Promise<LivePage> =>
  (await apiClient.get(`/console/sync/${jobId}/pages/${harvestKey}/${encodeURIComponent(file)}`)).data;

/** The event stream is read with a native EventSource, so it needs the absolute URL. */
export const syncEventsURL = (jobId: string): string =>
  `${import.meta.env.VITE_API_BASE_URL}/console/sync/${jobId}/events`;
