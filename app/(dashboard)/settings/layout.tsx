import { SettingsNav } from "@/components/dashboard/settings-nav"

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Settings
        </h1>
        <p className="text-sm text-foreground mt-0.5">
          Manage your organization, connections, and members.
        </p>
      </div>
      <SettingsNav />
      {children}
    </div>
  )
}
