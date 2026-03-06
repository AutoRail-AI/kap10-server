import { SubTabNav } from "@/components/repo/sub-tab-nav"

export default async function GuardrailsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  const basePath = `/repos/${repoId}/guardrails`

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Guardrails</h1>
        <p className="text-sm text-foreground mt-0.5">Architecture rules, PR reviews, and decision records</p>
      </div>
      <SubTabNav
        basePath={basePath}
        tabs={[
          { label: "Rules", href: "" },
          { label: "Reviews", href: "/reviews" },
          { label: "Decisions", href: "/decisions" },
        ]}
      />
      {children}
    </div>
  )
}
