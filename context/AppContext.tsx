"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import type { UserInfo, Transaction } from "@/lib/schema";

interface AppContextType {
  // User State
  user: UserInfo;
  setUser: React.Dispatch<React.SetStateAction<UserInfo>>;
  updateUser: (patch: Partial<UserInfo>) => void;

  // Navigation & UI State
  addMode: "single" | "bulk" | "category" | null;
  setAddMode: (mode: "single" | "bulk" | "category" | null) => void;
  editing: Transaction | null;
  setEditing: (tx: Transaction | null) => void;

  voiceOpen: boolean;
  setVoiceOpen: (open: boolean) => void;

  toast: string | null;
  setToast: (message: string | null) => void;

  // Onboarding
  onboarded: boolean;
  setOnboarded: (done: boolean) => void;
}

const DEFAULT_USER: UserInfo = {
  name: "",
  currency: "INR",
  reminderTime: "evening",
};

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo>(DEFAULT_USER);
  const [onboarded, setOnboarded] = useState(false);
  const [addMode, setAddMode] = useState<"single" | "bulk" | "category" | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    try {
      const done = window.localStorage.getItem("echo-onboarded-v1");
      const userRaw = window.localStorage.getItem("echo-user-info-v1");
      if (userRaw) {
        const parsed = JSON.parse(userRaw) as Partial<UserInfo>;
        setUser({ ...DEFAULT_USER, ...parsed });
      }
      setOnboarded(done === "true");
    } catch {
      /* ignore */
    }
  }, []);

  const updateUser = (patch: Partial<UserInfo>) => {
    setUser((u) => {
      const next = { ...u, ...patch };
      try {
        window.localStorage.setItem("echo-user-info-v1", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

    const serverPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) serverPatch.display_name = patch.name;
    if (patch.currency !== undefined) serverPatch.home_currency = patch.currency;
    if (patch.reminderTime !== undefined) serverPatch.reminder_time = patch.reminderTime;
    if (Object.keys(serverPatch).length === 0) return;

    void fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverPatch),
    }).catch(() => {});
  };

  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        updateUser,
        onboarded,
        setOnboarded,
        addMode,
        setAddMode,
        editing,
        setEditing,
        voiceOpen,
        setVoiceOpen,
        toast,
        setToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppContextProvider");
  }
  return context;
}
