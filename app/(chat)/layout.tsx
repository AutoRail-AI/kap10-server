import { ChatLayout } from "@/components/chat"

export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ChatLayout>{children}</ChatLayout>
}
