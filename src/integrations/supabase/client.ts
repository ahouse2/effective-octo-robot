import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cjjwyvxnjrmqrajayjus.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqand5dnhuanJtcXJhamF5anVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3NjEzMDksImV4cCI6MjA2NjMzNzMwOX0.3_C_HKssUq8ALNSzfngC1Lj6EmUv6IOnn6WVoCgQxn8';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);