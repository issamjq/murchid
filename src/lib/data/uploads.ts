import { backendFetch } from "./backend";

// Files a teacher attaches to a class. The browser uploads straight to
// Backblaze with a signed URL, never through our API: a 150MB body would
// sit buffered in a Render container that is also streaming generations.
// completeUpload attaches the file to the class and queues the reading,
// after which it is an ordinary class material — the Goal Planner picks
// it up without being told about it.

export interface UploadReservation {
  materialId: string;
  uploadUrl: string;
  method: string;
  expiresInSeconds: number;
  maxBytes: number;
}

export function reserveUpload(
  classId: string,
  file: { name: string; type: string; size: number },
): Promise<UploadReservation> {
  return backendFetch("/studio/uploads", {
    method: "POST",
    body: { classId, filename: file.name, mimeType: file.type, byteSize: file.size },
  });
}

// Not backendFetch: the signature covers only the host, so this request
// carries none of backendFetch's headers — no Authorization, no
// Content-Type of our own, or Backblaze answers 403.
export async function putUploadBytes(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!res.ok) throw new Error("The upload failed partway through — try again.");
}

export type UploadStatusValue =
  | "awaiting_upload"
  | "queued"
  | "extracting"
  | "ready"
  | "partial"
  | "failed";

export interface UploadStatus {
  materialId: string;
  classId: string;
  title: string;
  filename: string;
  byteSize: number;
  status: UploadStatusValue;
  usable: boolean;
  note: string | null;
  pages?: number;
  pagesRead?: number;
  characters?: number;
  readBy?: string;
  createdAt: string;
  finishedAt?: string | null;
}

export function completeUpload(materialId: string): Promise<UploadStatus> {
  return backendFetch(`/studio/uploads/${materialId}/complete`, { method: "POST" });
}

export function getUploadStatus(materialId: string): Promise<UploadStatus> {
  return backendFetch(`/studio/uploads/${materialId}`);
}

export function deleteUpload(materialId: string): Promise<{ deleted: boolean }> {
  return backendFetch(`/studio/uploads/${materialId}`, { method: "DELETE" });
}
