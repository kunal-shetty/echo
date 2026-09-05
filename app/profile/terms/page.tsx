"use client";

import { Header } from "@/components/home/header";
import { useApp } from "@/context/AppContext";

export default function TermsPage() {
  const { setVoiceOpen } = useApp();

  return (
    <>
      <Header screen="terms" onVoice={() => setVoiceOpen(true)} scrolled={false} />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel !p-4">
          <h2 className="text-lg font-semibold mb-4">Terms of Service</h2>
          <div className="text-xs text-muted-foreground space-y-4 leading-relaxed">
            <p>Last updated: September 5, 2026</p>
            <p>By using Echo, you agree to the following terms:</p>
            <h3 className="text-sm font-medium text-foreground">Service Use</h3>
            <p>Echo is a tool for financial tracking. While we strive for accuracy, Echo is not a certified accounting software.</p>
            <h3 className="text-sm font-medium text-foreground">User Responsibilities</h3>
            <p>You are responsible for the accuracy of the data you provide and the security of your account credentials.</p>
            <h3 className="text-sm font-medium text-foreground">Limitations</h3>
            <p>Echo is provided "as is". We are not liable for any financial losses resulting from the use of this application.</p>
          </div>
        </div>
      </main>
    </>
  );
}
