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

  // Exempt the public /tutor browse page, login, and register from mandatory login checks
  const isPublicPage = 
    pathname === "/tutor" || 
    pathname === "/tutor/login" || 
    pathname === "/tutor/register";

  useEffect(() => {
    if (!isPublicPage) {
      const data = sessionStorage.getItem("tutorData");
      if (!data) {
        router.push("/tutor/login");
      }
    }
  }, [pathname, router, isPublicPage]);

  // Global Navbar and Footer are handled in root app/layout.tsx.
  // Rendering children directly prevents duplicate wrapper bars.
  return <>{children}</>;
}