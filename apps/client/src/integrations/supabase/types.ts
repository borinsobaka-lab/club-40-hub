export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          avatar_url: string | null
          birthday: string | null
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          gender: string | null
          id: string
          last_name: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      member_profiles: {
        Row: {
          birth_year: number | null
          created_at: string
          current_weekly_activity: number | null
          desired_frequency: number | null
          experience_level: string | null
          gender: string | null
          goal_motivation: string | null
          health_flags: string[]
          health_notes: string | null
          height_cm: number | null
          onboarding_completed_at: string | null
          preferred_times: string[]
          primary_goal: string | null
          referral_source: string | null
          target_timeframe: string | null
          tried_group_hiit: boolean | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          birth_year?: number | null
          created_at?: string
          current_weekly_activity?: number | null
          desired_frequency?: number | null
          experience_level?: string | null
          gender?: string | null
          goal_motivation?: string | null
          health_flags?: string[]
          health_notes?: string | null
          height_cm?: number | null
          onboarding_completed_at?: string | null
          preferred_times?: string[]
          primary_goal?: string | null
          referral_source?: string | null
          target_timeframe?: string | null
          tried_group_hiit?: boolean | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          birth_year?: number | null
          created_at?: string
          current_weekly_activity?: number | null
          desired_frequency?: number | null
          experience_level?: string | null
          gender?: string | null
          goal_motivation?: string | null
          health_flags?: string[]
          health_notes?: string | null
          height_cm?: number | null
          onboarding_completed_at?: string | null
          preferred_times?: string[]
          primary_goal?: string | null
          referral_source?: string | null
          target_timeframe?: string | null
          tried_group_hiit?: boolean | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      news: {
        Row: {
          banner_url: string | null
          created_at: string
          description: string | null
          full_text: string | null
          full_title: string | null
          id: string
          image_url: string | null
          position: number
          published: boolean
          title: string
          updated_at: string
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          full_text?: string | null
          full_title?: string | null
          id?: string
          image_url?: string | null
          position?: number
          published?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          description?: string | null
          full_text?: string | null
          full_title?: string | null
          id?: string
          image_url?: string | null
          position?: number
          published?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_bookings: {
        Row: {
          cancelled_at: string | null
          created_at: string
          entry_id: string
          id: string
          status: Database["public"]["Enums"]["booking_status"]
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          entry_id: string
          id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          entry_id?: string
          id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_bookings_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "schedule_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_entries: {
        Row: {
          booked_count: number
          capacity: number | null
          created_at: string
          ends_at: string
          id: string
          starts_at: string
          workout_id: string | null
        }
        Insert: {
          booked_count?: number
          capacity?: number | null
          created_at?: string
          ends_at: string
          id?: string
          starts_at: string
          workout_id?: string | null
        }
        Update: {
          booked_count?: number
          capacity?: number | null
          created_at?: string
          ends_at?: string
          id?: string
          starts_at?: string
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_entries_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          capacity: number | null
          created_at: string
          id: string
          name: string
          type: string | null
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          id?: string
          name: string
          type?: string | null
        }
        Update: {
          capacity?: number | null
          created_at?: string
          id?: string
          name?: string
          type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      book_schedule_entry: { Args: { p_entry_id: string }; Returns: Json }
      cancel_schedule_booking: { Args: { p_entry_id: string }; Returns: Json }
    }
    Enums: {
      booking_status: "booked" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booking_status: ["booked", "cancelled"],
    },
  },
} as const
