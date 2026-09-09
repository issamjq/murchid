"use client";

import { createContext, useContext, useState } from "react";

export interface StudioItem {
  title: string;
  kind: "Lesson" | "Presentation" | "Activity" | "Homework" | "Note" | "Exam" | "Quiz";
  classLabel?: string;
  /** The real generated markdown, when there is one to show. */
  content?: string | null;
  /** The class materials this draft was grounded in, when recorded. */
  sources?: { id: string; title: string }[] | null;
}

interface StudioContextValue {
  item: StudioItem | null;
  open: (item: StudioItem) => void;
  close: () => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<StudioItem | null>(null);
  return (
    <StudioContext.Provider value={{ item, open: setItem, close: () => setItem(null) }}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}
