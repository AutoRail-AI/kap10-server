import { redirect } from "next/navigation"

/**
 * Canonical repos list is the dashboard home (/).
 * Redirect /repos to / so there is a single "Repos" URL and the nav stays consistent.
 */
export default function ReposPage() {
  redirect("/")
}
