"""
data_exporter.py
================
GitHub Actions 雲端執行腳本。
每天 15:07 台灣時間（UTC 07:07）由 GitHub Actions 呼叫。
- 週一~週五：執行盤後分析，將結果輸出到 static/data/ 供 Firebase 部署。
- 週五額外：執行每週驗收與 AI 自我進化優化。
"""

import os
import sys
import json
import shutil
import datetime

# 設定編碼
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# ==============================
# 路徑設定
# ==============================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR = os.path.join(STATIC_DIR, "data")

# 確保 data 目錄存在
os.makedirs(DATA_DIR, exist_ok=True)

# ==============================
# 來源 JSON 路徑
# ==============================
STOCK_CACHE_SRC = os.path.join(BASE_DIR, "stock_cache.json")
OPT_WEIGHTS_SRC = os.path.join(BASE_DIR, "optimization_weights.json")
VERIFY_HISTORY_SRC = os.path.join(BASE_DIR, "verification_history.json")
RECO_LOG_SRC = os.path.join(BASE_DIR, "recommendations_log.json")

# ==============================
# 目標 JSON 路徑（供前端讀取）
# ==============================
STOCK_CACHE_DEST = os.path.join(DATA_DIR, "stock_cache.json")
CATEGORIES_DEST = os.path.join(DATA_DIR, "categories.json")
OPT_WEIGHTS_DEST = os.path.join(DATA_DIR, "optimization_weights.json")
VERIFY_HISTORY_DEST = os.path.join(DATA_DIR, "verification_history.json")
META_DEST = os.path.join(DATA_DIR, "meta.json")
MARKET_TRENDS_DEST = os.path.join(DATA_DIR, "market_trends.json")


def run_analysis():
    """執行所有股票的盤後分析（GitHub Actions 環境中以快取模式執行）"""
    print("📊 [data_exporter] 開始執行盤後資料分析...")
    
    try:
        from stock_agent import (
            DEFAULT_CATEGORIES,
            load_cached_data,
            save_cached_data,
            get_realtime_quote,
        )
        
        cache = load_cached_data()
        print(f"✅ [data_exporter] 已載入 {len(cache)} 支股票的快取資料。")
        
        # 提取所有分類中出現的股票 symbol 集合
        all_symbols = set()
        for cat_key, stocks in DEFAULT_CATEGORIES.items():
            for st in stocks:
                all_symbols.add(st["symbol"])
                
        print(f"🔄 [data_exporter] 開始並行採集與量化分析 {len(all_symbols)} 支股票的即時數據與新聞...")
        
        from concurrent.futures import ThreadPoolExecutor
        from stock_agent import analyze_stock_symbol_sync, load_env_file
        
        # 確保環境變數已載入
        load_env_file()
        
        updated_count = 0
        def task_wrapper(symbol):
            try:
                # 傳入 cache 字典在內存中併入更新，避免併發寫入硬碟
                return analyze_stock_symbol_sync(symbol, cache_data=cache)
            except Exception as e:
                print(f"⚠️ [data_exporter] 並行分析個股 {symbol} 失敗: {e}")
                return None
                
        with ThreadPoolExecutor(max_workers=20) as executor:
            results = list(executor.map(task_wrapper, list(all_symbols)))
            
        updated_count = len([r for r in results if r is not None])
        print(f"✅ [data_exporter] 成功並行分析與更新 {updated_count}/{len(all_symbols)} 支股票的完整資料！")
        
        # 儲存更新後的快取
        save_cached_data(cache)
        print("💾 [data_exporter] 最新當日行情已寫入本地快取資料庫。")
        
        return DEFAULT_CATEGORIES, cache
        
    except Exception as e:
        print(f"❌ [data_exporter] 分析執行錯誤: {e}")
        # 嘗試直接讀取快取檔案
        if os.path.exists(STOCK_CACHE_SRC):
            with open(STOCK_CACHE_SRC, "r", encoding="utf-8") as f:
                cache = json.load(f)
            print(f"📦 [data_exporter] 已回退使用本地快取 ({len(cache)} 支股票)。")
            return None, cache
        return None, {}


def run_weekly_evaluation():
    """執行週五的每週驗收與 AI 自我進化（僅在週五呼叫）"""
    print("🔄 [data_exporter] 執行每週驗收與 AI 自我進化...")
    try:
        from weekly_evaluator import run_weekly_verification_and_optimize
        result = run_weekly_verification_and_optimize()
        print(f"✅ [data_exporter] 週驗收完成！命中率: {result.get('hit_rate', 'N/A')}%")
        return result
    except Exception as e:
        print(f"❌ [data_exporter] 週驗收執行錯誤: {e}")
        return None


def export_categories(categories):
    """將股票分類資料輸出到 static/data/categories.json"""
    try:
        if categories is None:
            from stock_agent import DEFAULT_CATEGORIES
            categories = DEFAULT_CATEGORIES
        
        with open(CATEGORIES_DEST, "w", encoding="utf-8") as f:
            json.dump(categories, f, ensure_ascii=False, indent=2)
        print(f"✅ [data_exporter] 已輸出 categories.json ({len(categories)} 個板塊)")
    except Exception as e:
        print(f"❌ [data_exporter] 輸出 categories.json 失敗: {e}")


def copy_json_files():
    """將所有 JSON 資料檔案複製到 static/data/ 目錄"""
    files_to_copy = [
        (STOCK_CACHE_SRC, STOCK_CACHE_DEST, "stock_cache.json"),
        (OPT_WEIGHTS_SRC, OPT_WEIGHTS_DEST, "optimization_weights.json"),
        (VERIFY_HISTORY_SRC, VERIFY_HISTORY_DEST, "verification_history.json"),
    ]
    
    for src, dest, name in files_to_copy:
        if os.path.exists(src):
            shutil.copy2(src, dest)
            print(f"✅ [data_exporter] 已複製 {name}")
        else:
            print(f"⚠️  [data_exporter] 找不到 {name}，跳過。")
            # 建立空的預設檔案
            if "verification_history" in name:
                with open(dest, "w", encoding="utf-8") as f:
                    json.dump([], f)
            elif "optimization_weights" in name:
                default_weights = {
                    "technical": 0.30,
                    "financial": 0.25,
                    "institutional": 0.20,
                    "news_sentiment": 0.15,
                    "volume_momentum": 0.10
                }
                with open(dest, "w", encoding="utf-8") as f:
                    json.dump(default_weights, f, ensure_ascii=False, indent=2)


def get_market_trends():
    """抓取全球與台股四大核心指數（大盤, 美元兌台幣, 黃金, 石油）近一個月的每日收盤價"""
    print("📊 [data_exporter] 開始抓取全球與台股核心指數近 1 個月走勢數據...")
    import requests
    import time
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    symbols_map = {
        "taiex": "^TWII",
        "usdtwd": "USDTWD=X",
        "gold": "GC=F",
        "oil": "CL=F"
    }
    
    trends_data = {}
    
    for key, symbol in symbols_map.items():
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1mo&interval=1d"
            r = requests.get(url, headers=headers, timeout=5)
            if r.status_code == 200:
                res = r.json()['chart']['result']
                if res and 'meta' in res[0]:
                    meta = res[0]['meta']
                    timestamp = res[0].get('timestamp', [])
                    indicators = res[0].get('indicators', {}).get('quote', [{}])[0]
                    close = indicators.get('close', [])
                    
                    # 過濾 None 值與對齊日期
                    valid_history = []
                    valid_labels = []
                    
                    # 決定小數點精度 (匯率 4 位，其他 2 位)
                    precision = 4 if key == "usdtwd" else 2
                    
                    for t, c in zip(timestamp, close):
                        if c is not None:
                            # 轉成台灣時間日期簡寫 MM-DD
                            dt = datetime.datetime.fromtimestamp(t) + datetime.timedelta(hours=8)
                            valid_labels.append(dt.strftime("%m-%d"))
                            valid_history.append(round(c, precision))
                    
                    if valid_history:
                        price = valid_history[-1]
                        prev_price = valid_history[-2] if len(valid_history) >= 2 else price
                        change = price - prev_price
                        change_percent = (change / prev_price) * 100 if prev_price != 0 else 0
                        
                        # 中文名稱映射
                        names = {
                            "taiex": "大盤加權指數",
                            "usdtwd": "美元兌台幣",
                            "gold": "黃金期貨",
                            "oil": "輕原油期貨"
                        }
                        
                        trends_data[key] = {
                            "name": names.get(key, key),
                            "symbol": symbol,
                            "price": round(price, precision),
                            "change": round(change, precision),
                            "change_percent": round(change_percent, 2), # 百分比仍維持 2 位
                            "history": valid_history,
                            "labels": valid_labels
                        }
                        price_str = f"{price:.4f}" if key == "usdtwd" else f"{price:.2f}"
                        print(f"✅ [data_exporter] 成功抓取 {key} ({symbol}): {price_str}")
                    else:
                        print(f"⚠️  [data_exporter] {key} 無有效歷史數據。")
            else:
                print(f"❌ [data_exporter] 抓取 {key} 失敗，HTTP {r.status_code}")
        except Exception as e:
            print(f"❌ [data_exporter] 抓取 {key} 拋出異常: {e}")
            
    return trends_data


def write_meta():
    """寫入 meta.json，包含最後更新時間等元數據（供前端顯示）"""
    now_utc = datetime.datetime.utcnow()
    # 轉換為台灣時間（UTC+8）
    now_tw = now_utc + datetime.timedelta(hours=8)
    
    meta = {
        "last_updated": now_tw.strftime("%Y-%m-%d %H:%M"),
        "last_updated_utc": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "update_date": now_tw.strftime("%Y-%m-%d"),
        "data_source": "GitHub Actions 自動排程",
        "next_update": "下一個工作日 15:07"
    }
    
    with open(META_DEST, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"✅ [data_exporter] 已寫入 meta.json (更新時間: {now_tw.strftime('%Y-%m-%d %H:%M')} 台灣時間)")


def export_obsidian_report(categories, cache, trends):
    """
    將今日所有資料導出為 Obsidian 專屬 Markdown 日誌筆記。
    支援從環境變數或 .env 檔案讀取 OBSIDIAN_VAULT_PATH。
    """
    print("\n📝 [data_exporter] 開始導出 Obsidian 每日分析筆記...")
    
    # 1. 取得日期與時間資訊 (台灣時間)
    now_tw = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    today_str = now_tw.strftime("%Y-%m-%d")
    time_str = now_tw.strftime("%Y-%m-%d %H:%M")
    
    # 2. 構建 YAML Frontmatter 屬性
    frontmatter = [
        "---",
        f"date: {today_str}",
        "type: stock-analysis",
        "tags: [stock, ai-analysis, daily-report]",
    ]
    
    # 3. 提取市場指數數據填入屬性
    if trends:
        for key in ["taiex", "usdtwd", "gold", "oil"]:
            if key in trends:
                p = trends[key]["price"]
                c = trends[key]["change"]
                cp = trends[key]["change_percent"]
                sign = "+" if c >= 0 else ""
                frontmatter.append(f"{key}_price: {p}")
                frontmatter.append(f'{key}_change: "{sign}{c} ({sign}{cp}%)"')
    frontmatter.append("---")
    
    # 4. 構建筆記主體內容
    content = []
    content.extend(frontmatter)
    content.append("")
    content.append(f"# 📈 AI 盤後股票智能分析報告 - {today_str}")
    content.append(f"> [!NOTE]")
    content.append(f"> 本報告由 AI 盤後股票智能分析儀表板於 `{time_str}` 自動生成。")
    content.append("")
    
    # 5. 指數表格
    content.append("## 🌐 核心大盤與商品數據")
    content.append("")
    content.append("| 指標名稱 | 代號 | 最新價格 | 單日漲跌 | 漲跌幅 |")
    content.append("| :--- | :--- | :--- | :--- | :--- |")
    
    if trends:
        for key in ["taiex", "usdtwd", "gold", "oil"]:
            if key in trends:
                t = trends[key]
                p = t["price"]
                c = t["change"]
                cp = t["change_percent"]
                sign = "+" if c >= 0 else ""
                content.append(f"| **{t['name']}** | `{t['symbol']}` | {p} | {sign}{c} | {sign}{cp}% |")
    else:
        content.append("| 暫無數據 | - | - | - | - |")
    content.append("")
    content.append("---")
    content.append("")
    
    # 6. 明日之星 (Top 3)
    content.append("## 🌟 明日/本週潛力飆股 (Top 3)")
    content.append("")
    
    # 根據 AI 推薦指數排序，找出前 3 名
    stars = []
    for symbol, st in cache.items():
        rating = st.get("recommendation_rating", 0)
        stars.append((symbol, rating, st))
    # 降序排序
    stars.sort(key=lambda x: x[1], reverse=True)
    top_3 = stars[:3]
    
    medals = ["🥇 NO.1", "🥈 NO.2", "🥉 NO.3"]
    for i, (symbol, rating, st) in enumerate(top_3):
        if i < len(medals):
            medal = medals[i]
            price = st.get("price", "---")
            change = st.get("change", "0.00")
            pct = st.get("change_percent", "0.00%")
            volume = st.get("volume", "---")
            trans = st.get("transactions", "---")
            target = st.get("target_price", "---")
            reason = st.get("prediction_reason", "暫無分析")
            
            # 判斷技術走勢，做足容錯
            is_bullish = True
            if "看跌" in reason:
                is_bullish = False
            elif "看漲" in reason:
                is_bullish = True
            else:
                try:
                    change_val = float(change.replace("%", "").replace("+", ""))
                    is_bullish = change_val >= 0
                except Exception:
                    is_bullish = True
            trend_icon = "看漲 📈" if is_bullish else "看跌 📉"
            
            content.append(f"### {medal} - {st.get('name', symbol)} ({symbol})")
            content.append(f"- **最新收盤價**：{price} 元 (`{change} / {pct}`)")
            content.append(f"- **AI 推薦指數**：`{rating} / 10`")
            content.append(f"- **技術走勢**：{trend_icon} (成交量: {volume}, 交易筆數: {trans})")
            content.append(f"- **目標預估區間**：`{target}`")
            content.append(f"- **AI 預測研判**：{reason}")
            content.append("")
            
    content.append("---")
    content.append("")
    
    # 7. 7 大分類個股清單 (折疊式 Callout)
    content.append("## 📂 板塊個股清單與深度分析")
    content.append("")
    content.append("> [!TIP]")
    content.append("> 點擊個股右側的展開按鈕即可閱讀由 browser-use 深度採集的基本面、最新新聞、法說會紀要與趨勢研判！")
    content.append("")
    
    if categories is None:
        from stock_agent import DEFAULT_CATEGORIES
        categories = DEFAULT_CATEGORIES
        
    for cat_name, stocks in categories.items():
        content.append(f"### 📦 {cat_name}")
        content.append("")
        
        for st_meta in stocks:
            sym = st_meta["symbol"]
            name = st_meta["name"]
            
            st = cache.get(sym, {})
            price = st.get("price", "---")
            change = st.get("change", "0.00")
            pct = st.get("change_percent", "0.00%")
            volume = st.get("volume", "---")
            rating = st.get("recommendation_rating", 5.0)
            trend_str = "看漲 📈" if "bullish" in st.get("trend", "neutral") else ("看跌 📉" if "bearish" in st.get("trend", "neutral") else "盤整 ➡️")
            target = st.get("target_price", "---")
            reason = st.get("prediction_reason", "無")
            financials = st.get("financials", "暫無獲利數據")
            news = st.get("news", "暫無新聞分析")
            conf = st.get("conferences", "暫無最新法說會紀要")
            
            # Obsidian Callout
            content.append(f"> [!INFO]- {sym} {name} (AI 推薦分數: {rating}/10)")
            content.append(f"> - **行情走勢**：**{price}** 元 ({change} / {pct}, {trend_str}) | 成交量: {volume}")
            content.append(f"> - **目標預估**：`{target}`")
            content.append(f"> - **預測研判**：{reason}")
            content.append(f"> - **公司營利**：{financials}")
            content.append(f"> - **最新新聞**：")
            # 新聞有分行，需要加上 Obsidian callout 的引導符號
            for line in news.split("\n"):
                if line.strip():
                    content.append(f">   {line}")
            content.append(f"> - **法說要點**：{conf}")
            content.append("")
            
    # 8. 寫入檔案
    md_content = "\n".join(content)
    file_name = f"{today_str}_盤後股票AI分析.md"
    
    # 預設儲存於專案內 obsidian/ 目錄
    local_obsidian_dir = os.path.join(BASE_DIR, "obsidian")
    os.makedirs(local_obsidian_dir, exist_ok=True)
    local_path = os.path.join(local_obsidian_dir, file_name)
    
    try:
        with open(local_path, "w", encoding="utf-8") as f:
            f.write(md_content)
        print(f"✅ [data_exporter] 專案本地 Obsidian 筆記已生成: obsidian/{file_name}")
    except Exception as e:
        print(f"❌ [data_exporter] 寫入本地 Obsidian 筆記失敗: {e}")
        
    # 支援 OBSIDIAN_VAULT_PATH 環境變數雙重寫入
    # 嘗試讀取 .env 檔案 (如果有的話)
    dotenv_vault = None
    env_path = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("OBSIDIAN_VAULT_PATH="):
                        dotenv_vault = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception as e:
            print(f"⚠️  [data_exporter] 讀取 .env 失敗: {e}")
            
    vault_path = os.environ.get("OBSIDIAN_VAULT_PATH") or dotenv_vault
    if vault_path:
        if os.path.exists(vault_path):
            try:
                dest_path = os.path.join(vault_path, file_name)
                with open(dest_path, "w", encoding="utf-8") as f:
                    f.write(md_content)
                print(f"🔥 [data_exporter] 已同步寫入您的 Obsidian 筆記庫: {dest_path}")
            except Exception as e:
                print(f"❌ [data_exporter] 同步寫入 Obsidian 筆記庫失敗: {e}")
        else:
            print(f"⚠️  [data_exporter] 設定的 Obsidian 筆記庫路徑不存在: {vault_path}")


def main():
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=8)  # 台灣時間
    weekday = now.weekday()  # 0=周一, 4=週五
    is_friday = (weekday == 4)
    
    print("=" * 60)
    print(f"🚀 [data_exporter] 開始執行 | 台灣時間: {now.strftime('%Y-%m-%d %H:%M')} {'(週五)' if is_friday else ''}")
    print("=" * 60)
    
    # 1. 執行盤後分析
    categories, cache = run_analysis()
    
    # 2. 若是週五，額外執行週驗收
    if is_friday:
        print("\n📅 [data_exporter] 今天是週五，啟動每週驗收...")
        run_weekly_evaluation()
    
    # 3. 輸出分類資料
    export_categories(categories)
    
    # 4. 複製所有 JSON 到 static/data/
    copy_json_files()
    
    # 4.5 抓取並輸出市場指數趨勢
    trends = None
    try:
        trends = get_market_trends()
        if trends:
            with open(MARKET_TRENDS_DEST, "w", encoding="utf-8") as f:
                json.dump(trends, f, ensure_ascii=False, indent=2)
            print("✅ [data_exporter] 已輸出 market_trends.json")
    except Exception as e:
        print(f"❌ [data_exporter] 輸出 market_trends.json 錯誤: {e}")
    
    # 5. 寫入元數據
    write_meta()
    
    # 6. 導出為 Obsidian 筆記
    try:
        export_obsidian_report(categories, cache, trends)
    except Exception as e:
        print(f"❌ [data_exporter] 導出 Obsidian 筆記錯誤: {e}")
    
    print("\n" + "=" * 60)
    print("🎉 [data_exporter] 所有資料已成功輸出到 static/data/，準備部署至 Firebase！")
    print("=" * 60)



if __name__ == "__main__":
    main()
