import {
  BulkPreviewSchema,
  MessageCampaignListResponseSchema,
  MessageCampaignSchema,
  MessageOptOutListResponseSchema,
  MessageOptOutSchema,
  MessagingStatusSchema,
} from '@erp/contracts';
import type {
  AddOptOutRequest,
  BulkPreview,
  CreateBulkMessageRequest,
  MessageCampaign,
  MessageCampaignListResponse,
  MessageOptOut,
  MessageOptOutListResponse,
  MessagingStatus,
  PreviewBulkRequest,
  SendDocumentRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export function getMessagingStatus(): Promise<MessagingStatus> {
  return api.get('/messages/status', MessagingStatusSchema);
}
export function previewBulk(values: PreviewBulkRequest): Promise<BulkPreview> {
  return api.post('/messages/bulk/preview', values, BulkPreviewSchema);
}
export function createBulk(values: CreateBulkMessageRequest): Promise<MessageCampaign> {
  return api.post('/messages/bulk', values, MessageCampaignSchema);
}
/** Sends the next few waiting messages of a campaign. */
export function sendCampaign(id: string): Promise<MessageCampaign> {
  return api.post(`/messages/campaigns/${id}/send`, {}, MessageCampaignSchema);
}
export function retryCampaign(id: string): Promise<MessageCampaign> {
  return api.post(`/messages/campaigns/${id}/retry`, {}, MessageCampaignSchema);
}
export function getCampaign(id: string): Promise<MessageCampaign> {
  return api.get(`/messages/campaigns/${id}`, MessageCampaignSchema);
}
export function listCampaigns(params: {
  page: number;
  pageSize: number;
}): Promise<MessageCampaignListResponse> {
  return api.get(
    `/messages/campaigns?page=${params.page}&pageSize=${params.pageSize}`,
    MessageCampaignListResponseSchema,
  );
}
/** Sends an invoice or a receipt to the customer as a PDF. */
export function sendDocument(values: SendDocumentRequest): Promise<MessageCampaign> {
  return api.post('/messages/documents', values, MessageCampaignSchema);
}
export function listOptOuts(): Promise<MessageOptOutListResponse> {
  return api.get('/messages/opt-outs', MessageOptOutListResponseSchema);
}
export function addOptOut(values: AddOptOutRequest): Promise<MessageOptOut> {
  return api.post('/messages/opt-outs', values, MessageOptOutSchema);
}
export function removeOptOut(customerId: string): Promise<MessageOptOutListResponse> {
  return api.delete(`/messages/opt-outs/${customerId}`, MessageOptOutListResponseSchema);
}
