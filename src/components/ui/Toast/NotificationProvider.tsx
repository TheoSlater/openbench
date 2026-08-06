import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toast";

export const NotificationProvider = ({ children }: { children: ReactNode }) => (
  <>
    {children}
    <Toaster limit={5} />
  </>
);
