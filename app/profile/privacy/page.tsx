"use client";

import { Header } from "@/components/home/header";
import { useApp } from "@/context/AppContext";

export default function PrivacyPage() {
  const { setVoiceOpen } = useApp();

  return (
    <>
      <Header screen="privacy" onVoice={() => setVoiceOpen(true)} scrolled={false} />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel !p-4">
          <h2 className="text-lg font-semibold mb-4">Privacy Policy</h2>
          <div className="text-xs text-muted-foreground space-y-4 leading-relaxed">
            <p>Last updated: September 5, 2026</p>
            <p>Your privacy is paramount. Echo is designed to be a private companion for your financial life.</p>
            <h3 className="text-sm font-medium text-foreground">Data Collection</h3>
            <p>We collect only the data necessary to provide the service: your transactions, your name, and your preferences.</p>
            <h3 className="text-sm font-medium text-foreground">Data Usage</h3>
            <p>Your data is used solely to generate insights and manage your memories. We do not share your data with third-party advertisers.</p>
            <h3 className="text-sm font-medium text-foreground">Data Storage</h3>
            <p>Data is stored using industry-standard encryption. You have the right to request the deletion of your data at any time.</p>
          </div>
        </div>
      </main>
    </>
  );
}
