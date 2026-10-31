/**
 * @file agent.ts
 * @description The always-on voice agent (Android only). The agent itself
 * is a native background service; this wraps its Capacitor plugin.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Transaction } from "@/lib/schema";
import { isNativeApp } from "./platform";

export type AgentState =
  | "off"
  | "preparing"
  | "downloading"
  | "listening"
  | "awake"
  | "thinking"
  | "paused"
  | "calibrating"
  | "error";

type Permission = "granted" | "denied" | "prompt" | "prompt-with-rationale";

export interface AgentStatus {
  /** The user turned the agent on (it restarts whenever the app opens). */
  enabled: boolean;
  /** The background service is running right now. */
  running: boolean;
  name: string;
  /** How the recogniser hears the name, recorded with the "teach" step. */
  aliases: string[];
  state: AgentState;
  detail: string;
  /** The offline speech model has been downloaded. */
  modelReady: boolean;
  microphone: Permission;
  notifications: Permission;
  /** Exempt from battery optimisation, so Android won't stop it. */
  batteryUnrestricted: boolean;
}

/** What the agent did after one command (see backend/app/routes/agent.py). */
export interface AgentReply {
  action: "create" | "update" | "delete" | "query" | "draft" | "none";
  transcript?: string;
  spoken: string;
  haptic: "success" | "warning" | "error";
  notification?: { title: string; body: string };
  transaction?: Transaction;
  deletedId?: string;
}

/** Events the native agent sends, by name. */
export interface AgentEvents {
  state: { state: AgentState; detail: string };
  wake: Record<string, never>;
  heard: { text: string };
  turn: { reply: AgentReply };
}

interface EchoAgentPlugin {
  getStatus(): Promise<AgentStatus>;
  configure(options: { name?: string; aliases?: string[] }): Promise<AgentStatus>;
  start(): Promise<AgentStatus>;
  stop(): Promise<AgentStatus>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  calibrate(): Promise<void>;
  openBatterySettings(): Promise<void>;
  addListener<E extends keyof AgentEvents>(
    event: E,
    fn: (data: AgentEvents[E]) => void,
  ): Promise<PluginListenerHandle>;
}

/** The native plugin. Only call it when `isNativeApp()` is true. */
export const EchoAgent = registerPlugin<EchoAgentPlugin>("EchoAgent");

export const DEFAULT_AGENT_NAME = "Echo";

/** Subscribes to an agent event; returns the unsubscribe function. */
export function onAgentEvent<E extends keyof AgentEvents>(
  event: E,
  fn: (data: AgentEvents[E]) => void,
): () => void {
  if (!isNativeApp()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  void EchoAgent.addListener(event, fn).then((h) => {
    if (cancelled) void h.remove();
    else handle = h;
  });
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}

/**
 * Live agent status plus the actions the settings screen needs.
 * `supported` is false in a browser.
 */
export function useAgent() {
  const [supported] = useState(() => typeof window !== "undefined" && isNativeApp());
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      setStatus(await EchoAgent.getStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent unavailable");
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
    return onAgentEvent("state", ({ state, detail }) => {
      setStatus((s) =>
        s ? { ...s, state, detail, running: state !== "off" && state !== "error" } : s,
      );
      if (state === "listening") void refresh();
    });
  }, [refresh]);

  /** Runs a plugin call, keeps the returned status and surfaces errors. */
  const run = useCallback(
    async (fn: () => Promise<AgentStatus | void>) => {
      setError(null);
      try {
        const next = await fn();
        if (next) setStatus(next);
        else await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    },
    [refresh],
  );

  return {
    supported,
    status,
    error,
    refresh,
    start: () => run(() => EchoAgent.start()),
    stop: () => run(() => EchoAgent.stop()),
    configure: (options: { name?: string; aliases?: string[] }) =>
      run(() => EchoAgent.configure(options)),
    calibrate: () => run(() => EchoAgent.calibrate()),
    openBatterySettings: () => run(() => EchoAgent.openBatterySettings()),
  };
}
