export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          app_version: string | null
          battery_level: number | null
          id: string
          kind: string
          last_seen_at: string | null
          name: string
          provisioned_at: string
          provisioned_by: string | null
          retired_at: string | null
          retired_by: string | null
          status: string
          store_id: string
          table_id: string | null
          token_hash: string
        }
        Insert: {
          app_version?: string | null
          battery_level?: number | null
          id?: string
          kind?: string
          last_seen_at?: string | null
          name: string
          provisioned_at?: string
          provisioned_by?: string | null
          retired_at?: string | null
          retired_by?: string | null
          status?: string
          store_id: string
          table_id?: string | null
          token_hash: string
        }
        Update: {
          app_version?: string | null
          battery_level?: number | null
          id?: string
          kind?: string
          last_seen_at?: string | null
          name?: string
          provisioned_at?: string
          provisioned_by?: string | null
          retired_at?: string | null
          retired_by?: string | null
          status?: string
          store_id?: string
          table_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_provisioned_by_fkey"
            columns: ["provisioned_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_retired_by_fkey"
            columns: ["retired_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_events: {
        Row: {
          category_id: string | null
          event_type: string
          id: number
          product_id: string | null
          received_at: string
          session_id: string
          store_id: string
          value_ms: number | null
        }
        Insert: {
          category_id?: string | null
          event_type: string
          id?: number
          product_id?: string | null
          received_at?: string
          session_id: string
          store_id: string
          value_ms?: number | null
        }
        Update: {
          category_id?: string | null
          event_type?: string
          id?: number
          product_id?: string | null
          received_at?: string
          session_id?: string
          store_id?: string
          value_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_engagement"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "menu_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "menu_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_sessions: {
        Row: {
          id: string
          rate_window_count: number
          rate_window_start: string
          started_at: string
          store_id: string
        }
        Insert: {
          id: string
          rate_window_count?: number
          rate_window_start?: string
          started_at?: string
          store_id: string
        }
        Update: {
          id?: string
          rate_window_count?: number
          rate_window_start?: string
          started_at?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      option_groups: {
        Row: {
          created_at: string
          id: string
          max_select: number
          min_select: number
          name: string
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name: string
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_groups_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      options: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_available: boolean
          name: string
          pdv_code: string | null
          price_delta: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_available?: boolean
          name: string
          pdv_code?: string | null
          price_delta?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_available?: boolean
          name?: string
          pdv_code?: string | null
          price_delta?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      order_cancel_requests: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          order_id: string
          order_item_id: string | null
          requested_at: string
          requested_by_device: string
          status: string
          store_id: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          order_id: string
          order_item_id?: string | null
          requested_at?: string
          requested_by_device: string
          status?: string
          store_id: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          order_id?: string
          order_item_id?: string | null
          requested_at?: string
          requested_by_device?: string
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_cancel_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancel_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancel_requests_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancel_requests_requested_by_device_fkey"
            columns: ["requested_by_device"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancel_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_options: {
        Row: {
          id: string
          option_id: string
          option_name: string
          order_item_id: string
          price_delta: number
        }
        Insert: {
          id?: string
          option_id: string
          option_name: string
          order_item_id: string
          price_delta?: number
        }
        Update: {
          id?: string
          option_id?: string
          option_name?: string
          order_item_id?: string
          price_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_options_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_options_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          line_total: number
          notes: string | null
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          remove_reason: string | null
          removed_at: string | null
          removed_by: string | null
          unit_price: number
        }
        Insert: {
          id?: string
          line_total: number
          notes?: string | null
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          remove_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          unit_price: number
        }
        Update: {
          id?: string
          line_total?: number
          notes?: string | null
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          remove_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_engagement"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_number_counters: {
        Row: {
          business_date: string
          last_number: number
          store_id: string
        }
        Insert: {
          business_date: string
          last_number?: number
          store_id: string
        }
        Update: {
          business_date?: string
          last_number?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_number_counters_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_device_id: string | null
          actor_user_id: string | null
          at: string
          from_status: string | null
          id: number
          order_id: string
          to_status: string
        }
        Insert: {
          actor_device_id?: string | null
          actor_user_id?: string | null
          at?: string
          from_status?: string | null
          id?: number
          order_id: string
          to_status: string
        }
        Update: {
          actor_device_id?: string | null
          actor_user_id?: string | null
          at?: string
          from_status?: string | null
          id?: number
          order_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_actor_device_id_fkey"
            columns: ["actor_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          business_date: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          device_id: string
          display_number: number
          id: string
          idempotency_key: string
          status: string
          store_id: string
          subtotal: number
          tab_id: string
          table_session_id: string
        }
        Insert: {
          business_date: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          device_id: string
          display_number: number
          id?: string
          idempotency_key: string
          status?: string
          store_id: string
          subtotal: number
          tab_id: string
          table_session_id: string
        }
        Update: {
          business_date?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          device_id?: string
          display_number?: number
          id?: string
          idempotency_key?: string
          status?: string
          store_id?: string
          subtotal?: number
          tab_id?: string
          table_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "table_tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_option_groups: {
        Row: {
          group_id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          group_id: string
          product_id: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_option_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_option_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_engagement"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_option_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available_window: Json | null
          category_id: string
          created_at: string
          description: string | null
          emoji: string | null
          id: string
          is_active: boolean
          is_available: boolean
          is_featured: boolean
          name: string
          pdv_code: string | null
          photo_path: string | null
          price: number
          sort_order: number
          store_id: string
          unavailable_by: string | null
          unavailable_since: string | null
        }
        Insert: {
          available_window?: Json | null
          category_id: string
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_featured?: boolean
          name: string
          pdv_code?: string | null
          photo_path?: string | null
          price: number
          sort_order?: number
          store_id: string
          unavailable_by?: string | null
          unavailable_since?: string | null
        }
        Update: {
          available_window?: Json | null
          category_id?: string
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          is_featured?: boolean
          name?: string
          pdv_code?: string | null
          photo_path?: string | null
          price?: number
          sort_order?: number
          store_id?: string
          unavailable_by?: string | null
          unavailable_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_unavailable_by_fkey"
            columns: ["unavailable_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
        ]
      }
      store_users: {
        Row: {
          created_at: string
          deactivated_at: string | null
          id: string
          is_active: boolean
          role: string
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          id?: string
          is_active?: boolean
          role: string
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          id?: string
          is_active?: boolean
          role?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_users_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          accent_color: string
          business_day_start: string
          created_at: string
          id: string
          idle_table_alert_minutes: number
          is_active: boolean
          logo_url: string | null
          name: string
          opening_hours: Json | null
          organization_id: string
          primary_color: string
          slug: string
          tab_mode: string
          timezone: string
        }
        Insert: {
          accent_color?: string
          business_day_start?: string
          created_at?: string
          id?: string
          idle_table_alert_minutes?: number
          is_active?: boolean
          logo_url?: string | null
          name: string
          opening_hours?: Json | null
          organization_id: string
          primary_color?: string
          slug: string
          tab_mode?: string
          timezone?: string
        }
        Update: {
          accent_color?: string
          business_day_start?: string
          created_at?: string
          id?: string
          idle_table_alert_minutes?: number
          is_active?: boolean
          logo_url?: string | null
          name?: string
          opening_hours?: Json | null
          organization_id?: string
          primary_color?: string
          slug?: string
          tab_mode?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tab_moves: {
        Row: {
          from_session_id: string
          id: string
          moved_at: string
          moved_by: string
          store_id: string
          tab_id: string
          to_session_id: string
        }
        Insert: {
          from_session_id: string
          id?: string
          moved_at?: string
          moved_by: string
          store_id: string
          tab_id: string
          to_session_id: string
        }
        Update: {
          from_session_id?: string
          id?: string
          moved_at?: string
          moved_by?: string
          store_id?: string
          tab_id?: string
          to_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tab_moves_from_session_id_fkey"
            columns: ["from_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_moves_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_moves_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_moves_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "table_tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_moves_to_session_id_fkey"
            columns: ["to_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          close_kind: string | null
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          id: string
          opened_at: string
          opened_by_device: string | null
          opened_by_user: string | null
          status: string
          store_id: string
          tab_mode: string
          table_id: string
        }
        Insert: {
          close_kind?: string | null
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at?: string
          opened_by_device?: string | null
          opened_by_user?: string | null
          status?: string
          store_id: string
          tab_mode: string
          table_id: string
        }
        Update: {
          close_kind?: string | null
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at?: string
          opened_by_device?: string | null
          opened_by_user?: string | null
          status?: string
          store_id?: string
          tab_mode?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_opened_by_device_fkey"
            columns: ["opened_by_device"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_opened_by_user_fkey"
            columns: ["opened_by_user"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_tabs: {
        Row: {
          close_kind: string | null
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          id: string
          name: string
          opened_at: string
          opened_by_device: string | null
          opened_by_user: string | null
          origin: string
          status: string
          store_id: string
          table_session_id: string
        }
        Insert: {
          close_kind?: string | null
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          name: string
          opened_at?: string
          opened_by_device?: string | null
          opened_by_user?: string | null
          origin?: string
          status?: string
          store_id: string
          table_session_id: string
        }
        Update: {
          close_kind?: string | null
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          name?: string
          opened_at?: string
          opened_by_device?: string | null
          opened_by_user?: string | null
          origin?: string
          status?: string
          store_id?: string
          table_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_tabs_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_tabs_opened_by_device_fkey"
            columns: ["opened_by_device"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_tabs_opened_by_user_fkey"
            columns: ["opened_by_user"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_tabs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_tabs_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          number: number
          ordering_changed_at: string | null
          ordering_changed_by: string | null
          ordering_disabled_reason: string | null
          ordering_enabled: boolean
          qr_token: string
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          number: number
          ordering_changed_at?: string | null
          ordering_changed_by?: string | null
          ordering_disabled_reason?: string | null
          ordering_enabled?: boolean
          qr_token?: string
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          number?: number
          ordering_changed_at?: string | null
          ordering_changed_by?: string | null
          ordering_disabled_reason?: string | null
          ordering_enabled?: boolean
          qr_token?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_ordering_changed_by_fkey"
            columns: ["ordering_changed_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_calls: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          closed_at: string | null
          created_at: string
          device_id: string | null
          id: string
          reinforced_at: string | null
          store_id: string
          table_id: string
          table_session_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          closed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          reinforced_at?: string | null
          store_id: string
          table_id: string
          table_session_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          closed_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          reinforced_at?: string | null
          store_id?: string
          table_id?: string
          table_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_table_session_id_fkey"
            columns: ["table_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      product_engagement: {
        Row: {
          adds_to_cart: number | null
          clicks: number | null
          impressions: number | null
          name: string | null
          order_submits: number | null
          product_id: string | null
          store_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_add_store_user: {
        Args: { p_role: string; p_store_id: string; p_user_id: string }
        Returns: string
      }
      admin_deactivate_store_user: {
        Args: { p_store_user_id: string }
        Returns: undefined
      }
      admin_list_store_users: {
        Args: { p_store_id: string }
        Returns: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          role: string
          user_id: string
        }[]
      }
      admin_set_device_status: {
        Args: { p_device_id: string; p_status: string }
        Returns: undefined
      }
      admin_set_product_groups: {
        Args: { p_group_ids: string[]; p_product_id: string }
        Returns: undefined
      }
      admin_set_product_photo: {
        Args: { p_photo_path: string; p_product_id: string }
        Returns: undefined
      }
      admin_set_store_user_role: {
        Args: { p_role: string; p_store_user_id: string }
        Returns: undefined
      }
      admin_set_tab_mode: {
        Args: { p_mode: string; p_store_id: string }
        Returns: undefined
      }
      admin_update_store_appearance: {
        Args: {
          p_accent: string
          p_logo_url: string
          p_primary: string
          p_store_id: string
        }
        Returns: undefined
      }
      admin_update_store_hours: {
        Args: {
          p_business_day_start: string
          p_opening_hours: Json
          p_store_id: string
          p_timezone: string
        }
        Returns: undefined
      }
      admin_upsert_category: {
        Args: {
          p_id: string
          p_is_active: boolean
          p_name: string
          p_sort_order: number
          p_store_id: string
        }
        Returns: string
      }
      admin_upsert_option: {
        Args: {
          p_group_id: string
          p_id: string
          p_is_available: boolean
          p_name: string
          p_pdv_code: string
          p_price_delta: number
          p_sort_order: number
        }
        Returns: string
      }
      admin_upsert_option_group: {
        Args: {
          p_id: string
          p_max_select: number
          p_min_select: number
          p_name: string
          p_store_id: string
        }
        Returns: string
      }
      admin_upsert_product: {
        Args: {
          p_available_window: Json
          p_category_id: string
          p_description: string
          p_emoji: string
          p_id: string
          p_is_active: boolean
          p_is_featured: boolean
          p_name: string
          p_pdv_code: string
          p_price: number
          p_sort_order: number
          p_store_id: string
        }
        Returns: string
      }
      admin_upsert_table: {
        Args: {
          p_id: string
          p_is_active: boolean
          p_label: string
          p_number: number
          p_store_id: string
        }
        Returns: string
      }
      device_heartbeat: {
        Args: { p_app_version: string; p_battery: number; p_token_hash: string }
        Returns: undefined
      }
      jm_cancel_order: {
        Args: { p_autor: string; p_order_id: string; p_reason: string }
        Returns: undefined
      }
      jm_channel: { Args: { p: number }; Returns: number }
      jm_close_session_if_empty: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      jm_contrast: { Args: { p_a: string; p_b: string }; Returns: number }
      jm_device_by_hash: {
        Args: { p_token_hash: string }
        Returns: {
          app_version: string | null
          battery_level: number | null
          id: string
          kind: string
          last_seen_at: string | null
          name: string
          provisioned_at: string
          provisioned_by: string | null
          retired_at: string | null
          retired_by: string | null
          status: string
          store_id: string
          table_id: string | null
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      jm_item_price: {
        Args: {
          p_option_ids: string[]
          p_product_id: string
          p_quantity: number
          p_store_id: string
        }
        Returns: {
          line_total: number
          option_ids: string[]
          product_name: string
          unit_price: number
          unit_total: number
        }[]
      }
      jm_luminance: { Args: { p_hex: string }; Returns: number }
      jm_reason: { Args: { p_reason: string }; Returns: string }
      jm_remove_item: {
        Args: { p_autor: string; p_item_id: string; p_reason: string }
        Returns: undefined
      }
      jm_require_role: {
        Args: { p_roles: string[]; p_store_id: string }
        Returns: string
      }
      jm_role: { Args: { p_store_id: string }; Returns: string }
      jm_session_for_device: {
        Args: {
          p_create: boolean
          p_device: Database["public"]["Tables"]["devices"]["Row"]
        }
        Returns: string
      }
      jm_session_payload: { Args: { p_session_id: string }; Returns: Json }
      jm_windows_open: {
        Args: { p_now: string; p_tz: string; p_windows: Json }
        Returns: boolean
      }
      jm_windows_valid: { Args: { p_windows: Json }; Returns: boolean }
      shift_date: { Args: { p_store_id: string; ts: string }; Returns: string }
      staff_ack_waiter_call: { Args: { p_call_id: string }; Returns: undefined }
      staff_cancel_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      staff_close_tab: { Args: { p_tab_id: string }; Returns: Json }
      staff_decide_cancel_request: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: undefined
      }
      staff_floor: { Args: { p_store_id: string }; Returns: Json }
      staff_force_close_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
      staff_move_tab: {
        Args: { p_tab_id: string; p_to_table_id: string }
        Returns: Json
      }
      staff_pair_device: {
        Args: {
          p_name: string
          p_store_id: string
          p_table_id: string
          p_token_hash: string
        }
        Returns: {
          device_id: string
          table_number: number
        }[]
      }
      staff_remove_item: {
        Args: { p_item_id: string; p_reason: string }
        Returns: undefined
      }
      staff_rename_tab: {
        Args: { p_name: string; p_tab_id: string }
        Returns: undefined
      }
      staff_set_product_availability: {
        Args: { p_available: boolean; p_product_id: string }
        Returns: undefined
      }
      staff_set_table_ordering: {
        Args: { p_enabled: boolean; p_reason?: string; p_table_id: string }
        Returns: undefined
      }
      store_hours_state: {
        Args: { p_now?: string; p_store_id: string }
        Returns: {
          closes_at_local: string
          is_open: boolean
          opens_at_local: string
          opens_day_offset: number
        }[]
      }
      tablet_call_waiter: { Args: { p_token_hash: string }; Returns: Json }
      tablet_create_tab: {
        Args: { p_name: string; p_token_hash: string }
        Returns: Json
      }
      tablet_item_total: {
        Args: {
          p_option_ids: string[]
          p_product_id: string
          p_quantity: number
          p_token_hash: string
        }
        Returns: {
          line_total: number
          unit_total: number
        }[]
      }
      tablet_menu: { Args: { p_token_hash: string }; Returns: Json }
      tablet_open_session: { Args: { p_token_hash: string }; Returns: Json }
      tablet_place_order: {
        Args: {
          p_idempotency_key: string
          p_items: Json
          p_session_id: string
          p_tab_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      tablet_reinforce_call: {
        Args: { p_call_id: string; p_token_hash: string }
        Returns: Json
      }
      tablet_request_cancel: {
        Args: { p_item_id?: string; p_order_id: string; p_token_hash: string }
        Returns: Json
      }
      tablet_resolve_device: {
        Args: { p_token_hash: string }
        Returns: {
          device_name: string
          store_name: string
          store_slug: string
          table_number: number
        }[]
      }
      tablet_session_summary: { Args: { p_token_hash: string }; Returns: Json }
      tablet_store_hours: {
        Args: { p_token_hash: string }
        Returns: {
          closes_at_local: string
          is_open: boolean
          opens_at_local: string
          opens_day_offset: number
        }[]
      }
      track_events: {
        Args: { p_events: Json; p_session_id: string; p_store_id: string }
        Returns: {
          aceitos: number
          descartados: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

