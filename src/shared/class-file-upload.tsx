"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  completeUpload,
  deleteUpload,
  getUploadStatus,
  putUploadBytes,
  reserveUpload,
  type UploadStatus,
} from "@/lib/data/uploads";

const MAX_BYTES = 150 * 1024 * 1024;
const POLL_MS = 2000;
const ACCEPT = ".pdf,.docx,.txt,.md,.csv";

type Phase = "uploading" | "reading" | "ready" | "partial" | "failed" | "error";

interface Attachment {
  key: string;
  fileName: string;
  materialId: string | null;
  phase: Phase;
  message: string | null;
}

const isUsable = (a: Attachment) => a.phase === "ready" || a.phase === "partial";

export function ClassFileUpload({
  classId,
  disabled = false,
  clearWhenReady = false,
  actions,
  onUsableChange,
  onAttached,
}: {
  classId: string;
  disabled?: boolean;
  /** Drop the chip once the file is read, for surfaces that list the material themselves. */
  clearWhenReady?: boolean;
  /** Sibling source controls, so they sit in one row of peers rather than reading as an afterthought. */
  actions?: React.ReactNode;
  onUsableChange?: (hasUsable: boolean) => void;
  onAttached?: () => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const itemsRef = useRef<Attachment[]>([]);
  const pendingRef = useRef<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(
    (next: Attachment[]) => {
      itemsRef.current = next;
      setItems(next);
      onUsableChange?.(next.some(isUsable));
    },
    [onUsableChange],
  );

  const patch = useCallback(
    (key: string, fields: Partial<Attachment>) => {
      commit(itemsRef.current.map((a) => (a.key === key ? { ...a, ...fields } : a)));
    },
    [commit],
  );

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const applyStatus = useCallback(
    (key: string, status: UploadStatus) => {
      if (status.status === "ready" || status.status === "partial") {
        pendingRef.current.delete(status.materialId);
        if (clearWhenReady) {
          commit(itemsRef.current.filter((a) => a.key !== key));
        } else {
          patch(key, { phase: status.status, message: status.note });
        }
        onAttached?.();
      } else if (status.status === "failed") {
        // No onAttached() — the note explaining the failure is written for
        // her, and a surface that closes this control on attach would take
        // it off the screen before she read it.
        pendingRef.current.delete(status.materialId);
        patch(key, { phase: "failed", message: status.note ?? "That file couldn't be read." });
      } else {
        patch(key, { phase: "reading", message: null });
      }
      if (pendingRef.current.size === 0) stopPolling();
    },
    [clearWhenReady, commit, onAttached, patch],
  );

  const startPolling = useCallback(
    (materialId: string) => {
      pendingRef.current.add(materialId);
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        for (const id of Array.from(pendingRef.current)) {
          const target = itemsRef.current.find((a) => a.materialId === id);
          if (!target) {
            pendingRef.current.delete(id);
            continue;
          }
          try {
            applyStatus(target.key, await getUploadStatus(id));
          } catch {
            // A hiccup mid-poll isn't worth showing her — the next tick retries.
          }
        }
        if (pendingRef.current.size === 0) stopPolling();
      }, POLL_MS);
    },
    [applyStatus],
  );

  async function attach(file: File) {
    const key = `${file.name}-${Date.now()}-${Math.random()}`;
    const entry: Attachment = {
      key,
      fileName: file.name,
      materialId: null,
      phase: "uploading",
      message: null,
    };

    if (file.size > MAX_BYTES) {
      commit([...itemsRef.current, { ...entry, phase: "error", message: "That file is over the 150 MB limit." }]);
      return;
    }
    commit([...itemsRef.current, entry]);

    try {
      const reservation = await reserveUpload(classId, file);
      patch(key, { materialId: reservation.materialId });
      await putUploadBytes(reservation.uploadUrl, file);
      patch(key, { phase: "reading" });
      // Deliberately no onAttached() here: a surface that lists its
      // materials also tends to close this control on attach, and doing
      // that mid-read would unmount the poll before the file is read.
      const status = await completeUpload(reservation.materialId);
      applyStatus(key, status);
      if (!["ready", "partial", "failed"].includes(status.status)) {
        startPolling(reservation.materialId);
      }
    } catch (e) {
      patch(key, {
        phase: "error",
        message: e instanceof Error ? e.message : "Couldn't attach that file.",
      });
    }
  }

  function remove(key: string) {
    const target = itemsRef.current.find((a) => a.key === key);
    if (target?.materialId) {
      pendingRef.current.delete(target.materialId);
      deleteUpload(target.materialId).catch(() => {});
    }
    if (pendingRef.current.size === 0) stopPolling();
    commit(itemsRef.current.filter((a) => a.key !== key));
    onAttached?.();
  }

  return (
    <div className="space-y-2">
      {items.map((a) => (
        <div
          key={a.key}
          className="flex items-start justify-between gap-2 rounded-md border border-border p-2.5"
        >
          <div className="min-w-0 space-y-1">
            <p className="truncate text-xs font-medium">{a.fileName}</p>
            {a.phase === "uploading" || a.phase === "reading" ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {a.phase === "uploading" ? "Uploading…" : "Reading your document…"}
              </p>
            ) : a.phase === "ready" ? (
              <Badge variant="success">Ready</Badge>
            ) : a.phase === "partial" ? (
              <>
                <Badge variant="warning">Ready</Badge>
                {a.message ? <p className="text-xs text-muted-foreground">{a.message}</p> : null}
              </>
            ) : (
              <p className="text-xs text-destructive">{a.message}</p>
            )}
          </div>
          {!disabled ? (
            <button
              type="button"
              onClick={() => remove(a.key)}
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${a.fileName}`}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ))}

      {!disabled ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <label
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer focus-within:ring-2 focus-within:ring-ring",
              )}
            >
              <Paperclip className="size-3.5" />
              Attach a document
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => {
                  for (const file of Array.from(e.target.files ?? [])) attach(file);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              />
            </label>
            {actions}
          </div>
          <p className="text-xs text-muted-foreground">
            PDF, DOCX, TXT, MD or CSV — up to 150 MB. Scans are transcribed automatically.
          </p>
        </>
      ) : null}
    </div>
  );
}
