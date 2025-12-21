"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { MessageSquare, FileText, HelpCircle, Lightbulb } from "lucide-react"

interface WelcomeScreenProps {
  onSuggestionClick?: (suggestion: string) => void
}

const suggestions = [
  {
    icon: FileText,
    title: "Draft an appeal letter",
    prompt: "Help me write an appeal letter for a denied insurance claim",
  },
  {
    icon: HelpCircle,
    title: "Review my case",
    prompt: "I received a denial letter. Can you help me understand what went wrong?",
  },
  {
    icon: Lightbulb,
    title: "Appeal strategy",
    prompt: "What are the best strategies for appealing a medical claim denial?",
  },
  {
    icon: MessageSquare,
    title: "Ask a question",
    prompt: "What information do I need to include in my appeal?",
  },
]

export function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome to AppealGen AI
          </h1>
          <p className="text-muted-foreground">
            Your intelligent assistant for drafting and managing appeal letters.
            How can I help you today?
          </p>
        </div>

        {/* Suggestion Cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          {suggestions.map((suggestion, index) => {
            const Icon = suggestion.icon
            return (
              <Card
                key={index}
                className="group cursor-pointer p-4 transition-colors hover:bg-muted/50"
                onClick={() => onSuggestionClick?.(suggestion.prompt)}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-medium leading-none">
                      {suggestion.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {suggestion.prompt}
                    </p>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>

        {/* Footer hint */}
        <p className="text-center text-xs text-muted-foreground">
          Start typing below or click a suggestion to begin
        </p>
      </div>
    </div>
  )
}
