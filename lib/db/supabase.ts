import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./types"

let instance: SupabaseClient<Database> | null = null

// Placeholder used during build when env vars are not set (e.g. CI)
const PLACEHOLDER_URL = "https://placeholder.supabase.co"
const PLACEHOLDER_KEY = "placeholder-key"

/**
 * Get Supabase server client. createClient is required() on first call so the
 * build does not load @supabase/supabase-js or connect to Supabase.
 */
function getSupabase(): SupabaseClient<Database> {
    if (!instance) {
        const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js")
        const url =
            process.env.SUPABASE_URL ||
            process.env.NEXT_PUBLIC_SUPABASE_URL ||
            PLACEHOLDER_URL
        const key =
            process.env.SUPABASE_SECRET_KEY ||
            process.env.SUPABASE_SERVICE_ROLE_KEY ||
            PLACEHOLDER_KEY

        instance = createClient<Database>(url, key, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        })
    }
    return instance
}

export const supabase = new Proxy({} as SupabaseClient<Database>, {
    get(_target, prop) {
        return getSupabase()[prop as keyof SupabaseClient<Database>]
    },
})
