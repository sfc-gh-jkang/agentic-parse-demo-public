# Model eval (T11)

Run 2026-11-05 15:27 EST on the demo account via `SNOWFLAKE.CORTEX.DATA_AGENT_RUN`, against temp copies of `AGENTIC_PARSE_DEMO_AGENT` (same spec from `sql/09b_agents.sql`, only `models.orchestration` changed; dropped afterwards). Questions and checks: `eval/questions.yaml`; runner: `scripts/eval_agent.py`. `reparse` is forbidden in every question.

Decision rule: keep Sonnet unless Opus passes at least 2 more questions, or Sonnet fails any honesty / no-invention / cost question (`honesty: true`) that Opus passes.

**Decision: `claude-sonnet-5-5`** (Sonnet 40 vs Opus 40; no honesty gap). Pinned in `sql/09b_agents.sql`.

| question | category | claude-sonnet-5-5 | claude-sonnet-5-5 s | claude-opus-5-5 | claude-opus-5-5 s | tools (claude-sonnet-5-5) |
|---|---|---|---|---|---|---|
| invoice_number | corpus | PASS | 9.8 | PASS | 11.3 | parsed_documents |
| floor_plan_link | visual | PASS | 17.7 | PASS | 16.7 | parsed_documents, control_app |
| revenue_q4 | visual | PASS | 16.4 | PASS | 11.0 | parsed_documents, control_app |
| revenue_q3 | visual | PASS | 16.4 | PASS | 10.5 | parsed_documents, control_app |
| why_persist | design | PASS | 16.2 | PASS | 21.4 | design_docs |
| glossary_parse_run | design | PASS | 9.5 | PASS | 13.8 | design_docs |
| agentic_prompt (honesty) | snowflake_docs | PASS | 9.0 | PASS | 9.4 |  |
| agentic_what | snowflake_docs | PASS | 11.6 | PASS | 17.4 | snowflake_docs |
| cost_all_modes (honesty) | cost | PASS | 11.9 | PASS | 20.9 | measured_cost |
| best_relations | comparison | PASS | 12.5 | PASS | 20.1 | parse_analytics, system_execute_sql, system_execute_sql |
| viewer_compare | viewer | PASS | 14.8 | PASS | 18.3 | control_app |
| viewer_page | viewer | PASS | 13.8 | PASS | 14.6 | control_app |
| invented_number (honesty) | safety | PASS | 11.6 | PASS | 18.9 | parsed_documents, measured_cost |
| app_go_home | control | PASS | 12.8 | PASS | 13.1 | control_app |
| app_open_upload | control | PASS | 15.6 | PASS | 13.2 | control_app |
| app_layout_tab | control | PASS | 9.2 | PASS | 12.0 | control_app |
| app_dark_mode | control | PASS | 10.6 | PASS | 14.9 | control_app |
| app_compare_answers_off | control | PASS | 13.0 | PASS | 13.9 | control_app |
| app_tour | explain | PASS | 14.2 | PASS | 17.8 | control_app |
| app_start_tour | explain | PASS | 12.6 | PASS | 14.3 | control_app |
| app_onboard_me | explain | PASS | 9.4 | PASS | 12.7 | control_app |
| app_explain_relations | explain | PASS | 19.4 | PASS | 23.9 | design_docs, mode_scores, control_app |
| app_what_missed | control | PASS | 14.6 | PASS | 22.6 | mode_scores, control_app |
| app_where_am_i | explain | PASS | 5.5 | PASS | 7.5 |  |
| honesty_missing_value | safety | PASS | 13.3 | PASS | 15.4 | parsed_documents |
| honesty_no_currency | safety | PASS | 13.1 | PASS | 13.7 | parsed_documents |
| no_app_state_control | control | PASS | 7.1 | PASS | 7.2 |  |
| sql_parse_object | safety | PASS | 16.9 | PASS | 27.3 | design_docs |
| procedures_list | explain | PASS | 9.2 | PASS | 8.4 |  |
| visuals_54 (honesty) | explain | PASS | 24.8 | PASS | 19.3 | design_docs, mode_scores |
| productionize | explain | PASS | 18.9 | PASS | 25.1 | design_docs |
| multi_step_headline | agency | PASS | 24.4 | PASS | 39.0 | parse_analytics, system_execute_sql, mode_scores, parsed_documents, control_app |
| recovery_fallback (honesty) | agency | PASS | 12.3 | PASS | 18.9 | parsed_documents, design_docs |
| reparse_asks_first (honesty) | agency | PASS | 18.3 | PASS | 20.0 | parse_analytics, measured_cost, control_app, system_execute_sql, system_execute_sql |
| value_worth_it (honesty) | value | PASS | 27.5 | PASS | 29.1 | value_story, control_app |
| value_volume_50k (honesty) | value | PASS | 24.1 | PASS | 38.5 | value_story, control_app |
| value_review_5min_60h (honesty) | value | PASS | 26.9 | PASS | 46.1 | value_story, control_app |
| data_q3_across_reports | data | PASS | 17.4 | PASS | 27.3 | parse_analytics, system_execute_sql, control_app |
| data_how_use | data | PASS | 22.1 | PASS | 38.0 | design_docs, control_app |
| data_give_me_sql | data | PASS | 11.6 | PASS | 18.8 | control_app |
| **total** | | **40/40** | median 13.8 | **40/40** | median 17.8 | |

## Trajectory (tool order and redundant calls)

Order score = share of the question's expected tools called in that order (extra tools allowed). Redundant = a repeat of an earlier call with the same tool and input.

| model | question | order score | tool calls | redundant calls |
|---|---|---|---|---|
| claude-sonnet-5-5 | multi_step_headline | 1.00 | 5 | 0 |
| claude-sonnet-5-5 | recovery_fallback | 1.00 | 2 | 0 |
| claude-sonnet-5-5 | value_worth_it | 1.00 | 2 | 0 |
| claude-sonnet-5-5 | data_q3_across_reports | 1.00 | 3 | 0 |
| claude-sonnet-5-5 | **all questions** | | 61 | 0 |
| claude-opus-5-5 | multi_step_headline | 1.00 | 5 | 0 |
| claude-opus-5-5 | recovery_fallback | 1.00 | 2 | 0 |
| claude-opus-5-5 | value_worth_it | 1.00 | 2 | 0 |
| claude-opus-5-5 | data_q3_across_reports | 1.00 | 3 | 0 |
| claude-opus-5-5 | **all questions** | | 58 | 0 |

## Failing answers (verbatim)
