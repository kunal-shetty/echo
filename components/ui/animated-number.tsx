"use client";

import { animate, useMotionValue, useTransform, motion } from "motion/react";
import { useEffect } from "react";

interface AnimatedNumberProps {
  value: number;
  /** A function that turns the raw number into the displayed string. */
  format?: (v: number) => string;
  duration?: number;
  className?: string;
}

export function AnimatedNumber({
  value,
  format = (v) =>
    v.toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }),
  duration = 0.6,
  className,
}: AnimatedNumberProps) {
  const motionValue = useMotionValue(value);
  const display = useTransform(motionValue, (latest) => format(Math.round(latest * 100) / 100));

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, motionValue, duration]);

  return <motion.span className={className}>{display}</motion.span>;
}
