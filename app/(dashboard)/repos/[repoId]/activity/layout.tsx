export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="py-6 animate-fade-in">
      {children}
    </div>
  )
}
