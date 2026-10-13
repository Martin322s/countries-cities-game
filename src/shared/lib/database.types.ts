
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "answer_invalidation_events": {
                  Row: {
                    "action": Database["public"]['Enums']["invalidation_action"],"actor_id": string | null,"category": Database["public"]['Enums']["answer_category"],"created_at": string,"id": number,"player_id": string,"room_id": string,"round_id": string
                  }
                  Insert: {
                    "action": Database["public"]['Enums']["invalidation_action"],"actor_id"?: string | null,"category": Database["public"]['Enums']["answer_category"],"created_at"?: string,"id"?: never,"player_id": string,"room_id": string,"round_id": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["invalidation_action"],"actor_id"?: string | null,"category"?: Database["public"]['Enums']["answer_category"],"created_at"?: string,"id"?: never,"player_id"?: string,"room_id"?: string,"round_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "answer_invalidation_events_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "answer_invalidation_events_round_id_player_id_category_fkey"
      columns: ["round_id","player_id","category"]
isOneToOne: false
      referencedRelation: "answers"
      referencedColumns: ["round_id","player_id","category"]
    }
                  ]
                },"answer_sheets": {
                  Row: {
                    "lock_reason": Database["public"]['Enums']["sheet_lock_reason"] | null,"player_id": string,"room_id": string,"round_id": string,"submitted_at": string | null,"updated_at": string
                  }
                  Insert: {
                    "lock_reason"?: Database["public"]['Enums']["sheet_lock_reason"] | null,"player_id": string,"room_id": string,"round_id": string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "lock_reason"?: Database["public"]['Enums']["sheet_lock_reason"] | null,"player_id"?: string,"room_id"?: string,"round_id"?: string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "answer_sheets_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "answer_sheets_round_id_fkey"
      columns: ["round_id"]
isOneToOne: false
      referencedRelation: "rounds"
      referencedColumns: ["id"]
    }
                  ]
                },"geographic_validation_cache": {
                  Row: {
                    "canonical_name": string,"country_code": string | null,"normalized_name": string,"osm_id": number | null,"osm_type": string | null,"raw_metadata": Json | null,"requested_category": Database["public"]['Enums']["answer_category"],"result": Json,"validated_at": string
                  }
                  Insert: {
                    "canonical_name": string,"country_code"?: string | null,"normalized_name": string,"osm_id"?: number | null,"osm_type"?: string | null,"raw_metadata"?: Json | null,"requested_category": Database["public"]['Enums']["answer_category"],"result": Json,"validated_at"?: string
                  }
                  Update: {
                    "canonical_name"?: string,"country_code"?: string | null,"normalized_name"?: string,"osm_id"?: number | null,"osm_type"?: string | null,"raw_metadata"?: Json | null,"requested_category"?: Database["public"]['Enums']["answer_category"],"result"?: Json,"validated_at"?: string
                  }
                  Relationships: []
                },"answers": {
                  Row: {
"validation_status": Database["public"]['Enums']["answer_validation_status"],"validation_reason": Database["public"]['Enums']["answer_validation_reason"] | null,"validation_suggestion": string | null,"validated_at": string | null,
                    "category": Database["public"]['Enums']["answer_category"],"invalidated_at": string | null,"invalidated_by": string | null,"normalized_value": string,"player_id": string,"raw_value": string,"round_id": string
                  }
                  Insert: {
"validation_status"?: Database["public"]['Enums']["answer_validation_status"],"validation_reason"?: Database["public"]['Enums']["answer_validation_reason"] | null,"validation_suggestion"?: string | null,"validated_at"?: string | null,
                    "category": Database["public"]['Enums']["answer_category"],"invalidated_at"?: string | null,"invalidated_by"?: string | null,"normalized_value"?: string,"player_id": string,"raw_value"?: string,"round_id": string
                  }
                  Update: {
"validation_status"?: Database["public"]['Enums']["answer_validation_status"],"validation_reason"?: Database["public"]['Enums']["answer_validation_reason"] | null,"validation_suggestion"?: string | null,"validated_at"?: string | null,
                    "category"?: Database["public"]['Enums']["answer_category"],"invalidated_at"?: string | null,"invalidated_by"?: string | null,"normalized_value"?: string,"player_id"?: string,"raw_value"?: string,"round_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "answers_round_id_player_id_fkey"
      columns: ["round_id","player_id"]
isOneToOne: false
      referencedRelation: "answer_sheets"
      referencedColumns: ["round_id","player_id"]
    }
                  ]
                },"ready_checks": {
                  Row: {
                    "player_id": string,"ready_at": string,"room_id": string,"round_id": string,"stage": Database["public"]['Enums']["ready_stage"]
                  }
                  Insert: {
                    "player_id": string,"ready_at"?: string,"room_id": string,"round_id": string,"stage": Database["public"]['Enums']["ready_stage"]
                  }
                  Update: {
                    "player_id"?: string,"ready_at"?: string,"room_id"?: string,"round_id"?: string,"stage"?: Database["public"]['Enums']["ready_stage"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "ready_checks_participant_fk"
      columns: ["round_id","player_id"]
isOneToOne: false
      referencedRelation: "answer_sheets"
      referencedColumns: ["round_id","player_id"]
    },{
      foreignKeyName: "ready_checks_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ready_checks_round_id_fkey"
      columns: ["round_id"]
isOneToOne: false
      referencedRelation: "rounds"
      referencedColumns: ["id"]
    }
                  ]
                },"room_players": {
                  Row: {
                    "display_name": string,"display_name_key": string,"joined_at": string,"last_seen_at": string,"left_at": string | null,"left_reason": Database["public"]['Enums']["member_left_reason"] | null,"player_id": string,"room_id": string
                  }
                  Insert: {
                    "display_name": string,"display_name_key": string,"joined_at"?: string,"last_seen_at"?: string,"left_at"?: string | null,"left_reason"?: Database["public"]['Enums']["member_left_reason"] | null,"player_id": string,"room_id": string
                  }
                  Update: {
                    "display_name"?: string,"display_name_key"?: string,"joined_at"?: string,"last_seen_at"?: string,"left_at"?: string | null,"left_reason"?: Database["public"]['Enums']["member_left_reason"] | null,"player_id"?: string,"room_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "room_players_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"rooms": {
                  Row: {
                    "capacity": number,"code": string,"created_at": string,"current_round_id": string | null,"finished_at": string | null,"host_player_id": string,"id": string,"phase": Database["public"]['Enums']["game_phase"],"results_revision": number,"updated_at": string,"used_letters": (string)[]
                  }
                  Insert: {
                    "capacity": number,"code": string,"created_at"?: string,"current_round_id"?: string | null,"finished_at"?: string | null,"host_player_id": string,"id"?: string,"phase"?: Database["public"]['Enums']["game_phase"],"results_revision"?: number,"updated_at"?: string,"used_letters"?: (string)[]
                  }
                  Update: {
                    "capacity"?: number,"code"?: string,"created_at"?: string,"current_round_id"?: string | null,"finished_at"?: string | null,"host_player_id"?: string,"id"?: string,"phase"?: Database["public"]['Enums']["game_phase"],"results_revision"?: number,"updated_at"?: string,"used_letters"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "rooms_current_round_fk"
      columns: ["current_round_id"]
isOneToOne: false
      referencedRelation: "rounds"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rooms_host_is_member"
      columns: ["id","host_player_id"]
isOneToOne: false
      referencedRelation: "room_players"
      referencedColumns: ["room_id","player_id"]
    }
                  ]
                },"rounds": {
                  Row: { "validation_attempts": number,
"validation_started_at": string | null,"validation_finished_at": string | null,"validation_claim": string | null,"validation_claimed_at": string | null,
                    "countdown_at": string | null,"created_at": string,"ends_at": string | null,"id": string,"letter": string | null,"lock_reason": Database["public"]['Enums']["round_lock_reason"] | null,"locked_at": string | null,"reveal_at": string | null,"room_id": string,"round_number": number,"started_at": string | null
                  }
                  Insert: { "validation_attempts"?: number,
"validation_started_at"?: string | null,"validation_finished_at"?: string | null,"validation_claim"?: string | null,"validation_claimed_at"?: string | null,
                    "countdown_at"?: string | null,"created_at"?: string,"ends_at"?: string | null,"id"?: string,"letter"?: string | null,"lock_reason"?: Database["public"]['Enums']["round_lock_reason"] | null,"locked_at"?: string | null,"reveal_at"?: string | null,"room_id": string,"round_number": number,"started_at"?: string | null
                  }
                  Update: { "validation_attempts"?: number,
"validation_started_at"?: string | null,"validation_finished_at"?: string | null,"validation_claim"?: string | null,"validation_claimed_at"?: string | null,
                    "countdown_at"?: string | null,"created_at"?: string,"ends_at"?: string | null,"id"?: string,"letter"?: string | null,"lock_reason"?: Database["public"]['Enums']["round_lock_reason"] | null,"locked_at"?: string | null,"reveal_at"?: string | null,"room_id"?: string,"round_number"?: number,"started_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rounds_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    }
                  ]
                },"visibility_events": {
                  Row: {
                    "away_at": string,"created_at": string,"ended_by": Database["public"]['Enums']["visibility_end_reason"] | null,"id": number,"player_id": string,"returned_at": string | null,"room_id": string,"round_id": string,"source": Database["public"]['Enums']["visibility_source"]
                  }
                  Insert: {
                    "away_at": string,"created_at"?: string,"ended_by"?: Database["public"]['Enums']["visibility_end_reason"] | null,"id"?: never,"player_id": string,"returned_at"?: string | null,"room_id": string,"round_id": string,"source"?: Database["public"]['Enums']["visibility_source"]
                  }
                  Update: {
                    "away_at"?: string,"created_at"?: string,"ended_by"?: Database["public"]['Enums']["visibility_end_reason"] | null,"id"?: never,"player_id"?: string,"returned_at"?: string | null,"room_id"?: string,"round_id"?: string,"source"?: Database["public"]['Enums']["visibility_source"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "visibility_events_participant_fk"
      columns: ["round_id","player_id"]
isOneToOne: false
      referencedRelation: "answer_sheets"
      referencedColumns: ["round_id","player_id"]
    },{
      foreignKeyName: "visibility_events_room_id_fkey"
      columns: ["room_id"]
isOneToOne: false
      referencedRelation: "rooms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visibility_events_round_id_fkey"
      columns: ["round_id"]
isOneToOne: false
      referencedRelation: "rounds"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
claim_geographic_validation: { Args: { p_room_id: string; p_round_id: string }; Returns: Json },
release_geographic_validation: { Args: { p_round_id: string; p_claim: string }; Returns: undefined },
complete_geographic_validation: { Args: { p_room_id: string; p_round_id: string; p_claim: string; p_results: Json }; Returns: boolean },
            "advance_game":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"all_answers_locked":
{ Args: { "p_round_id": string }; Returns: boolean
                           },
"all_required_ready":
{ Args: { "p_round_id": string,"p_stage": Database["public"]['Enums']["ready_stage"] }; Returns: boolean
                           },
"assert_authenticated":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"assert_valid_display_name":
{ Args: { "p_name": string }; Returns: undefined
                           },
"can_access_room_topic":
{ Args: { "p_topic": string }; Returns: boolean
                           },
"clean_answer":
{ Args: { "p_value": string }; Returns: string
                           },
"confirm_ready_stage":
{ Args: { "p_allowed_phases": (Database["public"]['Enums']["game_phase"])[],"p_room_id": string,"p_stage": Database["public"]['Enums']["ready_stage"] }; Returns: undefined
                           },
"countdown_duration":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"create_room":
{ Args: { "p_capacity": number,"p_display_name": string }; Returns: string
                           },
"display_name_key":
{ Args: { "p_name": string }; Returns: string
                           },
"elect_room_host":
{ Args: { "p_excluding"?: string,"p_room_id": string }; Returns: string
                           },
"eligible_letters":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"eligible_round_players":
{ Args: { "p_room_id": string }; Returns: string[]
                           },
"finish_game":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"generate_room_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_game_state":
{ Args: { "p_room_id": string }; Returns: Json
                           },
"get_game_summary":
{ Args: { "p_room_id": string }; Returns: Json
                           },
"get_round_activity":
{ Args: { "p_room_id": string,"p_round_id": string }; Returns: Json
                           },
"get_round_results":
{ Args: { "p_room_id": string,"p_round_id"?: string }; Returns: Json
                           },
"heartbeat":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"is_eligible_letter":
{ Args: { "letter": string }; Returns: boolean
                           },
"is_room_member":
{ Args: { "target_room_id": string }; Returns: boolean
                           },
"is_round_member":
{ Args: { "target_round_id": string }; Returns: boolean
                           },
"join_room":
{ Args: { "p_code": string,"p_display_name": string }; Returns: string
                           },
"leave_room":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"letters_are_valid":
{ Args: { "p_letters": (string)[] }; Returns: boolean
                           },
"letters_used":
{ Args: { "p_room_id": string }; Returns: number
                           },
"lobby_seat_expiry":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"lock_answers":
{ Args: { "p_room_id": string,"p_round_id": string }; Returns: undefined
                           },
"lock_room_for_member":
{ Args: { "p_room_id": string,"p_uid": string }; Returns: {
              "capacity": number,
"code": string,
"created_at": string,
"current_round_id": string | null,
"finished_at": string | null,
"host_player_id": string,
"id": string,
"phase": Database["public"]['Enums']["game_phase"],
"results_revision": number,
"updated_at": string,
"used_letters": (string)[]
            }
                          SetofOptions: {
        from: "*"
        to: "rooms"
        isOneToOne: true
        isSetofReturn: false
      } },
"maintain_room":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"member_stale_after":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"normalize_answer":
{ Args: { "p_value": string }; Returns: string
                           },
"normalize_display_name":
{ Args: { "p_name": string }; Returns: string
                           },
"normalize_room_code":
{ Args: { "p_code": string }; Returns: string
                           },
"raise_app_error":
{ Args: { "p_code": string }; Returns: undefined
                           },
"report_visibility":
{ Args: { "p_room_id": string,"p_round_id": string,"p_unloading"?: boolean,"p_visible": boolean,"p_answers"?: Json }; Returns: Json
                           },
"reveal_duration":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"round_answers_revealed":
{ Args: { "p_round_id": string }; Returns: boolean
                           },
"round_cells":
{ Args: { "p_round_id": string }; Returns: {
              "answer": string,"category": Database["public"]['Enums']["answer_category"],"duplicate_count": number,"player_id": string,"points": number,"state": string
            }[]
                           },
"round_duration":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"round_results_visible":
{ Args: { "p_round_id": string }; Returns: boolean
                           },
"save_answers":
{ Args: { "p_answers": Json,"p_room_id": string,"p_round_id": string }; Returns: undefined
                           },
"set_answer_invalidated":
{ Args: { "p_category": string,"p_invalidated": boolean,"p_player_id": string,"p_room_id": string,"p_round_id": string }; Returns: undefined
                           },
"set_results_ready":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"set_round_ready":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"standings_through":
{ Args: { "p_room_id": string,"p_round_number": number }; Returns: Json
                           },
"start_game":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"start_next_round":
{ Args: { "p_room_id": string }; Returns: undefined
                           },
"total_rounds":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"visibility_cap":
{ Args: { "p_round": Database["public"]['Tables']["rounds"]['Row'],"p_sheet": Database["public"]['Tables']["answer_sheets"]['Row'] }; Returns: string
                           }
          }
          Enums: {
answer_validation_status: 'PENDING' | 'VALID' | 'INVALID',
answer_validation_reason: 'WRONG_LETTER' | 'MISSPELLING' | 'DOES_NOT_EXIST' | 'WRONG_CATEGORY' | 'AMBIGUOUS',
            "answer_category": "country"|"city"|"village"|"animal"|"plant"|"object"|"name","game_phase": "LOBBY"|"ROUND_WAITING"|"COUNTDOWN"|"PLAYING"|"ROUND_LOCKED"|"RESULTS_READY"|"MAP_VALIDATING"|"REVEAL"|"RESULTS"|"FINISHED","invalidation_action": "invalidate"|"restore","member_left_reason": "left"|"expired","ready_stage": "pre_round"|"pre_results","round_lock_reason": "all_ready"|"timeout"|"stop","sheet_lock_reason": "ready"|"left"|"tab_exit","visibility_end_reason": "returned"|"round_ended"|"answers_locked","visibility_source": "visibility"|"blur"|"presence"|"unload"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
answer_validation_status: ['PENDING', 'VALID', 'INVALID'],
answer_validation_reason: ['WRONG_LETTER', 'MISSPELLING', 'DOES_NOT_EXIST', 'WRONG_CATEGORY', 'AMBIGUOUS'],
            "answer_category": ["country", "city", "village", "animal", "plant", "object", "name"],"game_phase": ["LOBBY", "ROUND_WAITING", "COUNTDOWN", "PLAYING", "ROUND_LOCKED", "RESULTS_READY", "MAP_VALIDATING", "REVEAL", "RESULTS", "FINISHED"],"invalidation_action": ["invalidate", "restore"],"member_left_reason": ["left", "expired"],"ready_stage": ["pre_round", "pre_results"],"round_lock_reason": ["all_ready", "timeout", "stop"],"sheet_lock_reason": ["ready", "left", "tab_exit"],"visibility_end_reason": ["returned", "round_ended", "answers_locked"],"visibility_source": ["visibility", "blur", "presence", "unload"]
          }
        }
} as const
