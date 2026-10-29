#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 23 (main agent) - Quant pipeline UI + rate-limit fix
- Backend: market.py rate limiter + Mongo candle_cache + stale fallbacks; quant.backtest_same returns equity {hold, managed}; extras.risk_adjusted returns equity; track-record live.calibration.progress; track_loop retries backtest until 90% universe coverage.
- Frontend: quality.tsx rewritten, new quantcharts.tsx, analyze.tsx (PipelineStrip, calibrated POP hero, money formatting), track-record.tsx (CalibrationChart, EquityCurve, CalibrationProgress).
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 24 (main agent) - Email verification at sign-up
- Backend: signup.py (register -> pending + emailed code, verify, resend), emailer.py (Emergent managed email). server.py login returns 403 for pending sign-ups.
- Frontend: app/(auth)/verify-email.tsx new; register.tsx + login.tsx + src/auth.tsx updated.
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 25 (main agent) - Forgot password + Change email
- Backend: otp.py (shared), signup.py refactored, account.py (password-reset request/confirm, email-change request/resend/confirm), get_user_from_token requires a live session row.
- Frontend: (auth)/forgot-password.tsx, change-email.tsx, src/CodeInput.tsx, src/authStyles.ts, login Forgot password link, Profile Change email row.
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 26 (main agent) - Ask AI (Claude Sonnet 5.5 + Opus 5.5 chat)
- Backend: assistant.py + server.ai_ticker_context/ai_user_context; billing FEATURES ai_chat_per_day/ai_deep_per_day.
- Frontend: app/assistant.tsx, src/assistant.ts, src/ChatParts.tsx, src/Markdown.tsx; entry buttons on Discover/Analyze/Portfolio; plans.tsx features.
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 27 (main agent) - S&P 500 valuation board + intrinsic-value buy levels + price-alert checker
- Backend: valuation_board.py (new): data/sp500.json (503 tickers, GICS sector); GET /api/valuation/board (auth); background loops fundamentals_loop (daily, Finnhub-paced ~5 stocks/min, Mongo `valuation_board`), price_loop (Tradier batch quotes every 10 min), price_alert_loop (price_above/price_below alerts checked every 2 min in market hours -> alert deactivated with triggered_at/triggered_price, alert_events feed row, push). buy_levels(): 2y swing-low clusters (>=2 bounces) below min(price, intrinsic), filled with 10% steps.
- server.py stock-analysis purpose=long now returns intrinsic_line {value, source}, buy_levels [B1..B4], price_history [[t, close]] (~2y); fill_balance_gaps + optiiq_sector shared with the board so values match.
- tradier.quotes() batch helper; market.recent_calls().
- Frontend: src/ValuationBoard.tsx (5 colored group tabs w/ counts, search, sector chips, 4-col chip grid, progress bar while building), src/BuyLevelsChart.tsx (SVG price line + intrinsic line + 4 buy levels, 6M/1Y/2Y, "Buy alert" -> POST /api/alerts/add price_below note "Buy level Bx"), analyze.tsx Long-term shows the board under the form; tapping a chip runs the long analysis. alerts.tsx shows triggered state + price events.
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 28 (main agent) - Dark theme + Appearance picker
- theme.ts: light + dark palettes (+ new tokens warnBg/onWarnBg/errorBg/gainBg/lossBg/backdrop); preference store System/Light/Dark saved in AsyncStorage ("theme_preference"); `colors` is a Proxy resolving to the active theme; `themedStyles(factory)` replaces StyleSheet.create in 45 files; every component calls useTheme() to re-render on switch; root layout loads the saved pref, wraps ThemeProvider + StatusBar.
- profile.tsx: "Appearance" section with segmented control testIDs theme-picker-system / theme-picker-light / theme-picker-dark.
- engine.optiiq_value sanity guard: EPS > price or value > 10x price -> available false ("Company data looks inconsistent") (fixes BRK.B $923,950 and SKYD outliers on the valuation board / Analyze).
- needs_retesting: true (frontend)

## Iteration 29 (main agent) - OptiIQ Value v4 (sheet-style FCF DCF with WACC) + confluence buy levels
- Backend engine.optiiq_value(price, metrics, financials, sector, ticker): 10y FCF DCF (years 1-5 growth = median of revenue TTM/3y/5y + EPS 3y/5y capped 0-25%, years 6-10 half, terminal 3-5% by growth), WACC = CAPM (rf 4.5%, Blume beta 0.8-1.5, MRP 6%) + after-tax cost of debt weighted by market cap/debt, mid-year discounting, + cash & short-term investments - debt, / shares. FCF below steady earnings converges to them by year 5. Payment/exchange/broker-type financials (V, MA, SPGI...) now use the DCF; banks/insurers use the book-value model. Returns details: years[], discount{}, growth{}, pv_cash_flows, pv_terminal, value_of_operations, cash, debt, equity_value, shares, beta_check[0.75/1.0/1.25].
- market.py: cash_and_investments, LongTermDebtAndCapitalLeaseObligationsCurrent, metrics revenue_growth_3y/eps_growth_3y/pfcf_ttm/pcf_ttm. Cash/debt taken from the latest filing that reports them.
- valuation_board.buy_plan(candles, price, intrinsic): returns {levels, overlay{sma50, sma200, fib, reversals}, summary}. Levels = zones where reversal points, 50/100/200-day averages (+ times held), Fibonacci retracements of the 2y swing, 52-week low and OptiIQ Value agree; strength Strong/Moderate/Light, reasons[]. stock-analysis long returns buy_levels, buy_overlay, buy_summary.
- Frontend: src/OptiIQCard.tsx (new; "See the calculation" toggle -> FCF forecast table, value bridge, WACC, growth, beta check), src/BuyLevelsChart.tsx (summary, layer toggles avg/fib/rev, MA lines, fib lines, reversal dots, strength badge + reasons per level).
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)
- Iteration 29b fixes: long-term AI thesis prompt now uses OptiIQ value + buy levels (server.optiiq_brief); intrinsic_value field = OptiIQ value (None when unavailable/low confidence, no fallback to the old EPS DCF). Cash flows are now cash flow to the firm (FCF + after-tax interest on debt); TTM FCF from Finnhub pfcfShareTTM (standardized, catches oil & gas capex) with filings fallback; years 1-5 growth capped at revenue-growth median + 5pts; utilities use the book-value model; values >3x or <1/4 of price get confidence="low" (warning on card, excluded from board buckets -> unrated with reason). When Finnhub is rate-limited, stock-analysis uses the board's stored metrics/financials. cf_note tolerance (10%), year labels always set, stage2_floored / capped_by_revenue / wacc_floored hints, httpx logger WARNING (no API keys in logs). UI: strength badge no wrap, Intrinsic label moves below when it collides with a level, Buy alert buttons 44px.

## Iteration 31 (main agent) - OptiIQ old display restored + Free plan (7-day trial = Advance, then read-only)
- User: "don't remove the old valuation screens; only change the OptiIQ calculation (analyst DCF sheet) and display the OptiIQ value the same way as before".
  -> analyze.tsx + financials.tsx reverted to the previous UI: OptiIQCard (src/financials.tsx: "OptiIQ Value", $value, "+x% vs price" tag), BuyLevelsChart (multi-signal version kept), "Intrinsic value · scenarios" editor (bull/base/bear, buy/sell zone, Edit assumptions, Recalculate), Fundamentals ValuationMeasures with buy/sell. src/OptiIQCard.tsx deleted. Backend OptiIQ v4 unchanged.
- Plans: billing.FEATURES["trial"] = Advance features (unlimited scans, spreads, 20 alerts, smart alerts, AI explain, backtest, Ask AI 30/5). Frontend plans.tsx same + FREE_CARD (onboarding plan screen, upgrade screen Free card with CURRENT/ENDED tag, Profile plan card).
- Expired (7 days after sign-up, no paid plan): Discover/Analyze/Chain/ticker detail show PlanGate paywall (ticker page has Go back). Portfolio + Alerts are no longer paywalled: TrialEndedBanner, saved strategies/watchlist/alerts visible, add-ticker card + Ask AI review + strategies-empty hidden, alerts "+" opens /upgrade, "Check now" hidden, usage text "N saved alerts".
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 32 (main agent) - Expo SDK 57 -> 58 upgrade
- `yarn expo install expo@^58.0.0` + `yarn expo install --fix` + `yarn expo install expo-asset` (missing peer of expo-audio; app.json plugins gained "expo-asset"). expo-doctor 20/20.
- Now: expo 58.0.19, react-native 0.88.0, react 19.3.0, expo-router 58.0.26, react-native-gesture-handler ~3.3.0, reanimated 4.7.1, worklets 0.13.0, screens ~4.30, safe-area-context ~5.10.1, webview 14.0.1, keyboard-controller 1.22.7, expo-notifications ~58.1.6.
- RN strict TS API fixes: src/theme.ts local NamedStyles type (StyleSheet.NamedStyles removed), analyze.tsx useRef<ScrollViewInstance>, CodeInput.tsx useRef<TextInputInstance>, chain.tsx RefreshControl onRefresh returns void. tsc + eslint clean.
- Router checklist: all tabs declared in (tabs)/_layout, no initialRouteName/screen-params navigation, web.output "single" explicit, +html.tsx has no navigation hooks, SafeAreaProvider in root layout. Metro cache cleared.
- needs_retesting: true (frontend regression across all screens)

## Iteration 33 (main agent) - Backend switched to shared MongoDB Atlas
- server.py uses SHARED_MONGO_URL (+ SHARED_MONGO_USER/PASSWORD via backend/atlas.py) and SHARED_DB_NAME=optionscope-optiscreen_db. All local data copied; admin record replaces the web Google record. Login verified via curl + UI. Test users now land in the shared Atlas db (also seen by the web app) - clean them up after tests.

## Iteration 34 (main agent) - Ask AI cut-off answers
- Verified by curl: quick long answer completes (done event). Deep stream cut at exactly 60s by the proxy; server kept generating, GET /api/assistant/messages/{id} returned status done 10,374 chars. UI (web): deep question -> full 9,289-char answer, no error.

## Iteration 35 (main agent) - OptiIQ Value v5 (revenue-driven DCF per user's template)
- See PRD "OptiIQ Value v5". Verified: MU long-term analysis -> optiiq value 1695.91 (+72.5%), card unchanged; PLTR -> low confidence (no intrinsic line); board refreshing docs to model_v 5.
- Old tests test_iter29/30 assert v4 fields (growth.stage1/stage2/long_term, mid-year discount) - obsolete now.
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 36 (main agent) - OptiIQ input fixes + One-tap trade plan + Weekly calibration report + Discover sort/filter + OptiScore breakdown
- OptiIQ (engine.optiiq_value): Year-1 growth = avg(consensus coming quarters vs same quarters a year ago, latest reported quarter vs a year ago) -- seasonal run-rate removed. Capex now eases toward the company's own median capex/revenue over up to 10 fiscal years of 10-K filings (market.get_capex_history, filled from the annual call get_quarterly_financials already makes; company-specific tags e.g. nvda_PurchasesOfPropertyAndEquipment...). <3 years -> old 1.1x D&A rule. reinvestment.capex_rule / capex_history in output. valuation_board MODEL_V=7 (board refreshes over a few hours; docs store capex_history). Unit tests tests/test_iter32_optiiq_dcf_unit.py updated (18 pass).
- One-tap trade plan: POST /api/strategies accepts time_exit (YYYY-MM-DD), invalidation {below, above}, source "trade_plan"; check_hits fires strategy_time / strategy_invalid events (+ push) besides target/stop. New POST /api/alerts/plan {ticker, direction long|short, target, stop, label} -> two linked price alerts (group_id); server-side alert-limit check (403); when one fires the sibling is closed (closed_by). Frontend src/TrackPlan.tsx: TrackPlanButton (Analyze > Options Lab under Trade plan, testID track-plan-btn) and StockPlanAlerts (Day/Swing trade plan, testID stock-plan-alerts-btn).
- Weekly calibration report: GET /api/track-record live.weekly {weeks[{week_of, week_end, n, wins, realized, calibrated_pop, model_pop, calibrated_n, gap, gap_model, brier, pnl}], summary, settling_next_7d, note}; picks now store pop_calibrated. Frontend src/WeeklyReport.tsx in Track record > Live picks (testID weekly-report).
- OptiScore breakdown: engine.score_drivers -> idea.drivers {pillar: [{label, pts, note}]} (50 + sum(pts) = pillar score), idea.score_weights. Frontend src/ScoreBreakdown.tsx: tap a pillar in the OptiScore card (testID pillar-<k>-toggle) to see drivers.
- Discover sort/filter: src/ResultSort.tsx toolbar above results (sort-optiscore/history/cost/pop, min-score-0/50/65/80, filter-low-cost, filter-clear), saved in AsyncStorage; cost badge on cards.
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 37 (main agent) - OptiIQ v8: average of 9 valuation methods
- backend/optiiq.py optiiq_value(): DCF-20 (OCF), DFCF-20 (FCF), DNI-20 (net income), DFCF-Terminal (10y FCF + 2.5% terminal), Mean PS / Mean PE / Mean PB (company's own 10-year averages from Finnhub annual series, market.get_metrics pe/ps/pb_mean_10y + mean_years), PSG, PEG. Discount rate from beta table 5-9%. Growth yrs 1-5 projected (avg of inputs, -10..30%), 6-10 half (>=4% unless lower), 11-20 4%. Value = average of available methods; zero/negative values count. Returns methods[{key,label,short,value,vs_price_pct,note}], count, inputs. avg<=0 / >10x price -> available false; >3x or <1/4 -> confidence low.
- valuation_board MODEL_V=8; GET /api/valuation/board/{ticker} -> {ticker,name,sector,price,price_ts,optiiq} from stored data (404 if not on model 8 yet). scripts/board_migrate_v8.py refreshed metrics of all docs to model 8.
- Frontend: src/OptiIQChart.tsx (Analyze > Long-term, testIDs optiiq-card / optiiq-unavailable, optiiq-value, optiiq-upside, optiiq-chart, optiiq-method-<key>, optiiq-method-<key>-value, optiiq-method-<key>-note on tap). Dashed price/value lines now drawn only across each bar (no longer over labels). src/BoardStockSheet.tsx: tap a stock chip on the S&P 500 board (vb-stock-<T>) -> sheet vb-sheet with the same chart, vb-sheet-close, vb-sheet-analyze runs the full long-term analysis.
- Unit tests tests/test_optiiq_nine_unit.py (17 pass).
- needs_retesting: false (iteration_35 + test_iter38 13/13 after board recompute fix)

## Iteration 39 (main agent) - OptiIQ fast + never blank (user: "PLTR is empty ... taking too long to load")
- Root cause PLTR blank: Finnhub rate limit (the published app runs OLD code on the same DB + same Finnhub key -> 429s) and the saved-copy fallback rejected docs the old app rewrote.
- NEW GET /api/valuation/optiiq/{ticker} -> {ticker,name,sector,price,optiiq}: S&P 500 board names (is_current) -> board stored inputs + 1 quote call; non-board tickers -> saved optiiq_inputs (<12h) else live metrics+filings+estimates+profile in parallel; fallbacks: saved filings, then metrics-only; 404 for unknown ticker (ZZZZ). Replaces GET /api/valuation/board/{ticker} (removed); BoardStockSheet uses the new endpoint.
- server.optiiq_for(): single OptiIQ source shared by the quick endpoint and POST /screener/stock-analysis (long) -> quick card and full analysis show the same value.
- stock-analysis long: bundle + filings + 2y candles now fetched in parallel.
- market._get: identical in-flight requests share one call; endpoints answering 403 (price-target, news-sentiment not in plan) are skipped afterwards.
- valuation_board: Mongo lease (locks.board_refresh) so only one server (preview or published) runs the daily company-data refresh.
- Frontend analyze.tsx Long-term: OptiIQ card appears first (testID optiiq-quick, ~0.5s) with "Loading buy levels, financials and the AI thesis…" while the full analysis loads (~7-9s), then the full result replaces it.
- needs_retesting: false (iteration_37: regression 62/62; follow-ups fixed: currency-gated conversion, long-term page figures converted; test_iter39/40 34/34)

## Iteration 40 (main agent) - fixes from iteration_36 report + SKHY
- Board now uses its OWN collection `optiiq_board` (the published old app keeps writing legacy `valuation_board`); 376 current docs copied, the rest refreshed by our loop (lease locks.board_refresh). Board list + /api/valuation/optiiq read optiiq_board.
- optiiq_for last-resort fallback: any saved/board doc with financials + market cap (fewer methods instead of "unavailable").
- analyze.tsx run(): stale full results / loading flag / errors from an older run are ignored (lastRun ref check).
- market.get_profile: failed (rate-limited) profile answers are not cached; _report_items ignores non-dict items (ECHO crash); log once a minute when the in-process Finnhub budget is exhausted.
- NEW optiiq.listing_scale: foreign US listings whose provider figures are in another currency / per home-market share (SKHY = SK hynix in KRW, TSM in TWD) are converted to the listing price via the price their own figures imply (P/E x EPS, else P/S x sales/share, else P/B x book); gaps < 2x left alone; filings skipped for converted listings. inputs.listing_scale returned; UI note testID optiiq-listing-note.
- SKHY: before "Company data looks inconsistent"; now ~$628 from 9 methods (low confidence, >3x price). TSM k≈0.18.
- needs_retesting: false (iteration_37: regression 62/62; follow-ups fixed: currency-gated conversion, long-term page figures converted; test_iter39/40 34/34)
