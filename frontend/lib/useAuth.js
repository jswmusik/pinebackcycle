"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "./api";

// Hämtar inloggad användare. Skickar till /login om man inte är inloggad.
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    auth
      .me()
      .then((u) => {
        if (active) {
          setUser(u);
          setLoading(false);
        }
      })
      .catch(() => {
        router.replace("/login");
      });
    return () => {
      active = false;
    };
  }, [router]);

  return { user, loading };
}
