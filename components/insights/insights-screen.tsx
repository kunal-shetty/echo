"use client";

import { useMemo } from "react";
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
import { type Transaction } from "@/lib/schema";
import { moneyShort, shortMonth } from "@/lib/fmt";

export function InsightsScreen({
  onVoice,
  expenses,
  loading,
  configured,
  scrolled,
}: {
  onVoice: () => void;
  expenses: Transaction[];
  loading: boolean;
  configured: boolean;
  scrolled: boolean;
}) {
  const empty = !loading && expenses.length === 0;
  const { categoryData, monthlyData } = useMemo(
    () => buildSeries(expenses),
    [expenses],
  );

  return (
    <>
      <Header screen="insights" onVoice={onVoice} scrolled={scrolled} />
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
          <EmptyInsights onVoice={onVoice} configured={configured} />
        ) : (
          <>
            <ChartCard title="Spending mix" detail="This month">
              <motion.div
                className="flex items-center gap-4 py-3"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="size-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="value"
                        innerRadius={43}
                        outerRadius={62}
                        paddingAngle={3}
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
                </div>
                <div className="flex flex-1 flex-col gap-3">
                  {categoryData.map((item, i) => (
                    <motion.div
                      className="flex items-center justify-between text-xs"
                      key={item.name}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.3,
                        delay: 0.2 + i * 0.06,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: item.color }}
                        />
                        {item.name}
                      </span>
                      <span className="font-medium">{item.value}%</span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </ChartCard>
            <ChartCard title="Monthly trend" detail="Remembered spend">
              <div className="mt-5 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={monthlyData}
                    margin={{ left: -20, right: 0, top: 8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
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
                      cursor={{ stroke: "var(--border)" }}
                      contentStyle={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        color: "var(--foreground)",
                      }}
                      formatter={(value) => [moneyShort(Number(value ?? 0)), "Spend"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="spend"
                      stroke="var(--chart-1)"
                      fill="url(#trendFill)"
                      strokeWidth={2}
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
    <section className="panel">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-semibold">{title}</p>
          {detail && (
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          )}
        </div>
      </div>
      {children}
    </section>
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
  categoryData: Array<{ name: string; value: number; color: string }>;
  monthlyData: Array<{ month: string; spend: number }>;
} {
  if (expenses.length === 0) {
    return { categoryData: [], monthlyData: [] };
  }

  // Category mix — bucket by category name (or "Uncategorized").
  const byCategory = new Map<string, number>();
  for (const tx of expenses) {
    const key =
      tx.categoryId?.replace(/^cat-/, "") ?? tx.merchantRaw ?? "Other";
    byCategory.set(key, (byCategory.get(key) ?? 0) + tx.amountMinor);
  }
  const totalSpend = Array.from(byCategory.values()).reduce(
    (a, b) => a + b,
    0,
  );
  const categoryData = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value], i) => ({
      name: prettyCategory(name),
      value: totalSpend > 0 ? Math.round((value / totalSpend) * 100) : 0,
      color: PIE_PALETTE[i % PIE_PALETTE.length],
    }));

  // Monthly trend — last 6 months.
  const now = new Date();
  const months: Array<{ month: string; spend: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      spend: 0,
    });
  }
  const monthIndex = new Map(months.map((m, i) => [m.month, i]));
  for (const tx of expenses) {
    const d = new Date(tx.transactedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx != null) months[idx].spend += tx.amountMinor;
  }

  return { categoryData, monthlyData: months };
}

function prettyCategory(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}