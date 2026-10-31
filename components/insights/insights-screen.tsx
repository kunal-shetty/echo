"use client";

import { useMemo, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Sparkles, Mic } from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Header } from "@/components/home/header";
import { WrappedStory, type WrappedInsight } from "./wrapped-story";
import { type Transaction } from "@/lib/schema";
import { moneyShort, shortMonth } from "@/lib/fmt";
import { useApp } from "@/context/AppContext";
import { EASE_OUT } from "@/lib/motion";
import { useTransactions } from "@/lib/use-transactions";

export function InsightsScreen() {
  const { setVoiceOpen } = useApp();
  const tx = useTransactions();
  const [insights, setInsights] = useState<WrappedInsight[]>([]);

  const expenses = tx.transactions;
  const loading = tx.loading;
  const configured = tx.configured;

  useEffect(() => {
    async function fetchInsights() {
      try {
        const res = await fetch("/api/insights");
        const data = await res.json();
        if (data.insights) setInsights(data.insights);
      } catch {
        // Silently fail for insights
      }
    }
    fetchInsights();
  }, []);

  const empty = !loading && expenses.length === 0;
  const { categoryData, monthlyData } = useMemo(
    () => buildSeries(expenses),
    [expenses],
  );

  return (
    <>
      <Header
        screen="insights"
        onVoice={() => setVoiceOpen(true)}
      />
      <main className="flex flex-col gap-5 px-5 pb-28 echo-stagger">
        <div className="insight-hero">
          <div className="flex items-center gap-2 text-emerald">
            <Sparkles size={17} />
            <span className="eyebrow">Echo intelligence</span>
          </div>
          <h2 className="mt-3 max-w-xs text-2xl font-semibold tracking-tight">
            Small signals. Smarter decisions.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your memory gets more useful every time you tell Echo something.
          </p>
        </div>

        {empty ? (
          <EmptyInsights
            onVoice={() => setVoiceOpen(true)}
            configured={configured}
          />
        ) : (
          <>
            <WrappedStory insights={insights} />
            <ChartCard title="Spending mix" detail="Expenses · This month">
              {categoryData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No spending remembered this month yet.
                </p>
              ) : (
                <motion.div
                  className="flex items-center gap-5 py-3"
                  initial={{ opacity: 0, scale: 0.92 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.6, ease: EASE_OUT }}
                >
                  <div className="relative size-36 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryData}
                          dataKey="value"
                          innerRadius={46}
                          outerRadius={66}
                          paddingAngle={categoryData.length > 1 ? 3 : 0}
                          cornerRadius={5}
                          stroke="none"
                          isAnimationActive
                          animationDuration={900}
                          animationBegin={200}
                        >
                          {categoryData.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Total
                        </p>
                        <p className="text-sm font-semibold tabular-nums">
                          {moneyShort(
                            categoryData.reduce((s, c) => s + c.amount, 0),
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {categoryData.map((item, i) => (
                      <motion.div
                        className="flex flex-col gap-1.5 text-xs"
                        key={item.name}
                        initial={{ opacity: 0, x: -8 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{
                          duration: 0.3,
                          delay: 0.2 + i * 0.06,
                          ease: EASE_OUT,
                        }}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: item.color }}
                            />
                            <span className="truncate">{item.name}</span>
                          </span>
                          <span className="font-medium tabular-nums">
                            {item.value}%
                          </span>
                        </span>
                        <span className="h-1 overflow-hidden rounded-full bg-surface-3">
                          <motion.span
                            className="block h-full rounded-full"
                            style={{ background: item.color }}
                            initial={{ width: 0 }}
                            whileInView={{ width: `${item.value}%` }}
                            viewport={{ once: true }}
                            transition={{
                              duration: 0.8,
                              delay: 0.3 + i * 0.06,
                              ease: EASE_OUT,
                            }}
                          />
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </ChartCard>
            <ChartCard title="Monthly trend" detail="Expenses · last 6 months">
              <div className="mt-5 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={monthlyData}
                    margin={{ left: -20, right: 0, top: 8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="trendFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0.22}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey={(d) => shortMonth(d.month)}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ stroke: "var(--emerald)", strokeOpacity: 0.3 }}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                      itemStyle={{ color: "var(--foreground)" }}
                      contentStyle={{
                        background: "oklch(0.22 0.032 255 / 92%)",
                        border: "1px solid oklch(1 0 0 / 12%)",
                        borderRadius: 12,
                        boxShadow: "0 12px 30px oklch(0.03 0.01 255 / 45%)",
                        backdropFilter: "blur(12px)",
                        color: "var(--foreground)",
                        fontSize: 12,
                      }}
                      formatter={(value) => [
                        moneyShort(Number(value ?? 0)),
                        "Spend",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="spend"
                      stroke="var(--chart-1)"
                      fill="url(#trendFill)"
                      strokeWidth={2.25}
                      dot={false}
                      activeDot={{
                        r: 5,
                        fill: "var(--emerald)",
                        stroke: "var(--background)",
                        strokeWidth: 2,
                      }}
                      isAnimationActive
                      animationDuration={900}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </>
        )}
      </main>
    </>
  );
}

function ChartCard({
  children,
  title,
  detail,
}: {
  children: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <motion.section
      className="panel"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-semibold">{title}</p>
          {detail && (
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          )}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function EmptyInsights({
  onVoice,
  configured,
}: {
  onVoice: () => void;
  configured: boolean;
}) {
  return (
    <motion.section
      className="panel flex flex-col items-center gap-3 py-10 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="text-base font-medium">Nothing to chart yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Add a few memories and Echo will start surfacing patterns and trends.
      </p>
      <motion.button
        type="button"
        className="primary-button mt-2"
        onClick={onVoice}
        whileTap={{ scale: 0.97 }}
        whileHover={{ y: -1 }}
      >
        <Mic size={17} />
        Remember something
      </motion.button>
      {!configured && (
        <p className="mt-2 max-w-xs text-xs text-muted-foreground">
          Backend isn&apos;t configured. Memories stay on this device for now.
        </p>
      )}
    </motion.section>
  );
}

const PIE_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function buildSeries(expenses: Transaction[]): {
  categoryData: Array<{
    name: string;
    amount: number;
    value: number;
    color: string;
  }>;
  monthlyData: Array<{ month: string; spend: number }>;
} {
  const spendRows = expenses.filter((t) => t.direction !== "income");
  if (spendRows.length === 0) {
    return { categoryData: [], monthlyData: [] };
  }

  // The mix covers this month, matching the card's label. Category ids
  // are opaque, so group by the joined display name.
  const now = new Date();
  const monthRows = spendRows.filter((tx) => {
    const d = new Date(tx.transactedAt);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  });
  const byCategory = new Map<string, number>();
  for (const tx of monthRows) {
    const key = tx.categoryName ?? "Uncategorized";
    byCategory.set(key, (byCategory.get(key) ?? 0) + tx.amountMinor);
  }
  const totalSpend = Array.from(byCategory.values()).reduce((a, b) => a + b, 0);
  const sorted = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);
  // Keep four named slices and fold the rest into "Other" so the
  // percentages still add up to roughly 100.
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4).reduce((sum, [, v]) => sum + v, 0);
  if (rest > 0) top.push(["Other", rest]);
  const categoryData = top.map(([name, value], i) => ({
    name,
    amount: value,
    value: totalSpend > 0 ? Math.round((value / totalSpend) * 100) : 0,
    color: PIE_PALETTE[i % PIE_PALETTE.length],
  }));

  const months: Array<{ month: string; spend: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      spend: 0,
    });
  }
  const monthIndex = new Map(months.map((m, i) => [m.month, i]));
  for (const tx of spendRows) {
    const d = new Date(tx.transactedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx != null) months[idx].spend += tx.amountMinor;
  }

  return { categoryData, monthlyData: months };
}
