"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [parentName, setParentName] = useState("");

  const isAuthPage = pathname === "/parent/login" || pathname === "/parent/register";

  useEffect(() => {
    if (!isAuthPage) {
      const data = sessionStorage.getItem("parentData");
      if (data) {
        const parsed = JSON.parse(data);
        setParentName(parsed.fullName || "");
      }
    }
  }, [pathname, isAuthPage]);

  // Navbar and Footer are handled globally in root app/layout.tsx, 
  // so we render only the children here to prevent duplicate bars.
  return <>{children}</>;
}