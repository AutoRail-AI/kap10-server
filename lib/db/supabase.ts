import { createClient, SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./types"

let instance: SupabaseClient<Database> | null = null

// Placeholder used during build when env vars are not set (e.g. CI)
const PLACEHOLDER_URL = "https://placeholder.supabase.co"
const PLACEHOLDER_KEY = "placeholder-key"

function getSupabase(): SupabaseClient<Database> {
    if (!instance) {
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
