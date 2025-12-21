import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, LayoutDashboard, History, FileEdit, FolderOpen, Settings } from "lucide-react"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "History", href: "/history", icon: History },
  { name: "Letterhead", href: "/letterhead", icon: FileEdit },
  { name: "Documents", href: "/documents", icon: FolderOpen },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/chat">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="sr-only">Back to chat</span>
                </Link>
              </Button>
              <div>
                <h1 className="text-lg font-semibold">Dashboard</h1>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-2">
              {navigation.map((item) => (
                <Button key={item.name} variant="ghost" size="sm" asChild>
                  <Link href={item.href}>
                    <item.icon className="h-4 w-4 mr-2" />
                    {item.name}
                  </Link>
                </Button>
              ))}
            </nav>
            <Button variant="ghost" size="icon" asChild className="md:hidden">
              <Link href="/settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <nav className="md:hidden border-b overflow-x-auto">
        <div className="flex px-4 py-2 gap-2">
          {navigation.map((item) => (
            <Button key={item.name} variant="ghost" size="sm" asChild>
              <Link href={item.href} className="whitespace-nowrap">
                <item.icon className="h-4 w-4 mr-2" />
                {item.name}
              </Link>
            </Button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main>{children}</main>
    </div>
  )
}
