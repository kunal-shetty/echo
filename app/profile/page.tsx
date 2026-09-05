"use client";

import { ProfileScreen } from "@/components/profile/profile-screen";
import { useApp } from "@/context/AppContext";

export default function Page() {
  const { user, updateUser } = useApp();

  return (
    <ProfileScreen
      onVoice={() => {}} // Handled by AppShell
      scrolled={false} // Handled by AppShell
      user={user}
      onUpdateUser={updateUser}
    />
  );
}

