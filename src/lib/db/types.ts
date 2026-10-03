export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      alerts: {
        Row: {
          cost_eur: number | null;
          created_at: string;
          dedup_key: string;
          dossier: Json | null;
          dossier_markdown: string | null;
          dossier_status: Database["public"]["Enums"]["dossier_status"] | null;
          feedback_ids: string[];
          id: string;
          insight_id: string | null;
          kind: Database["public"]["Enums"]["alert_kind"];
          langfuse_url: string | null;
          status: Database["public"]["Enums"]["alert_status"];
        };
        Insert: {
          cost_eur?: number | null;
          created_at?: string;
          dedup_key: string;
          dossier?: Json | null;
          dossier_markdown?: string | null;
          dossier_status?: Database["public"]["Enums"]["dossier_status"] | null;
          feedback_ids?: string[];
          id?: string;
          insight_id?: string | null;
          kind: Database["public"]["Enums"]["alert_kind"];
          langfuse_url?: string | null;
          status?: Database["public"]["Enums"]["alert_status"];
        };
        Update: {
          cost_eur?: number | null;
          created_at?: string;
          dedup_key?: string;
          dossier?: Json | null;
          dossier_markdown?: string | null;
          dossier_status?: Database["public"]["Enums"]["dossier_status"] | null;
          feedback_ids?: string[];
          id?: string;
          insight_id?: string | null;
          kind?: Database["public"]["Enums"]["alert_kind"];
          langfuse_url?: string | null;
          status?: Database["public"]["Enums"]["alert_status"];
        };
        Relationships: [
          {
            foreignKeyName: "alerts_insight_id_fkey";
            columns: ["insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
        ];
      };
      backlog_items: {
        Row: {
          acceptance_criteria: Json;
          actual_behavior: string | null;
          affected_accounts: string[];
          business_rules: Json;
          complexity_estimate_id: string | null;
          created_at: string;
          definition_of_done: Json | null;
          dor_checklist: Json;
          edited_in_notion: boolean;
          epic_id: string | null;
          evidence: string[];
          expected_behavior: string | null;
          id: string;
          insight_id: string | null;
          judge: Json | null;
          kind: Database["public"]["Enums"]["backlog_kind"];
          notion_page_id: string | null;
          notion_status_raw: string | null;
          objective: string | null;
          persona: string | null;
          points: number | null;
          prototype_id: string | null;
          push_error: string | null;
          repro_steps: Json | null;
          severity: Database["public"]["Enums"]["bug_severity"] | null;
          status: Database["public"]["Enums"]["backlog_status"];
          success_kpi: string | null;
          title: string;
          updated_at: string;
          value: string | null;
          want: string | null;
        };
        Insert: {
          acceptance_criteria?: Json;
          actual_behavior?: string | null;
          affected_accounts?: string[];
          business_rules?: Json;
          complexity_estimate_id?: string | null;
          created_at?: string;
          definition_of_done?: Json | null;
          dor_checklist?: Json;
          edited_in_notion?: boolean;
          epic_id?: string | null;
          evidence?: string[];
          expected_behavior?: string | null;
          id: string;
          insight_id?: string | null;
          judge?: Json | null;
          kind: Database["public"]["Enums"]["backlog_kind"];
          notion_page_id?: string | null;
          notion_status_raw?: string | null;
          objective?: string | null;
          persona?: string | null;
          points?: number | null;
          prototype_id?: string | null;
          push_error?: string | null;
          repro_steps?: Json | null;
          severity?: Database["public"]["Enums"]["bug_severity"] | null;
          status?: Database["public"]["Enums"]["backlog_status"];
          success_kpi?: string | null;
          title: string;
          updated_at?: string;
          value?: string | null;
          want?: string | null;
        };
        Update: {
          acceptance_criteria?: Json;
          actual_behavior?: string | null;
          affected_accounts?: string[];
          business_rules?: Json;
          complexity_estimate_id?: string | null;
          created_at?: string;
          definition_of_done?: Json | null;
          dor_checklist?: Json;
          edited_in_notion?: boolean;
          epic_id?: string | null;
          evidence?: string[];
          expected_behavior?: string | null;
          id?: string;
          insight_id?: string | null;
          judge?: Json | null;
          kind?: Database["public"]["Enums"]["backlog_kind"];
          notion_page_id?: string | null;
          notion_status_raw?: string | null;
          objective?: string | null;
          persona?: string | null;
          points?: number | null;
          prototype_id?: string | null;
          push_error?: string | null;
          repro_steps?: Json | null;
          severity?: Database["public"]["Enums"]["bug_severity"] | null;
          status?: Database["public"]["Enums"]["backlog_status"];
          success_kpi?: string | null;
          title?: string;
          updated_at?: string;
          value?: string | null;
          want?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "backlog_items_complexity_estimate_id_fkey";
            columns: ["complexity_estimate_id"];
            isOneToOne: false;
            referencedRelation: "complexity_estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "backlog_items_epic_id_fkey";
            columns: ["epic_id"];
            isOneToOne: false;
            referencedRelation: "epics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "backlog_items_insight_id_fkey";
            columns: ["insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "backlog_items_prototype_id_fkey";
            columns: ["prototype_id"];
            isOneToOne: false;
            referencedRelation: "prototypes";
            referencedColumns: ["id"];
          },
        ];
      };
      complexity_estimates: {
        Row: {
          analogies: Json;
          components: string[];
          confidence: Database["public"]["Enums"]["confidence_level"] | null;
          created_at: string;
          id: string;
          insight_id: string | null;
          item_id: string | null;
          model: string | null;
          points_max: number | null;
          points_min: number | null;
          problem_hash: string;
          rationale: string | null;
          risks: Json;
          tshirt_max: Database["public"]["Enums"]["tshirt_size"] | null;
          tshirt_min: Database["public"]["Enums"]["tshirt_size"] | null;
        };
        Insert: {
          analogies?: Json;
          components?: string[];
          confidence?: Database["public"]["Enums"]["confidence_level"] | null;
          created_at?: string;
          id?: string;
          insight_id?: string | null;
          item_id?: string | null;
          model?: string | null;
          points_max?: number | null;
          points_min?: number | null;
          problem_hash: string;
          rationale?: string | null;
          risks?: Json;
          tshirt_max?: Database["public"]["Enums"]["tshirt_size"] | null;
          tshirt_min?: Database["public"]["Enums"]["tshirt_size"] | null;
        };
        Update: {
          analogies?: Json;
          components?: string[];
          confidence?: Database["public"]["Enums"]["confidence_level"] | null;
          created_at?: string;
          id?: string;
          insight_id?: string | null;
          item_id?: string | null;
          model?: string | null;
          points_max?: number | null;
          points_min?: number | null;
          problem_hash?: string;
          rationale?: string | null;
          risks?: Json;
          tshirt_max?: Database["public"]["Enums"]["tshirt_size"] | null;
          tshirt_min?: Database["public"]["Enums"]["tshirt_size"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "complexity_estimates_insight_id_fkey";
            columns: ["insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "complexity_estimates_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "backlog_items";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          created_at: string;
          csm: string | null;
          email_domain: string | null;
          health: Database["public"]["Enums"]["customer_health"] | null;
          id: string;
          mrr_eur: number;
          name: string;
          plan: Database["public"]["Enums"]["customer_plan"] | null;
          renewal_date: string | null;
          seats: number | null;
          segment: Database["public"]["Enums"]["customer_segment"];
          status: Database["public"]["Enums"]["customer_status"];
        };
        Insert: {
          created_at?: string;
          csm?: string | null;
          email_domain?: string | null;
          health?: Database["public"]["Enums"]["customer_health"] | null;
          id?: string;
          mrr_eur?: number;
          name: string;
          plan?: Database["public"]["Enums"]["customer_plan"] | null;
          renewal_date?: string | null;
          seats?: number | null;
          segment: Database["public"]["Enums"]["customer_segment"];
          status?: Database["public"]["Enums"]["customer_status"];
        };
        Update: {
          created_at?: string;
          csm?: string | null;
          email_domain?: string | null;
          health?: Database["public"]["Enums"]["customer_health"] | null;
          id?: string;
          mrr_eur?: number;
          name?: string;
          plan?: Database["public"]["Enums"]["customer_plan"] | null;
          renewal_date?: string | null;
          seats?: number | null;
          segment?: Database["public"]["Enums"]["customer_segment"];
          status?: Database["public"]["Enums"]["customer_status"];
        };
        Relationships: [];
      };
      decisions: {
        Row: {
          action: Database["public"]["Enums"]["decision_action"];
          actor: Database["public"]["Enums"]["decision_actor"];
          after: Json | null;
          before: Json | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          field: string | null;
          id: string;
          reason: string | null;
          source: Database["public"]["Enums"]["decision_source"];
        };
        Insert: {
          action: Database["public"]["Enums"]["decision_action"];
          actor: Database["public"]["Enums"]["decision_actor"];
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          field?: string | null;
          id?: string;
          reason?: string | null;
          source: Database["public"]["Enums"]["decision_source"];
        };
        Update: {
          action?: Database["public"]["Enums"]["decision_action"];
          actor?: Database["public"]["Enums"]["decision_actor"];
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          field?: string | null;
          id?: string;
          reason?: string | null;
          source?: Database["public"]["Enums"]["decision_source"];
        };
        Relationships: [];
      };
      digests: {
        Row: {
          content: Json;
          created_at: string;
          id: string;
          markdown: string | null;
          period_end: string;
          period_start: string;
          run_id: string | null;
        };
        Insert: {
          content?: Json;
          created_at?: string;
          id?: string;
          markdown?: string | null;
          period_end: string;
          period_start: string;
          run_id?: string | null;
        };
        Update: {
          content?: Json;
          created_at?: string;
          id?: string;
          markdown?: string | null;
          period_end?: string;
          period_start?: string;
          run_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "digests_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      epics: {
        Row: {
          created_at: string;
          goal: string | null;
          id: string;
          insight_id: string;
          kpis: Json;
          okr_refs: string[];
          title: string;
        };
        Insert: {
          created_at?: string;
          goal?: string | null;
          id?: string;
          insight_id: string;
          kpis?: Json;
          okr_refs?: string[];
          title: string;
        };
        Update: {
          created_at?: string;
          goal?: string | null;
          id?: string;
          insight_id?: string;
          kpis?: Json;
          okr_refs?: string[];
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "epics_insight_id_fkey";
            columns: ["insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
        ];
      };
      eval_results: {
        Row: {
          actual: Json | null;
          eval_run_id: string;
          expected: Json | null;
          id: string;
          item_id: string;
          pass: boolean | null;
          score: number | null;
        };
        Insert: {
          actual?: Json | null;
          eval_run_id: string;
          expected?: Json | null;
          id?: string;
          item_id: string;
          pass?: boolean | null;
          score?: number | null;
        };
        Update: {
          actual?: Json | null;
          eval_run_id?: string;
          expected?: Json | null;
          id?: string;
          item_id?: string;
          pass?: boolean | null;
          score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "eval_results_eval_run_id_fkey";
            columns: ["eval_run_id"];
            isOneToOne: false;
            referencedRelation: "eval_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      eval_runs: {
        Row: {
          config: Json;
          cost_eur: number | null;
          ended_at: string | null;
          eval_name: string;
          git_sha: string | null;
          id: string;
          langfuse_url: string | null;
          metrics: Json;
          sample_size: number | null;
          started_at: string;
        };
        Insert: {
          config?: Json;
          cost_eur?: number | null;
          ended_at?: string | null;
          eval_name: string;
          git_sha?: string | null;
          id?: string;
          langfuse_url?: string | null;
          metrics?: Json;
          sample_size?: number | null;
          started_at?: string;
        };
        Update: {
          config?: Json;
          cost_eur?: number | null;
          ended_at?: string | null;
          eval_name?: string;
          git_sha?: string | null;
          id?: string;
          langfuse_url?: string | null;
          metrics?: Json;
          sample_size?: number | null;
          started_at?: string;
        };
        Relationships: [];
      };
      feedback_analyses: {
        Row: {
          churn_signal: boolean | null;
          confidence: number | null;
          created_at: string;
          error: string | null;
          feedback_id: string;
          injection_suspected: boolean | null;
          model: string;
          run_id: string;
          sentiment: number | null;
          status: Database["public"]["Enums"]["analysis_status"];
          urgency: Database["public"]["Enums"]["urgency"] | null;
        };
        Insert: {
          churn_signal?: boolean | null;
          confidence?: number | null;
          created_at?: string;
          error?: string | null;
          feedback_id: string;
          injection_suspected?: boolean | null;
          model: string;
          run_id: string;
          sentiment?: number | null;
          status: Database["public"]["Enums"]["analysis_status"];
          urgency?: Database["public"]["Enums"]["urgency"] | null;
        };
        Update: {
          churn_signal?: boolean | null;
          confidence?: number | null;
          created_at?: string;
          error?: string | null;
          feedback_id?: string;
          injection_suspected?: boolean | null;
          model?: string;
          run_id?: string;
          sentiment?: number | null;
          status?: Database["public"]["Enums"]["analysis_status"];
          urgency?: Database["public"]["Enums"]["urgency"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_analyses_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedback_inbox";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_analyses_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedbacks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_analyses_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback_items: {
        Row: {
          created_at: string;
          embedding: string | null;
          existing_feature: boolean;
          expressed_request: string | null;
          feedback_id: string;
          id: string;
          item_index: number;
          product_area: Database["public"]["Enums"]["product_area"];
          summary: string;
          tags: string[];
          type: Database["public"]["Enums"]["item_type"];
          underlying_problem: string;
          watch: boolean;
        };
        Insert: {
          created_at?: string;
          embedding?: string | null;
          existing_feature?: boolean;
          expressed_request?: string | null;
          feedback_id: string;
          id?: string;
          item_index: number;
          product_area: Database["public"]["Enums"]["product_area"];
          summary: string;
          tags?: string[];
          type: Database["public"]["Enums"]["item_type"];
          underlying_problem: string;
          watch?: boolean;
        };
        Update: {
          created_at?: string;
          embedding?: string | null;
          existing_feature?: boolean;
          expressed_request?: string | null;
          feedback_id?: string;
          id?: string;
          item_index?: number;
          product_area?: Database["public"]["Enums"]["product_area"];
          summary?: string;
          tags?: string[];
          type?: Database["public"]["Enums"]["item_type"];
          underlying_problem?: string;
          watch?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_items_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedback_inbox";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_items_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedbacks";
            referencedColumns: ["id"];
          },
        ];
      };
      feedbacks: {
        Row: {
          author_email: string | null;
          author_name: string | null;
          channel: Database["public"]["Enums"]["feedback_channel"];
          created_at: string;
          customer_id: string | null;
          id: string;
          ingested_run_id: string | null;
          language: string | null;
          nps_score: number | null;
          raw_text: string;
          received_at: string;
          source_type: Database["public"]["Enums"]["feedback_source_type"];
          subject: string | null;
          truncated: boolean;
        };
        Insert: {
          author_email?: string | null;
          author_name?: string | null;
          channel: Database["public"]["Enums"]["feedback_channel"];
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          ingested_run_id?: string | null;
          language?: string | null;
          nps_score?: number | null;
          raw_text: string;
          received_at: string;
          source_type: Database["public"]["Enums"]["feedback_source_type"];
          subject?: string | null;
          truncated?: boolean;
        };
        Update: {
          author_email?: string | null;
          author_name?: string | null;
          channel?: Database["public"]["Enums"]["feedback_channel"];
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          ingested_run_id?: string | null;
          language?: string | null;
          nps_score?: number | null;
          raw_text?: string;
          received_at?: string;
          source_type?: Database["public"]["Enums"]["feedback_source_type"];
          subject?: string | null;
          truncated?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "feedbacks_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedbacks_ingested_run_id_fkey";
            columns: ["ingested_run_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      insight_items: {
        Row: {
          feedback_id: string;
          insight_id: string;
          is_representative: boolean;
          item_id: string;
          similarity: number | null;
        };
        Insert: {
          feedback_id: string;
          insight_id: string;
          is_representative?: boolean;
          item_id: string;
          similarity?: number | null;
        };
        Update: {
          feedback_id?: string;
          insight_id?: string;
          is_representative?: boolean;
          item_id?: string;
          similarity?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "insight_items_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedback_inbox";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insight_items_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedbacks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insight_items_insight_id_fkey";
            columns: ["insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insight_items_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "feedback_items";
            referencedColumns: ["id"];
          },
        ];
      };
      insight_relations: {
        Row: {
          id: string;
          insight_a: string;
          insight_b: string;
          kind: Database["public"]["Enums"]["insight_relation_kind"];
          rationale: string | null;
          run_id: string | null;
          segments: Json;
        };
        Insert: {
          id?: string;
          insight_a: string;
          insight_b: string;
          kind?: Database["public"]["Enums"]["insight_relation_kind"];
          rationale?: string | null;
          run_id?: string | null;
          segments?: Json;
        };
        Update: {
          id?: string;
          insight_a?: string;
          insight_b?: string;
          kind?: Database["public"]["Enums"]["insight_relation_kind"];
          rationale?: string | null;
          run_id?: string | null;
          segments?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "insight_relations_insight_a_fkey";
            columns: ["insight_a"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insight_relations_insight_b_fkey";
            columns: ["insight_b"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insight_relations_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      insights: {
        Row: {
          accounts_count: number;
          channels: Json;
          created_at: string;
          expressed_requests: Json;
          first_run_id: string | null;
          id: string;
          last_run_id: string | null;
          merged_into: string | null;
          mrr_exposed: number;
          origin: Database["public"]["Enums"]["insight_origin"];
          problem_statement: string;
          product_area: Database["public"]["Enums"]["product_area"] | null;
          ranked: boolean;
          renewals_90d: number;
          segments_breakdown: Json;
          status: Database["public"]["Enums"]["insight_status"];
          title: string;
          title_locked: boolean;
          trend: Json;
          updated_at: string;
        };
        Insert: {
          accounts_count?: number;
          channels?: Json;
          created_at?: string;
          expressed_requests?: Json;
          first_run_id?: string | null;
          id?: string;
          last_run_id?: string | null;
          merged_into?: string | null;
          mrr_exposed?: number;
          origin?: Database["public"]["Enums"]["insight_origin"];
          problem_statement: string;
          product_area?: Database["public"]["Enums"]["product_area"] | null;
          ranked?: boolean;
          renewals_90d?: number;
          segments_breakdown?: Json;
          status?: Database["public"]["Enums"]["insight_status"];
          title: string;
          title_locked?: boolean;
          trend?: Json;
          updated_at?: string;
        };
        Update: {
          accounts_count?: number;
          channels?: Json;
          created_at?: string;
          expressed_requests?: Json;
          first_run_id?: string | null;
          id?: string;
          last_run_id?: string | null;
          merged_into?: string | null;
          mrr_exposed?: number;
          origin?: Database["public"]["Enums"]["insight_origin"];
          problem_statement?: string;
          product_area?: Database["public"]["Enums"]["product_area"] | null;
          ranked?: boolean;
          renewals_90d?: number;
          segments_breakdown?: Json;
          status?: Database["public"]["Enums"]["insight_status"];
          title?: string;
          title_locked?: boolean;
          trend?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "insights_first_run_id_fkey";
            columns: ["first_run_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insights_last_run_id_fkey";
            columns: ["last_run_id"];
            isOneToOne: false;
            referencedRelation: "pipeline_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "insights_merged_into_fkey";
            columns: ["merged_into"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
        ];
      };
      notion_links: {
        Row: {
          data_source: Database["public"]["Enums"]["notion_data_source"];
          entity_id: string;
          entity_type: string;
          last_notion_edited_time: string | null;
          last_pushed_at: string | null;
          notion_page_id: string;
        };
        Insert: {
          data_source: Database["public"]["Enums"]["notion_data_source"];
          entity_id: string;
          entity_type: string;
          last_notion_edited_time?: string | null;
          last_pushed_at?: string | null;
          notion_page_id: string;
        };
        Update: {
          data_source?: Database["public"]["Enums"]["notion_data_source"];
          entity_id?: string;
          entity_type?: string;
          last_notion_edited_time?: string | null;
          last_pushed_at?: string | null;
          notion_page_id?: string;
        };
        Relationships: [];
      };
      notion_sync_state: {
        Row: {
          cursor: string | null;
          data_source: Database["public"]["Enums"]["notion_data_source"];
          updated_at: string;
        };
        Insert: {
          cursor?: string | null;
          data_source: Database["public"]["Enums"]["notion_data_source"];
          updated_at?: string;
        };
        Update: {
          cursor?: string | null;
          data_source?: Database["public"]["Enums"]["notion_data_source"];
          updated_at?: string;
        };
        Relationships: [];
      };
      overrides: {
        Row: {
          active: boolean;
          context_changed: boolean;
          created_at: string;
          feedback_ids: string[] | null;
          id: string;
          insight_id: string;
          param: Database["public"]["Enums"]["override_param"];
          reason: string | null;
          value: Json;
        };
        Insert: {
          active?: boolean;
          context_changed?: boolean;
          created_at?: string;
          feedback_ids?: string[] | null;
          id?: string;
          insight_id: string;
          param: Database["public"]["Enums"]["override_param"];
          reason?: string | null;
          value: Json;
        };
        Update: {
          active?: boolean;
          context_changed?: boolean;
          created_at?: string;
          feedback_ids?: string[] | null;
          id?: string;
          insight_id?: string;
          param?: Database["public"]["Enums"]["override_param"];
          reason?: string | null;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "overrides_insight_id_fkey";
            columns: ["insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
        ];
      };
      pipeline_runs: {
        Row: {
          cost_eur: number;
          ended_at: string | null;
          id: string;
          kind: Database["public"]["Enums"]["run_kind"];
          langfuse_url: string | null;
          started_at: string;
          stats: Json;
          status: Database["public"]["Enums"]["run_status"];
          tokens_in: number;
          tokens_out: number;
        };
        Insert: {
          cost_eur?: number;
          ended_at?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["run_kind"];
          langfuse_url?: string | null;
          started_at?: string;
          stats?: Json;
          status?: Database["public"]["Enums"]["run_status"];
          tokens_in?: number;
          tokens_out?: number;
        };
        Update: {
          cost_eur?: number;
          ended_at?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["run_kind"];
          langfuse_url?: string | null;
          started_at?: string;
          stats?: Json;
          status?: Database["public"]["Enums"]["run_status"];
          tokens_in?: number;
          tokens_out?: number;
        };
        Relationships: [];
      };
      po_state: {
        Row: {
          id: boolean;
          last_digest_id: string | null;
          last_seen_at: string | null;
        };
        Insert: {
          id?: boolean;
          last_digest_id?: string | null;
          last_seen_at?: string | null;
        };
        Update: {
          id?: boolean;
          last_digest_id?: string | null;
          last_seen_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "po_state_last_digest_id_fkey";
            columns: ["last_digest_id"];
            isOneToOne: false;
            referencedRelation: "digests";
            referencedColumns: ["id"];
          },
        ];
      };
      prototypes: {
        Row: {
          created_at: string;
          generation_ms: number | null;
          id: string;
          item_id: string;
          model: string | null;
          size_bytes: number | null;
          storage_path: string;
        };
        Insert: {
          created_at?: string;
          generation_ms?: number | null;
          id?: string;
          item_id: string;
          model?: string | null;
          size_bytes?: number | null;
          storage_path: string;
        };
        Update: {
          created_at?: string;
          generation_ms?: number | null;
          id?: string;
          item_id?: string;
          model?: string | null;
          size_bytes?: number | null;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prototypes_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "backlog_items";
            referencedColumns: ["id"];
          },
        ];
      };
      reference_tickets: {
        Row: {
          actual_days: number | null;
          actual_points: number;
          components: string[];
          description: string;
          embedding: string | null;
          estimated_points: number;
          id: string;
          module: string;
          shipped_at: string | null;
          surprises: string | null;
          title: string;
        };
        Insert: {
          actual_days?: number | null;
          actual_points: number;
          components?: string[];
          description: string;
          embedding?: string | null;
          estimated_points: number;
          id?: string;
          module: string;
          shipped_at?: string | null;
          surprises?: string | null;
          title: string;
        };
        Update: {
          actual_days?: number | null;
          actual_points?: number;
          components?: string[];
          description?: string;
          embedding?: string | null;
          estimated_points?: number;
          id?: string;
          module?: string;
          shipped_at?: string | null;
          surprises?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      scores: {
        Row: {
          alignment: Database["public"]["Enums"]["alignment"] | null;
          alignment_rationale: string | null;
          confidence: number;
          confidence_detail: Json;
          created_at: string;
          effort_source: Database["public"]["Enums"]["effort_source"];
          effort_weeks: number;
          id: string;
          impact: number;
          impact_evidence: string[];
          impact_rationale: string | null;
          insight_id: string;
          is_current: boolean;
          judgment: Json | null;
          moscow_rationale: string | null;
          moscow_reco: Database["public"]["Enums"]["moscow"] | null;
          okr_refs: string[];
          overridden: Json;
          rank: number | null;
          reach: number;
          reach_detail: Json;
          reach_mode: Database["public"]["Enums"]["reach_mode"];
          rice: number;
          robustness: Database["public"]["Enums"]["robustness"] | null;
          robustness_detail: Json;
          rule_flags: Json;
          version: number;
        };
        Insert: {
          alignment?: Database["public"]["Enums"]["alignment"] | null;
          alignment_rationale?: string | null;
          confidence: number;
          confidence_detail?: Json;
          created_at?: string;
          effort_source: Database["public"]["Enums"]["effort_source"];
          effort_weeks: number;
          id?: string;
          impact: number;
          impact_evidence?: string[];
          impact_rationale?: string | null;
          insight_id: string;
          is_current?: boolean;
          judgment?: Json | null;
          moscow_rationale?: string | null;
          moscow_reco?: Database["public"]["Enums"]["moscow"] | null;
          okr_refs?: string[];
          overridden?: Json;
          rank?: number | null;
          reach: number;
          reach_detail?: Json;
          reach_mode: Database["public"]["Enums"]["reach_mode"];
          rice: number;
          robustness?: Database["public"]["Enums"]["robustness"] | null;
          robustness_detail?: Json;
          rule_flags?: Json;
          version: number;
        };
        Update: {
          alignment?: Database["public"]["Enums"]["alignment"] | null;
          alignment_rationale?: string | null;
          confidence?: number;
          confidence_detail?: Json;
          created_at?: string;
          effort_source?: Database["public"]["Enums"]["effort_source"];
          effort_weeks?: number;
          id?: string;
          impact?: number;
          impact_evidence?: string[];
          impact_rationale?: string | null;
          insight_id?: string;
          is_current?: boolean;
          judgment?: Json | null;
          moscow_rationale?: string | null;
          moscow_reco?: Database["public"]["Enums"]["moscow"] | null;
          okr_refs?: string[];
          overridden?: Json;
          rank?: number | null;
          reach?: number;
          reach_detail?: Json;
          reach_mode?: Database["public"]["Enums"]["reach_mode"];
          rice?: number;
          robustness?: Database["public"]["Enums"]["robustness"] | null;
          robustness_detail?: Json;
          rule_flags?: Json;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "scores_insight_id_fkey";
            columns: ["insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["id"];
          },
        ];
      };
      threads: {
        Row: {
          created_at: string;
          id: string;
          last_message_at: string;
          page_context: Json | null;
          title: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_message_at?: string;
          page_context?: Json | null;
          title?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_message_at?: string;
          page_context?: Json | null;
          title?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      feedback_inbox: {
        Row: {
          analysis_status: Database["public"]["Enums"]["analysis_status"] | null;
          channel: Database["public"]["Enums"]["feedback_channel"] | null;
          churn_signal: boolean | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_plan: Database["public"]["Enums"]["customer_plan"] | null;
          customer_segment: Database["public"]["Enums"]["customer_segment"] | null;
          customer_status: Database["public"]["Enums"]["customer_status"] | null;
          existing_feature: boolean | null;
          id: string | null;
          injection_suspected: boolean | null;
          insight_ids: string[] | null;
          item_types: Database["public"]["Enums"]["item_type"][] | null;
          language: string | null;
          product_areas: Database["public"]["Enums"]["product_area"][] | null;
          received_at: string | null;
          search_text: string | null;
          subject: string | null;
          summary: string | null;
          truncated: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: "feedbacks_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      format_readable_id: {
        Args: { n: number; prefix: string; width: number };
        Returns: string;
      };
      sync_id_sequence: { Args: { entity: string }; Returns: number };
    };
    Enums: {
      alert_kind: "nouveau_sujet" | "emergent" | "churn" | "bug_critique" | "engagement";
      alert_status: "nouvelle" | "vue" | "traitee" | "ignoree";
      alignment: "aligne" | "neutre" | "hors_strategie";
      analysis_status: "ok" | "failed";
      backlog_kind: "story" | "bug" | "tache";
      backlog_status: "brouillon" | "valide" | "envoye" | "modifie_notion" | "rejete";
      bug_severity: "bloquant" | "majeur" | "mineur";
      confidence_level: "basse" | "moyenne" | "haute";
      customer_health: "vert" | "orange" | "rouge";
      customer_plan: "free" | "pro" | "business" | "enterprise";
      customer_segment:
        "agence_com" | "agence_digitale" | "conseil" | "pme_services" | "hors_cible";
      customer_status: "client" | "prospect";
      decision_action:
        | "override"
        | "validation"
        | "rejet"
        | "modification"
        | "desaccord"
        | "conflit"
        | "ajustement";
      decision_actor: "po" | "signal";
      decision_source: "signal_ui" | "chat" | "notion";
      dossier_status: "en_cours" | "pret" | "echec";
      effort_source: "estimation_initiale" | "backlog" | "manuel";
      feedback_channel:
        | "email_client"
        | "ticket_support"
        | "commentaire_in_app"
        | "nps"
        | "note_csm"
        | "note_sales"
        | "slack_interne";
      feedback_source_type: "client_direct" | "support" | "interne";
      insight_origin: "retours" | "manuel";
      insight_relation_kind: "tension";
      insight_status: "propose" | "actif" | "fusionne" | "rejete" | "archive";
      item_type:
        | "bug"
        | "demande_fonctionnelle"
        | "irritant_ux"
        | "question"
        | "eloge"
        | "signal_churn"
        | "autre";
      moscow: "must" | "should" | "could" | "wont";
      notion_data_source: "retours" | "insights" | "backlog";
      override_param: "reach" | "impact" | "confidence" | "effort" | "moscow";
      product_area:
        | "taches"
        | "tableau_kanban"
        | "notifications"
        | "permissions_partage"
        | "reporting_export"
        | "planification"
        | "integrations"
        | "facturation_temps"
        | "personnalisation"
        | "performance"
        | "autre";
      reach_mode: "comptes" | "mrr";
      robustness: "robuste" | "sensible" | "fragile";
      run_kind: "full" | "incremental" | "digest" | "eval";
      run_status: "en_cours" | "termine" | "echec";
      tshirt_size: "S" | "M" | "L" | "XL";
      urgency: "basse" | "moyenne" | "haute" | "critique";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      alert_kind: ["nouveau_sujet", "emergent", "churn", "bug_critique", "engagement"],
      alert_status: ["nouvelle", "vue", "traitee", "ignoree"],
      alignment: ["aligne", "neutre", "hors_strategie"],
      analysis_status: ["ok", "failed"],
      backlog_kind: ["story", "bug", "tache"],
      backlog_status: ["brouillon", "valide", "envoye", "modifie_notion", "rejete"],
      bug_severity: ["bloquant", "majeur", "mineur"],
      confidence_level: ["basse", "moyenne", "haute"],
      customer_health: ["vert", "orange", "rouge"],
      customer_plan: ["free", "pro", "business", "enterprise"],
      customer_segment: ["agence_com", "agence_digitale", "conseil", "pme_services", "hors_cible"],
      customer_status: ["client", "prospect"],
      decision_action: [
        "override",
        "validation",
        "rejet",
        "modification",
        "desaccord",
        "conflit",
        "ajustement",
      ],
      decision_actor: ["po", "signal"],
      decision_source: ["signal_ui", "chat", "notion"],
      dossier_status: ["en_cours", "pret", "echec"],
      effort_source: ["estimation_initiale", "backlog", "manuel"],
      feedback_channel: [
        "email_client",
        "ticket_support",
        "commentaire_in_app",
        "nps",
        "note_csm",
        "note_sales",
        "slack_interne",
      ],
      feedback_source_type: ["client_direct", "support", "interne"],
      insight_origin: ["retours", "manuel"],
      insight_relation_kind: ["tension"],
      insight_status: ["propose", "actif", "fusionne", "rejete", "archive"],
      item_type: [
        "bug",
        "demande_fonctionnelle",
        "irritant_ux",
        "question",
        "eloge",
        "signal_churn",
        "autre",
      ],
      moscow: ["must", "should", "could", "wont"],
      notion_data_source: ["retours", "insights", "backlog"],
      override_param: ["reach", "impact", "confidence", "effort", "moscow"],
      product_area: [
        "taches",
        "tableau_kanban",
        "notifications",
        "permissions_partage",
        "reporting_export",
        "planification",
        "integrations",
        "facturation_temps",
        "personnalisation",
        "performance",
        "autre",
      ],
      reach_mode: ["comptes", "mrr"],
      robustness: ["robuste", "sensible", "fragile"],
      run_kind: ["full", "incremental", "digest", "eval"],
      run_status: ["en_cours", "termine", "echec"],
      tshirt_size: ["S", "M", "L", "XL"],
      urgency: ["basse", "moyenne", "haute", "critique"],
    },
  },
} as const;
