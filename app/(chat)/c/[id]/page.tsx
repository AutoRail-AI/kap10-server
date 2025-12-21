import { ChatContainer } from "@/components/chat"

interface ConversationPageProps {
  params: Promise<{ id: string }>
}

export default async function ConversationPage({ params }: ConversationPageProps) {
  const { id } = await params
  return <ChatContainer conversationId={id} />
}
