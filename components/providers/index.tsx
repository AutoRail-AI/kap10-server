"use client"

import { type ReactNode } from "react"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider } from "./auth-provider"
import { ChatProvider } from "./chat-provider"

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ChatProvider>
        {children}
        <Toaster position="top-right" richColors />
      </ChatProvider>
    </AuthProvider>
  )
}

export { AuthProvider, useAuth } from "./auth-provider"
export { ChatProvider } from "./chat-provider"
