import apiClient from "./apiClient";
import type {
  Analysis,
  CorpusFamily,
  Harvest,
  Manifest,
  PagesResponse,
  RawPageResponse,
  RecordDetail,
  RecordList,
  SchemaResponse,
  SourceComparison,
  TextOverview,
  TextRows,
} from "./corpusTypes";

const base = (harvestKey: string, runId: string) => `/corpus/${harvestKey}/${runId}`;

export const listHarvestsAPI = async (): Promise<Harvest[]> =>
  (await apiClient.get("/corpus/harvests")).data;

export const getManifestAPI = async (harvestKey: string, runId: string): Promise<Manifest> =>
  (await apiClient.get(`${base(harvestKey, runId)}/manifest`)).data;

export const getAnalysisAPI = async (harvestKey: string, runId: string): Promise<Analysis> =>
  (await apiClient.get(`${base(harvestKey, runId)}/analysis`)).data;

export const listPagesAPI = async (harvestKey: string, runId: string): Promise<PagesResponse> =>
  (await apiClient.get(`${base(harvestKey, runId)}/pages`)).data;

export const getRawPageAPI = async (
  harvestKey: string,
  runId: string,
  file: string,
): Promise<RawPageResponse> =>
  (await apiClient.get(`${base(harvestKey, runId)}/pages/${encodeURIComponent(file)}`)).data;

export const getComparisonAPI = async (
  harvestKey: string,
  runId: string,
): Promise<SourceComparison[]> =>
  (await apiClient.get(`${base(harvestKey, runId)}/comparison`)).data;

export const getFamilyAPI = async (harvestKey: string, runId: string): Promise<CorpusFamily> =>
  (await apiClient.get(`${base(harvestKey, runId)}/family`)).data;

export const getSchemaAPI = async (harvestKey: string, runId: string): Promise<SchemaResponse> =>
  (await apiClient.get(`${base(harvestKey, runId)}/schema`)).data;

export interface ListRecordsParams {
  limit?: number;
  offset?: number;
  search?: string;
  dataResourceUid?: string;
  withText?: boolean;
  invalidOnly?: boolean;
}

export const listRecordsAPI = async (
  harvestKey: string,
  runId: string,
  params: ListRecordsParams = {},
): Promise<RecordList> =>
  (await apiClient.get(`${base(harvestKey, runId)}/records`, { params })).data;

export const getTextAPI = async (harvestKey: string, runId: string): Promise<TextOverview> =>
  (await apiClient.get(`${base(harvestKey, runId)}/text`)).data;

export interface ListTextRowsParams {
  classifier?: "keyword" | "llm";
  limit?: number;
  offset?: number;
  subject?: string;
  condition?: string;
  event?: string;
}

export const listTextRowsAPI = async (
  harvestKey: string,
  runId: string,
  params: ListTextRowsParams = {},
): Promise<TextRows> =>
  (await apiClient.get(`${base(harvestKey, runId)}/text/rows`, { params })).data;

export const getRecordAPI = async (
  harvestKey: string,
  runId: string,
  recordId: string,
): Promise<RecordDetail> =>
  // The record id contains a colon, which axios would otherwise leave unescaped in the path.
  (await apiClient.get(`${base(harvestKey, runId)}/records/${encodeURIComponent(recordId)}`)).data;
