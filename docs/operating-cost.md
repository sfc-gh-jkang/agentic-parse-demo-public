# Operating cost

What the demo costs when nobody is using it, and how to pause it. Measured 2026-11-01 on the author's demo account (AWS US East 1). The app was **not** suspended for this measurement.

## Idle cost of the app

The app is an application service on Snowflake App Runtime, serverless (`SHOW APPLICATION SERVICES`: status RUNNING, `auto_suspend_secs` 0, so it never auto-suspends). App Runtime compute is reported in `SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY` (https://docs.snowflake.com/en/sql-reference/account-usage/snowflake_app_runtime_compute_history), hourly. Per the docs, all App Runtime apps in an account share Snowflake-managed compute, and the view has no per-app column, so the figure below is for **all** App Runtime apps on this account.

Executed 2026-11-01 (role ACCOUNTADMIN; ACCOUNT_USAGE needs it or a role with IMPORTED PRIVILEGES on SNOWFLAKE):

```sql
SELECT DATE_TRUNC('day', START_TIME) AS DAY, COUNT(*) AS HOURS, ROUND(SUM(CREDITS_USED), 4) AS CREDITS
FROM SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY
WHERE START_TIME >= DATEADD(day, -3, DATE_TRUNC('day', CURRENT_TIMESTAMP()))
GROUP BY 1 ORDER BY 1;
```

| Day (PDT) | Hours | Credits, all App Runtime apps |
|---|---|---|
| 2026-10-29 | 24 | 1.4297 |
| 2026-10-30 | 24 | 1.4250 |
| 2026-10-31 | 24 | 1.4235 |

Hourly values ranged 0.04 to 0.07 credits and were flat across the day whether or not anyone used the app, so this is effectively the idle cost. On those days 6 application services were RUNNING on the account (`SHOW APPLICATION SERVICES IN ACCOUNT`, 2026-11-01: AGENTIC_PARSE_DEMO plus 5 other demos); 5 more were SUSPENDED.

- **Upper bound for this app:** 1.43 credits per idle day (if it were the only running app).
- **Even split, derived not measured:** 1.43 / 6 running apps ≈ 0.24 credits per day. Snowflake does not publish the attribution rule, so treat this as an estimate.

Usage is not idle cost: every agent answer is billed under `CORTEX_AGENTS` in `METERING_HISTORY` (2026-10-28 00:00 to 2026-11-01 07:00 account time, re-derived 2026-11-01: `AGENTIC_PARSE_DEMO_AGENT` 20.39 credits over 33 hours with use, the temporary eval agents 32.17 (`..._EVAL_SONNET` 21.02, `..._EVAL_OPUS` 11.15), `AGENTIC_PARSE_DEMO_SI_AGENT` 0.49), and parses are billed per page (docs/technical-guide.md, Measured cost). Running `scripts/eval_agent.py` is the most expensive routine thing in this repo.

## Pause and resume

From the Snowflake Apps operate skill and https://docs.snowflake.com/en/sql-reference/sql/alter-application-service . Compile-checked 2026-11-01, **not executed** (suspending takes the app offline for everyone):

```sql
ALTER APPLICATION SERVICE SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.AGENTIC_PARSE_DEMO SUSPEND;
ALTER APPLICATION SERVICE SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.AGENTIC_PARSE_DEMO RESUME;
```

`auto_resume` is true by default, so opening the URL of a suspended app should start it again; that path and its cold-start time were not tested here. Resume it yourself at least 30 minutes before a demo (runbook §1) rather than relying on auto-resume. Warehouse `SFE_AGENTIC_PARSE_DEMO_WH` auto-suspends on its own and costs nothing while idle; the stored Corpus is a few MB of storage.

Property changes such as `SET AUTO_SUSPEND_SECS` do not survive the next `snow app deploy` (app.yml v2 is applied declaratively); put lasting changes in `web/app.yml`.
