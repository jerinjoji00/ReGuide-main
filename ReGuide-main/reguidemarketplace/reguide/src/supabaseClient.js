import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://uzjbuittxtlphqsjqask.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6amJ1aXR0eHRscGhxc2pxYXNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NTkwNTQsImV4cCI6MjA4NzQzNTA1NH0.IBLpVHgBBS_JLTQ4cV7GJ7VGr7bErIXikv175cWrczs";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
