"use client";

import { Header } from "@/components/home/header";
import { useApp } from "@/context/AppContext";
import { motion } from "motion/react";
import { MessageSquare } from "lucide-react";

export default function HelpPage() {
  const { setVoiceOpen } = useApp();

  return (
    <>
      <Header
        screen="help"
        onVoice={() => setVoiceOpen(true)}
      />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel !p-4">
          <h2 className="text-lg font-semibold mb-4">
            Frequently Asked Questions
          </h2>
          <div className="flex flex-col gap-4">
            <div className="border-b border-border pb-3">
              <p className="text-sm font-medium">How does Echo work?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Echo uses voice AI to parse your financial intents and
                automatically categorize them.
              </p>
            </div>
            <div className="border-b border-border pb-3">
              <p className="text-sm font-medium">Is my data secure?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Yes, your data is encrypted and stored securely. We never sell
                your financial information.
              </p>
            </div>
          </div>
        </div>
        <motion.button
          type="button"
          className="primary-button"
          onClick={() => setVoiceOpen(true)}
          whileTap={{ scale: 0.98 }}
        >
          <MessageSquare size={17} /> Ask Echo a question
        </motion.button>
      </main>
    </>
  );
}
