"use client";

import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";

export default function TopBar({ user }) {
  const router = useRouter();

  async function handleLogout() {
    try {
      await auth.logout();
    } catch {
      /* ignorera */
    }
    router.push("/login");
  }

  return (
    <div className="topbar">
      <a href="/" className="brand">
        <span className="brand-mark">🚲</span>
        <span className="brand-name">Pineback</span>
      </a>
      <div className="row">
        {user?.is_superadmin && (
          <a
            className="btn btn-secondary btn-sm"
            href={process.env.NEXT_PUBLIC_ADMIN_URL || "http://127.0.0.1:8001/admin/"}
            target="_blank"
            rel="noreferrer"
          >
            Admin
          </a>
        )}
        {user && (
          <span className="muted hide-mobile">
            {user.first_name || user.username}
          </span>
        )}
        <button className="btn-secondary btn-sm" onClick={handleLogout}>
          Logga ut
        </button>
      </div>
    </div>
  );
}
