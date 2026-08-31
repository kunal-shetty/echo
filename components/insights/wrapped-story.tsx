"use client";

import { motion } from "motion/react";
import { Sparkles, TrendingUp, AlertCircle, Heart } from "lucide-react";
import { money } from "@/lib/fmt";

interface WrappedInsight {
  kind: "spend_pattern" | "anomaly" | "trend" | "subscription_check" | "budget_alert";
  payload: {
    title: string;
    text: string;
    hero_metric: string;
    cta: string;
  };
}

export function WrappedStory({ insights }: { insights: WrappedInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-lg font-semibold">Your Wrap</h3>
        <Sparkles size={18} className="text-emerald" />
      </div>

      <div className="grid grid-cols-1 gap-3">
        {insights.map((insight, i) => (
          <motion.div
            key={i}
            className="panel overflow-hidden bg-gradient-to-br from-surface-2 to-surface-3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <div className="flex items-start gap-4 p-1">
              <div className={`size-10 shrink-0 rounded-full flex items-center justify-center ${
                insight.kind === 'anomaly' ? 'bg-orange-soft text-orange' :
                insight.kind === 'spend_pattern' ? 'bg-blue-soft text-blue' :
                'bg-emerald-soft text-emerald'
              }`}>
                {insight.kind === 'anomaly' ? <AlertCircle size={20} /> :
                 insight.kind === 'spend_pattern' ? <TrendingUp size={20} /> :
                 <Heart size={20} />}
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {insight.payload.title}
                </p>
                <p className="text-base font-medium leading-snug">
                  {insight.payload.text}
                </p>
                <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">
                  {insight.payload.hero_metric}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
