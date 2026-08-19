"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const isAuthPage = pathname === "/tutor/login" || pathname === "/tutor/register";

  useEffect(() => {
    if (!isAuthPage) {
      const data = sessionStorage.getItem("tutorData");
      if (!data) {
        router.push("/tutor/login");
      }
    }
  }, [pathname, router, isAuthPage]);

  // Global Navbar and Footer are handled in root app/layout.tsx.
  // Rendering children directly prevents duplicate wrapper bars.
  return <>{children}</>;
}