import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://bdwtvnvqlgvphxuibqqp.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkd3R2bnZxbGd2cGh4dWlicXFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxNDU1ODgsImV4cCI6MjA3MTcyMTU4OH0.jhLvdTwUT8TqSctES9o4tmCPGP3Gr1jqMdvclzkXRUk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
