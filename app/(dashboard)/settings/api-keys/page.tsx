import { Key } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export default function ApiKeysPage() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/30 mb-4">
        <Key className="h-5 w-5 text-muted-foreground" />
      </div>
      <h2 className="font-grotesk text-base font-semibold text-foreground">API Keys</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        Generate API keys to integrate kap10 with your tools, CI/CD pipelines, and MCP clients.
      </p>
      <Badge variant="outline" className="mt-4 text-xs">
        Coming Soon
      </Badge>
    </div>
  )
}
