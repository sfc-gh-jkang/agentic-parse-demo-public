-- Agent action tools (T10; control_app T18). Idempotent. Run after 08_search_agent.sql; the agents themselves are
-- generated into 09b_agents.sql (scripts/gen_agents_sql.py).
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

-- CONTROL_APP: validates one app action and echoes it as JSON. Side-effect free: it reads
-- DOCUMENT_CATALOG and PARSE_VISUALS and writes nothing. The app applies the echoed action (route,
-- viewer, theme, spotlight, tour); anything invalid comes back as {"error": ...}. Pages are 1-based,
-- as people count. Optional fields combine with any action, e.g. open_document + page + view + pair.
-- STEPS is a JSON array string: agent generic tools on a warehouse reject array arguments.
-- Keep TARGETS in sync with web/lib/app-actions.ts (tests/test_agent_tools.py checks both).
-- An earlier draft took STEPS ARRAY; drop it first or the new signature is an ambiguous overload.
DROP PROCEDURE IF EXISTS CONTROL_APP(STRING, STRING, NUMBER, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, ARRAY);
-- T21 pass 5 added VOLUME (set_volume): the 15-argument form would otherwise stay behind as an ambiguous overload.
DROP PROCEDURE IF EXISTS CONTROL_APP(STRING, STRING, NUMBER, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING);
-- T21 pass 6 added REVIEW_MINUTES, HOURLY_RATE, CREDIT_PRICE (set_review_assumptions): drop the 16-argument form too.
DROP PROCEDURE IF EXISTS CONTROL_APP(STRING, STRING, NUMBER, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, NUMBER);
CREATE OR REPLACE PROCEDURE CONTROL_APP(
  ACTION STRING, DOC STRING DEFAULT NULL, PAGE NUMBER DEFAULT NULL, VIEW STRING DEFAULT NULL,
  MODE STRING DEFAULT NULL, PAIR STRING DEFAULT NULL, VISUAL STRING DEFAULT NULL, ZOOM STRING DEFAULT NULL,
  MISSED STRING DEFAULT NULL, COMPARE_ANSWERS STRING DEFAULT NULL, THEME STRING DEFAULT NULL,
  SCROLL STRING DEFAULT NULL, TARGET STRING DEFAULT NULL, CAPTION STRING DEFAULT NULL, STEPS STRING DEFAULT NULL,
  VOLUME NUMBER DEFAULT NULL, REVIEW_MINUTES FLOAT DEFAULT NULL, HOURLY_RATE FLOAT DEFAULT NULL, CREDIT_PRICE FLOAT DEFAULT NULL)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  targets ARRAY DEFAULT ARRAY_CONSTRUCT('document_list', 'upload_card', 'score_strip', 'what_was_missed', 'mode_tabs',
    'view_toggle', 'compare_pair_tabs', 'page_buttons', 'zoom_controls', 'document_page', 'visual_box', 'visual_detail',
    'parsed_text', 'run_button', 'cached_label', 'chat_panel', 'compare_answers_toggle', 'compare_answers_table',
    'theme_toggle', 'command_menu', 'cost_stats', 'presenter_questions', 'eval_button', 'value_panel', 'volume_input',
    'use_data_tab', 'doc_tabs');
  v_action STRING DEFAULT LOWER(TRIM(:ACTION));
  v_doc STRING DEFAULT NULLIF(TRIM(:DOC), '');
  v_view STRING DEFAULT LOWER(NULLIF(TRIM(:VIEW), ''));
  v_mode STRING DEFAULT UPPER(NULLIF(TRIM(:MODE), ''));
  v_pair STRING DEFAULT UPPER(NULLIF(TRIM(:PAIR), ''));
  v_visual STRING DEFAULT NULLIF(TRIM(:VISUAL), '');
  v_zoom STRING DEFAULT LOWER(NULLIF(TRIM(:ZOOM), ''));
  v_missed STRING DEFAULT LOWER(NULLIF(TRIM(:MISSED), ''));
  v_cmp STRING DEFAULT LOWER(NULLIF(TRIM(:COMPARE_ANSWERS), ''));
  v_theme STRING DEFAULT LOWER(NULLIF(TRIM(:THEME), ''));
  v_scroll STRING DEFAULT LOWER(NULLIF(TRIM(:SCROLL), ''));
  v_target STRING DEFAULT LOWER(NULLIF(TRIM(:TARGET), ''));
  v_caption STRING DEFAULT NULLIF(TRIM(:CAPTION), '');
  v_page NUMBER DEFAULT :PAGE;
  v_in VARIANT DEFAULT TRY_PARSE_JSON(NULLIF(TRIM(:STEPS), ''));
  v_steps ARRAY DEFAULT ARRAY_CONSTRUCT();
  v_step OBJECT;
  v_s_target STRING;
  v_s_caption STRING;
  v_s_route STRING;
  v_s_doc STRING;
  v_s_page NUMBER;
  v_pages NUMBER;
  v_found NUMBER;
  v_vpage NUMBER;
  i NUMBER DEFAULT 0;
BEGIN
  IF (v_action IS NULL OR v_action NOT IN ('go_home', 'open_document', 'set_page', 'set_view', 'set_mode', 'set_pair',
      'select_visual', 'close_visual', 'zoom', 'show_missed', 'set_compare_answers', 'open_upload', 'set_theme',
      'scroll', 'highlight', 'clear_highlight', 'tour', 'start_tour', 'open_value_panel', 'set_volume', 'set_review_assumptions', 'open_use_data_tab')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'unknown action: ' || COALESCE(:ACTION, 'null')));
  END IF;
  IF (v_action IN ('go_home', 'open_upload') AND (v_doc IS NOT NULL OR v_page IS NOT NULL OR v_visual IS NOT NULL)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', v_action || ' goes to the home page; it takes no doc, page or visual'));
  END IF;
  IF (v_action IN ('open_document', 'select_visual', 'open_use_data_tab') AND v_doc IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', v_action || ' needs doc'));
  END IF;
  IF (v_action = 'set_volume' AND :VOLUME IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_volume needs volume (pages per month)'));
  END IF;
  IF (v_action = 'set_review_assumptions' AND :REVIEW_MINUTES IS NULL AND :HOURLY_RATE IS NULL AND :CREDIT_PRICE IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_review_assumptions needs at least one of review_minutes, hourly_rate, credit_price (the user''s own numbers)'));
  END IF;
  IF ((:REVIEW_MINUTES IS NOT NULL OR :HOURLY_RATE IS NOT NULL OR :CREDIT_PRICE IS NOT NULL) AND v_action NOT IN ('set_volume', 'set_review_assumptions')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'review_minutes, hourly_rate and credit_price go with set_volume or set_review_assumptions'));
  END IF;
  IF (:REVIEW_MINUTES IS NOT NULL AND (:REVIEW_MINUTES <= 0 OR :REVIEW_MINUTES > 600)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'review_minutes must be more than 0 and at most 600 (minutes of human review per page to check)'));
  END IF;
  IF (:HOURLY_RATE IS NOT NULL AND (:HOURLY_RATE <= 0 OR :HOURLY_RATE > 100000)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'hourly_rate must be more than 0 and at most 100000'));
  END IF;
  IF (:CREDIT_PRICE IS NOT NULL AND (:CREDIT_PRICE <= 0 OR :CREDIT_PRICE > 100000)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'credit_price must be more than 0 and at most 100000 (the user''s own price per credit)'));
  END IF;
  IF (:VOLUME IS NOT NULL AND (:VOLUME < 1 OR :VOLUME > 1000000000 OR :VOLUME != FLOOR(:VOLUME))) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'volume must be a whole number of pages per month, 1 to 1,000,000,000'));
  END IF;
  IF (v_doc IS NOT NULL) THEN
    SELECT COUNT(*), MAX(PAGES) INTO :v_found, :v_pages FROM DOCUMENT_CATALOG WHERE DOC_ID = :v_doc;
    IF (v_found = 0) THEN
      RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'unknown doc: ' || v_doc));
    END IF;
  END IF;
  IF (v_action = 'set_page' AND v_page IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_page needs page'));
  END IF;
  IF (v_page IS NOT NULL AND (v_page < 1 OR v_page != FLOOR(v_page) OR (v_pages IS NOT NULL AND v_page > v_pages))) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'page ' || v_page || ' out of range' ||
      IFF(v_doc IS NULL, ' (pages start at 1)', ' for ' || v_doc || ' (1..' || COALESCE(v_pages, 1) || ')')));
  END IF;
  IF (v_action = 'set_view' AND v_view IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_view needs view'));
  END IF;
  IF (v_view IS NOT NULL AND v_view NOT IN ('one', 'compare')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'view must be one or compare'));
  END IF;
  IF (v_action = 'set_mode' AND v_mode IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_mode needs mode'));
  END IF;
  IF (v_mode IS NOT NULL AND v_mode NOT IN ('AGENTIC', 'LAYOUT', 'OCR')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'mode must be AGENTIC, LAYOUT or OCR'));
  END IF;
  IF (v_action = 'set_pair' AND v_pair IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_pair needs pair'));
  END IF;
  IF (v_pair IS NOT NULL AND v_pair NOT IN ('LAYOUT', 'OCR')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'pair must be LAYOUT or OCR (the other side is always AGENTIC)'));
  END IF;
  IF (v_action = 'select_visual' AND v_visual IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'select_visual needs visual'));
  END IF;
  IF (v_visual IS NOT NULL) THEN
    IF (v_doc IS NULL) THEN
      RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'visual needs doc'));
    END IF;
    SELECT COUNT(*), MIN(PAGE_INDEX) INTO :v_found, :v_vpage FROM PARSE_VISUALS WHERE DOC_ID = :v_doc AND VISUAL_ID = :v_visual;
    IF (v_found = 0) THEN
      RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'unknown visual ' || v_visual || ' in ' || v_doc));
    END IF;
    v_page := COALESCE(v_page, v_vpage + 1);
  END IF;
  IF (v_action = 'zoom' AND v_zoom IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'zoom needs zoom'));
  END IF;
  IF (v_zoom IS NOT NULL AND v_zoom NOT IN ('fit_width', 'fit_page')
      AND COALESCE(TRY_TO_NUMBER(RTRIM(v_zoom, '%')) BETWEEN 25 AND 300, FALSE) = FALSE) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'zoom must be fit_width, fit_page or a percent 25-300'));
  END IF;
  IF (v_zoom IS NOT NULL AND v_zoom NOT IN ('fit_width', 'fit_page')) THEN
    v_zoom := TO_VARCHAR(TO_NUMBER(RTRIM(v_zoom, '%')));
  END IF;
  IF (v_action = 'show_missed' AND v_missed IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'show_missed needs missed'));
  END IF;
  IF (v_missed IS NOT NULL AND v_missed NOT IN ('open', 'close')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'missed must be open or close'));
  END IF;
  IF (v_action = 'set_compare_answers' AND v_cmp IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_compare_answers needs compare_answers'));
  END IF;
  IF (v_cmp IS NOT NULL AND v_cmp NOT IN ('on', 'off')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'compare_answers must be on or off'));
  END IF;
  IF (v_action = 'set_theme' AND v_theme IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'set_theme needs theme'));
  END IF;
  IF (v_theme IS NOT NULL AND v_theme NOT IN ('light', 'dark')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'theme must be light or dark'));
  END IF;
  IF (v_action = 'scroll' AND v_scroll IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'scroll needs scroll'));
  END IF;
  IF (v_scroll IS NOT NULL AND v_scroll NOT IN ('top', 'bottom', 'parsed_text', 'document')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'scroll must be top, bottom, parsed_text or document'));
  END IF;
  IF (v_action = 'highlight' AND (v_target IS NULL OR v_caption IS NULL)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'highlight needs target and caption'));
  END IF;
  IF (v_target IS NOT NULL AND NOT ARRAY_CONTAINS(v_target::VARIANT, :targets)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'unknown target: ' || v_target || '; targets: ' || ARRAY_TO_STRING(:targets, ', ')));
  END IF;
  IF (v_caption IS NOT NULL AND LENGTH(v_caption) > 400) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'caption longer than 400 characters'));
  END IF;
  IF (NULLIF(TRIM(:STEPS), '') IS NOT NULL AND (v_in IS NULL OR TYPEOF(v_in) != 'ARRAY')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'steps must be a JSON array of {target, caption} objects'));
  END IF;
  IF (v_action = 'tour' AND (v_in IS NULL OR ARRAY_SIZE(v_in) = 0)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'tour needs steps'));
  END IF;
  IF (v_in IS NOT NULL) THEN
    IF (ARRAY_SIZE(v_in) > 8) THEN
      RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'a tour has at most 8 steps'));
    END IF;
    WHILE (i < ARRAY_SIZE(v_in)) DO
      IF (TYPEOF(GET(v_in, :i)) != 'OBJECT') THEN
        RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'step ' || (i + 1) || ' must be an object'));
      END IF;
      v_step := GET(v_in, :i)::OBJECT;
      v_s_target := LOWER(TRIM(v_step:target::STRING));
      v_s_caption := NULLIF(TRIM(v_step:caption::STRING), '');
      v_s_route := LOWER(NULLIF(TRIM(v_step:route::STRING), ''));
      v_s_doc := NULLIF(TRIM(v_step:doc::STRING), '');
      v_s_page := TRY_TO_NUMBER(v_step:page::STRING);
      IF (v_s_target IS NULL OR NOT ARRAY_CONTAINS(v_s_target::VARIANT, :targets)) THEN
        RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'step ' || (i + 1) || ': unknown target ' || COALESCE(v_s_target, 'null')));
      END IF;
      IF (v_s_caption IS NULL OR LENGTH(v_s_caption) > 400) THEN
        RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'step ' || (i + 1) || ' needs a caption of at most 400 characters'));
      END IF;
      IF (v_s_route IS NOT NULL AND v_s_route NOT IN ('home', 'document')) THEN
        RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'step ' || (i + 1) || ': route must be home or document'));
      END IF;
      IF (v_s_doc IS NOT NULL) THEN
        SELECT COUNT(*), MAX(PAGES) INTO :v_found, :v_pages FROM DOCUMENT_CATALOG WHERE DOC_ID = :v_s_doc;
        IF (v_found = 0) THEN
          RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'step ' || (i + 1) || ': unknown doc ' || v_s_doc));
        END IF;
      END IF;
      IF (v_step:page IS NOT NULL AND (v_s_page IS NULL OR v_s_page < 1 OR v_s_page != FLOOR(v_s_page)
          OR (v_s_doc IS NOT NULL AND v_s_page > v_pages))) THEN
        RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'step ' || (i + 1) || ': page out of range'));
      END IF;
      v_steps := ARRAY_APPEND(:v_steps, OBJECT_CONSTRUCT('target', v_s_target, 'caption', v_s_caption,
        'route', v_s_route, 'doc', v_s_doc, 'page', v_s_page));
      i := i + 1;
    END WHILE;
  END IF;
  RETURN TO_JSON(OBJECT_CONSTRUCT('action', v_action, 'doc', v_doc, 'page', v_page, 'view', v_view, 'mode', v_mode,
    'pair', v_pair, 'visual', v_visual, 'zoom', v_zoom, 'missed', v_missed, 'compare_answers', v_cmp,
    'theme', v_theme, 'scroll', v_scroll, 'target', v_target, 'caption', v_caption, 'volume', :VOLUME,
    'review_minutes', :REVIEW_MINUTES, 'hourly_rate', :HOURLY_RATE, 'credit_price', :CREDIT_PRICE,
    'steps', IFF(ARRAY_SIZE(:v_steps) = 0, NULL, :v_steps),
    -- Read by the agent, ignored by the app (it keeps only known fields). Round 7: from Snowflake
    -- Intelligence the agent said "the screen now shows ..." with no app open.
    'note', 'Only the demo web app applies this, when the user message had an [App state] line. Without that line nothing on any screen changed: do not say it did.'));
END;
$$;

-- Replaced by CONTROL_APP (T18).
DROP PROCEDURE IF EXISTS CONTROL_VIEWER(STRING, STRING, NUMBER, STRING, STRING, STRING, STRING);

-- REPARSE: the agent's re-parse tool. A live, billed AI_PARSE_DOCUMENT call through APP_PARSE
-- (which records the Parse Run and refreshes its Mode Comparison). Agent instructions restrict it
-- to explicit user requests.
CREATE OR REPLACE PROCEDURE REPARSE(DOC STRING, MODE STRING)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_res STRING;
BEGIN
  IF (UPPER(:MODE) NOT IN ('OCR', 'LAYOUT', 'AGENTIC')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('ok', FALSE, 'error', 'mode must be OCR, LAYOUT or AGENTIC'));
  END IF;
  CALL APP_PARSE(:DOC, UPPER(:MODE)) INTO :v_res;
  -- doc and mode ride along so the app can show the new Live result.
  RETURN TO_JSON(OBJECT_INSERT(OBJECT_INSERT(PARSE_JSON(:v_res)::OBJECT, 'doc', :DOC), 'mode', UPPER(:MODE)));
END;
$$;

-- MODE_SCORES: stored Mode Comparison scores per Document and Mode (no re-parse, no scoring run).
-- NULL doc = every Document. MATCHES/MISSED detail is dropped to keep the tool result small.
CREATE OR REPLACE PROCEDURE MODE_SCORES(DOC STRING DEFAULT NULL)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v STRING;
BEGIN
  SELECT TO_JSON(ARRAY_AGG(OBJECT_CONSTRUCT(
           'doc', DOC_ID, 'mode', MODE, 'run_id', RUN_ID,
           'image_facts', IMAGE_FACTS, 'image_facts_found', IMAGE_FACTS_FOUND,
           'text_facts', TEXT_FACTS, 'text_facts_found', TEXT_FACTS_FOUND,
           'relations', RELATIONS, 'relations_found', RELATIONS_FOUND,
           'visuals_expected', VISUALS_EXPECTED, 'visuals_detected', VISUALS_DETECTED,
           'chars', CHARS, 'tables', TABLES)) WITHIN GROUP (ORDER BY DOC_ID, MODE))
    INTO :v
  FROM MODE_COMPARISONS WHERE :DOC IS NULL OR DOC_ID = :DOC;
  RETURN COALESCE(v, '[]');
END;
$$;

-- MEASURED_COST: PARSE_COST as JSON. Credits come only from metered usage; runs whose usage has
-- not landed yet are counted as pending and carry no credits.
CREATE OR REPLACE PROCEDURE MEASURED_COST(DOC STRING DEFAULT NULL)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v STRING;
BEGIN
  CALL PARSE_COST(:DOC);
  SELECT TO_JSON(ARRAY_AGG(OBJECT_CONSTRUCT(*))) INTO :v FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
  RETURN COALESCE(v, '[]');
END;
$$;

-- VALUE_STORY: the value of AGENTIC mode from stored data only (07b views): measured credits per page, facts and
-- relations recovered, pages left to check by hand, and COST PER CORRECT FACT = credits to parse the scored corpus
-- (measured credits per page x pages) / facts found. Nothing is hardcoded and nothing is estimated except the optional
-- monthly volume: PAGES_PER_MONTH x measured credits per page, and x facts found per corpus page (an estimate from
-- this corpus; another mix of Documents will differ). Honest by construction: every mode is reported, favourable or not.
-- control_docs: Documents where the cheapest Mode already recovers every fact and relation AGENTIC does.
-- hard_pages: pages where OCR or LAYOUT missed a Ground Truth fact; routing only those to AGENTIC is an oracle estimate
-- (it assumes the hard pages are known before parsing).
-- Pass 6: optional REVIEW_MINUTES_PER_PAGE, HOURLY_RATE and PRICE_PER_CREDIT are the USER'S OWN assumptions (nothing is
-- hardcoded). Review hours = (pages to check / corpus pages) x PAGES_PER_MONTH x minutes / 60; review cost = hours x rate;
-- credits are converted to money only with the user's PRICE_PER_CREDIT. Needs PAGES_PER_MONTH.
DROP PROCEDURE IF EXISTS VALUE_STORY(NUMBER);
CREATE OR REPLACE PROCEDURE VALUE_STORY(PAGES_PER_MONTH NUMBER DEFAULT NULL, REVIEW_MINUTES_PER_PAGE FLOAT DEFAULT NULL,
                                        HOURLY_RATE FLOAT DEFAULT NULL, PRICE_PER_CREDIT FLOAT DEFAULT NULL)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_modes VARIANT;
  v_control VARIANT;
  v_hard VARIANT;
  v_month VARIANT DEFAULT NULL;
  v_review VARIANT DEFAULT NULL;
  v_pages NUMBER;
BEGIN
  IF (:PAGES_PER_MONTH IS NOT NULL AND (:PAGES_PER_MONTH < 1 OR :PAGES_PER_MONTH > 1000000000)) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'pages_per_month must be between 1 and 1,000,000,000'));
  END IF;
  IF ((:REVIEW_MINUTES_PER_PAGE IS NOT NULL OR :HOURLY_RATE IS NOT NULL OR :PRICE_PER_CREDIT IS NOT NULL) AND :PAGES_PER_MONTH IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'review assumptions need pages_per_month'));
  END IF;
  IF (:HOURLY_RATE IS NOT NULL AND :REVIEW_MINUTES_PER_PAGE IS NULL) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'hourly_rate needs review_minutes_per_page'));
  END IF;
  IF ((:REVIEW_MINUTES_PER_PAGE IS NOT NULL AND (:REVIEW_MINUTES_PER_PAGE <= 0 OR :REVIEW_MINUTES_PER_PAGE > 600))
      OR (:HOURLY_RATE IS NOT NULL AND (:HOURLY_RATE <= 0 OR :HOURLY_RATE > 100000))
      OR (:PRICE_PER_CREDIT IS NOT NULL AND (:PRICE_PER_CREDIT <= 0 OR :PRICE_PER_CREDIT > 100000))) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('error', 'review_minutes_per_page must be 0 to 600; hourly_rate and price_per_credit must be above 0 and at most 100000'));
  END IF;
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
           'mode', MODE, 'credits_per_page', CREDITS_PER_PAGE::FLOAT, 'credits_per_1k_pages', (CREDITS_PER_PAGE * 1000)::FLOAT,
           'corpus_pages', CORPUS_PAGES, 'corpus_credits', CORPUS_CREDITS::FLOAT,
           'facts', FACTS, 'facts_found', FACTS_FOUND, 'relations', RELATIONS, 'relations_found', RELATIONS_FOUND,
           'pages_to_check', PAGES_TO_CHECK, 'cost_per_correct_fact', COST_PER_CORRECT_FACT::FLOAT,
           'derivation', 'cost per correct fact = ' || CORPUS_PAGES || ' pages x ' || TO_VARCHAR(CREDITS_PER_PAGE, 'FM0.00000') ||
             ' measured credits per page = ' || TO_VARCHAR(CORPUS_CREDITS, 'FM0.0000') || ' credits to parse the scored corpus / ' ||
             FACTS_FOUND || ' of ' || FACTS || ' facts found = ' || TO_VARCHAR(COST_PER_CORRECT_FACT, 'FM0.000000') || ' credits per correct fact')
         ) WITHIN GROUP (ORDER BY CREDITS_PER_PAGE)
    INTO :v_modes FROM VALUE_BY_MODE;
  SELECT MAX(CORPUS_PAGES) INTO :v_pages FROM VALUE_BY_MODE;
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('doc', DOC_ID, 'pages', PAGES, 'cheapest_mode', CHEAPEST_MODE, 'facts_found', FACTS_FOUND,
                                    'relations_found', RELATIONS_FOUND, 'agentic_credits_multiple', AGENTIC_MULTIPLE::FLOAT))
    INTO :v_control
    FROM (SELECT a.DOC_ID, a.PAGES, c.MODE AS CHEAPEST_MODE, c.FACTS_FOUND, c.RELATIONS_FOUND,
                 a.CREDITS_PER_PAGE / c.CREDITS_PER_PAGE AS AGENTIC_MULTIPLE
          FROM VALUE_BY_DOC_MODE a
          JOIN VALUE_BY_DOC_MODE c ON c.DOC_ID = a.DOC_ID AND c.MODE <> 'AGENTIC'
                                  AND c.FACTS_GAP_TO_AGENTIC <= 0 AND c.RELATIONS_GAP_TO_AGENTIC <= 0
          WHERE a.MODE = 'AGENTIC'
          QUALIFY ROW_NUMBER() OVER (PARTITION BY a.DOC_ID ORDER BY c.CREDITS_PER_PAGE) = 1);
  v_hard := (SELECT OBJECT_CONSTRUCT(
           'pages_total', :v_pages,
           'pages_hard', (SELECT COUNT(*) FROM VALUE_HARD_PAGES),
           'agentic_on_hard_pages_credits', ((SELECT COUNT(*) FROM VALUE_HARD_PAGES) * a.CREDITS_PER_PAGE)::FLOAT,
           'agentic_everywhere_credits', (:v_pages * a.CREDITS_PER_PAGE)::FLOAT,
           'ocr_everywhere_credits', (:v_pages * o.CREDITS_PER_PAGE)::FLOAT,
           'routed_credits', (:v_pages * o.CREDITS_PER_PAGE + (SELECT COUNT(*) FROM VALUE_HARD_PAGES) * a.CREDITS_PER_PAGE)::FLOAT,
           'note', 'Oracle estimate: assumes the hard pages are known before parsing. Routed = OCR on every page plus AGENTIC on the hard pages.')
    FROM VALUE_CREDITS_PER_PAGE a, VALUE_CREDITS_PER_PAGE o WHERE a.MODE = 'AGENTIC' AND o.MODE = 'OCR');
  IF (:PAGES_PER_MONTH IS NOT NULL) THEN
    v_month := (SELECT OBJECT_CONSTRUCT('pages_per_month', :PAGES_PER_MONTH,
             'label', 'estimate from measured rates on this corpus',
             'modes', ARRAY_AGG(OBJECT_CONSTRUCT('mode', MODE, 'monthly_credits', (:PAGES_PER_MONTH * CREDITS_PER_PAGE)::FLOAT,
               'expected_facts_recovered', (:PAGES_PER_MONTH * FACTS_FOUND / CORPUS_PAGES)::FLOAT)) WITHIN GROUP (ORDER BY CREDITS_PER_PAGE))
      FROM VALUE_BY_MODE);
  END IF;
  IF (:REVIEW_MINUTES_PER_PAGE IS NOT NULL OR :PRICE_PER_CREDIT IS NOT NULL) THEN
    v_review := (SELECT OBJECT_CONSTRUCT('pages_per_month', :PAGES_PER_MONTH, 'review_minutes_per_page', :REVIEW_MINUTES_PER_PAGE,
             'hourly_rate', :HOURLY_RATE, 'price_per_credit', :PRICE_PER_CREDIT,
             'label', 'the user''s own assumptions applied to measured rates on this corpus; not a quote and not Snowflake pricing',
             'modes', ARRAY_AGG(OBJECT_CONSTRUCT('mode', MODE, 'monthly_credits', MONTHLY_CREDITS::FLOAT,
               'pages_to_check_rate', CHECK_RATE::FLOAT, 'pages_to_check_per_month', CHECK_PAGES::FLOAT,
               'review_hours', IFF(:REVIEW_MINUTES_PER_PAGE IS NULL, NULL, REVIEW_HOURS)::FLOAT,
               'review_cost', IFF(:HOURLY_RATE IS NULL, NULL, REVIEW_HOURS * :HOURLY_RATE)::FLOAT,
               'credits_cost', IFF(:PRICE_PER_CREDIT IS NULL, NULL, MONTHLY_CREDITS * :PRICE_PER_CREDIT)::FLOAT,
               'total_cost', IFF(:HOURLY_RATE IS NULL OR :PRICE_PER_CREDIT IS NULL, NULL, REVIEW_HOURS * :HOURLY_RATE + MONTHLY_CREDITS * :PRICE_PER_CREDIT)::FLOAT,
               'hours_saved_by_agentic', IFF(:REVIEW_MINUTES_PER_PAGE IS NULL OR MODE = 'AGENTIC', NULL, REVIEW_HOURS - AGENTIC_HOURS)::FLOAT,
               'derivation', 'pages to check = ' || PAGES_TO_CHECK || ' of ' || CORPUS_PAGES || ' corpus pages x ' || :PAGES_PER_MONTH ||
                 ' pages per month = ' || TO_VARCHAR(CHECK_PAGES, 'FM999999999990.0') || ' pages to check per month' ||
                 IFF(:REVIEW_MINUTES_PER_PAGE IS NULL, '', '; x ' || :REVIEW_MINUTES_PER_PAGE || ' minutes / 60 = ' || TO_VARCHAR(REVIEW_HOURS, 'FM999999999990.0') || ' review hours') ||
                 IFF(:HOURLY_RATE IS NULL, '', '; x ' || :HOURLY_RATE || ' per hour = ' || TO_VARCHAR(REVIEW_HOURS * :HOURLY_RATE, 'FM999999999990.00') || ' review cost') ||
                 IFF(:PRICE_PER_CREDIT IS NULL, '', '; ' || TO_VARCHAR(MONTHLY_CREDITS, 'FM999999999990.00') || ' credits x ' || :PRICE_PER_CREDIT || ' per credit = ' || TO_VARCHAR(MONTHLY_CREDITS * :PRICE_PER_CREDIT, 'FM999999999990.00') || ' AI cost')
               )) WITHIN GROUP (ORDER BY CREDITS_PER_PAGE))
      FROM (SELECT MODE, CREDITS_PER_PAGE, CORPUS_PAGES, PAGES_TO_CHECK,
                   :PAGES_PER_MONTH * CREDITS_PER_PAGE AS MONTHLY_CREDITS,
                   PAGES_TO_CHECK::FLOAT / CORPUS_PAGES AS CHECK_RATE,
                   PAGES_TO_CHECK::FLOAT / CORPUS_PAGES * :PAGES_PER_MONTH AS CHECK_PAGES,
                   PAGES_TO_CHECK::FLOAT / CORPUS_PAGES * :PAGES_PER_MONTH * COALESCE(:REVIEW_MINUTES_PER_PAGE, 0) / 60 AS REVIEW_HOURS,
                   MAX(IFF(MODE = 'AGENTIC', PAGES_TO_CHECK::FLOAT / CORPUS_PAGES * :PAGES_PER_MONTH * COALESCE(:REVIEW_MINUTES_PER_PAGE, 0) / 60, NULL)) OVER () AS AGENTIC_HOURS
            FROM VALUE_BY_MODE));
  END IF;
  RETURN TO_JSON(OBJECT_CONSTRUCT('modes', :v_modes, 'control_docs', COALESCE(:v_control, ARRAY_CONSTRUCT()), 'hard_pages', :v_hard,
                                  'monthly', :v_month, 'review', :v_review,
                                  'basis', 'Credits per page are metered (PARSE_RUN_COST); facts and relations are scored against Ground Truth (MODE_COMPARISONS).'));
END;
$$;

-- Semantic view for aggregate questions (Cortex Analyst). Logical names follow the GLOSSARY.
CREATE OR REPLACE SEMANTIC VIEW PARSE_ANALYTICS
  TABLES (
    documents AS DOCUMENT_CATALOG PRIMARY KEY (DOC_ID)
      COMMENT = 'One row per Document in the demo corpus',
    runs AS PARSE_RUNS PRIMARY KEY (RUN_ID)
      COMMENT = 'Every Parse Run: one AI_PARSE_DOCUMENT call on one Document in one Mode',
    run_cost AS PARSE_RUN_COST PRIMARY KEY (RUN_ID)
      COMMENT = 'Metered AI credits per Parse Run; PENDING until usage lands',
    comparisons AS MODE_COMPARISONS PRIMARY KEY (DOC_ID, MODE)
      COMMENT = 'Ground Truth score of the latest Parse Run per Document and Mode',
    visual_points AS VISUAL_DATA_POINTS PRIMARY KEY (POINT_ID)
      COMMENT = 'Every labelled chart value read by AGENTIC (latest run), one row per value: chart title, series, label, value, unit'
  )
  RELATIONSHIPS (
    runs_doc AS runs (DOC_ID) REFERENCES documents,
    cost_run AS run_cost (RUN_ID) REFERENCES runs,
    comparisons_doc AS comparisons (DOC_ID) REFERENCES documents,
    visual_points_doc AS visual_points (DOC_ID) REFERENCES documents
  )
  FACTS (
    runs.page_count AS PAGE_COUNT COMMENT = 'Pages in the parsed Document',
    run_cost.pages_billed AS PAGES_BILLED COMMENT = 'Pages metered for the run',
    run_cost.credits AS CREDITS COMMENT = 'Metered AI credits for the run',
    comparisons.image_facts AS IMAGE_FACTS,
    comparisons.image_facts_found AS IMAGE_FACTS_FOUND,
    comparisons.text_facts AS TEXT_FACTS,
    comparisons.text_facts_found AS TEXT_FACTS_FOUND,
    comparisons.relations AS RELATIONS,
    comparisons.relations_found AS RELATIONS_FOUND,
    comparisons.visuals_expected AS VISUALS_EXPECTED,
    comparisons.visuals_detected AS VISUALS_DETECTED,
    visual_points.value AS VALUE COMMENT = 'Numeric value of a chart data point (e.g. 13.8 for Q3 revenue in USD millions)'
  )
  DIMENSIONS (
    documents.doc_id AS DOC_ID COMMENT = 'Document id, e.g. claim_packet',
    documents.source AS SOURCE COMMENT = 'corpus or upload',
    documents.file_type AS FILE_TYPE,
    documents.pages AS PAGES COMMENT = 'Page count of the Document',
    runs.run_id AS RUN_ID,
    runs.mode AS MODE COMMENT = 'Parse Mode: OCR, LAYOUT or AGENTIC',
    runs.trigger_source AS TRIGGER_SOURCE COMMENT = 'Who started the run, e.g. app',
    runs.error AS ERROR COMMENT = 'Error text; NULL when the run succeeded',
    runs.finished_at AS FINISHED_AT,
    run_cost.pending AS PENDING COMMENT = 'TRUE while metered usage has not landed',
    comparisons.mode AS MODE COMMENT = 'Parse Mode scored: OCR, LAYOUT or AGENTIC',
    visual_points.chart_title AS CHART_TITLE COMMENT = 'Title of the chart a value belongs to, e.g. Quarterly Revenue (USD millions)',
    visual_points.chart_type AS CHART_TYPE COMMENT = 'bar, line or pie',
    visual_points.label AS LABEL COMMENT = 'Category or period label of the data point, e.g. Q3 or Jan',
    visual_points.series AS SERIES COMMENT = 'Series name within the chart',
    visual_points.unit AS UNIT COMMENT = 'Unit of the value, e.g. USD millions; may be empty',
    visual_points.value_text AS VALUE_TEXT COMMENT = 'The value as AGENTIC read it, e.g. $29,305',
    visual_points.page_number AS PAGE_NUMBER COMMENT = '1-based page number of the chart',
    visual_points.visual_id AS VISUAL_ID COMMENT = 'Visual id on the page'
  )
  METRICS (
    documents.document_count AS COUNT(DOC_ID) COMMENT = 'Number of Documents',
    runs.run_count AS COUNT(RUN_ID) COMMENT = 'Number of Parse Runs',
    run_cost.total_credits AS SUM(CREDITS) COMMENT = 'Measured AI credits',
    run_cost.credits_per_1k_pages AS DIV0NULL(SUM(CREDITS), SUM(IFF(PENDING, NULL, PAGES_BILLED))) * 1000
      COMMENT = 'Measured AI credits per 1000 billed pages',
    comparisons.image_fact_recall AS DIV0NULL(SUM(IMAGE_FACTS_FOUND), SUM(IMAGE_FACTS))
      COMMENT = 'Share of Ground Truth image facts found',
    comparisons.text_fact_recall AS DIV0NULL(SUM(TEXT_FACTS_FOUND), SUM(TEXT_FACTS))
      COMMENT = 'Share of Ground Truth text facts found',
    comparisons.relation_recall AS DIV0NULL(SUM(RELATIONS_FOUND), SUM(RELATIONS))
      COMMENT = 'Share of Ground Truth relations found (e.g. signature belongs to signer)',
    comparisons.visual_recall AS DIV0NULL(SUM(VISUALS_DETECTED), SUM(VISUALS_EXPECTED))
      COMMENT = 'Share of expected Visuals detected',
    visual_points.chart_value_total AS SUM(VALUE) COMMENT = 'Sum of chart values (only meaningful within one chart)',
    visual_points.chart_value_count AS COUNT(POINT_ID) COMMENT = 'Number of chart data points'
  )
  COMMENT = 'Parse Runs, measured cost and Mode Comparison scores of the Agentic Parse Demo';
