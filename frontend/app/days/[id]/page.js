"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import TopBar from "@/components/TopBar";
import DayEditor from "@/components/DayEditor";

// Egen sida för en dag (direktlänk). Själva redigeringen sker i <DayEditor>,
// samma komponent som används i modalen på projektsidan.
export default function DayPage() {
  const { user, loading } = useAuth();
  const params = useParams();

  if (loading || !user) return <div className="center-screen muted">Laddar…</div>;

  return (
    <>
      <TopBar user={user} />
      <div className="container">
        <DayEditor dayId={params.id} />
      </div>
    </>
  );
}
