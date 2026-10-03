import apiClient from "./apiClient";
import type { CorpusFamily, SynthesisStatus } from "./corpusTypes";
import type { PortalInfo, Timeline, WindowUnion } from "./portalTypes";

/** The portal's API: GET only, addressed by window rather than by run. */

export const getPortalInfoAPI = async (): Promise<PortalInfo> => (await apiClient.get("/portal")).data;

export const getTimelineAPI = async (speciesKey: string, regionKey: string): Promise<Timeline> =>
  (await apiClient.get(`/portal/scopes/${speciesKey}/${regionKey}/timeline`)).data;

export const getWindowFamilyAPI = async (windowId: string): Promise<CorpusFamily> =>
  (await apiClient.get(`/portal/windows/${encodeURIComponent(windowId)}/family`)).data;

export const getWindowSynthesisAPI = async (windowId: string): Promise<SynthesisStatus> =>
  (await apiClient.get(`/portal/windows/${encodeURIComponent(windowId)}/synthesis`)).data;

export const getWindowUnionAPI = async (windowId: string): Promise<WindowUnion> =>
  (await apiClient.get(`/portal/windows/${encodeURIComponent(windowId)}/union`)).data;
