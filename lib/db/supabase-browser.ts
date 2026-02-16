import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./types"

let browserClient: SupabaseClient<Database> | null = null

// Placeholder used during build when env vars are not set (e.g. CI)
const PLACEHOLDER_URL = "https://placeholder.supabase.co"
const PLACEHOLDER_KEY = "placeholder-key"

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
    if (!browserClient) {
        const url =
            process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL
        const key =
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
            PLACEHOLDER_KEY

        browserClient = createBrowserClient<Database>(url, key)
    }
    return browserClient
}
