"use client";

import { motion } from "motion/react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import type { Insight } from "@/lib/schema";

export function InsightCard({ item }: { item: Insight }) {
  const { title, text, tag, tone } = item.payload;
  return (
    <motion.article
      className={`insight-card ${tone}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">{tag}</span>
        <Sparkles size={16} />
      </div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
      <button
        type="button"
        className="mt-4 inline-flex items-center gap-1 text-sm font-medium transition-transform hover:translate-x-0.5"
      >
        Explore insight <ArrowUpRight size={15} />
      </button>
    </motion.article>
  );
}
