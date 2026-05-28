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
                
        print(f"🔄 [data_exporter] 開始透過 Yahoo Finance API 更新 {len(all_symbols)} 支股票的今日收盤股價與量能...")
        
        now_tw = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
        today_date_str = now_tw.strftime("%Y-%m-%d")
        
        updated_count = 0
        for i, symbol in enumerate(all_symbols):
            try:
                quote = get_realtime_quote(symbol)
                if quote:
                    if symbol not in cache:
                        cache[symbol] = {
                            "symbol": symbol,
                            "name": next((st["name"] for cat in DEFAULT_CATEGORIES.values() for st in cat if st["symbol"] == symbol), symbol),
                            "financials": "暫無公司獲利分析",
                            "news": "暫無最新重要新聞",
                            "conferences": "暫無最新法說會要點",
                            "radar": {"technical": 5, "financial": 5, "institutional": 5, "news_sentiment": 5, "overall": 5.0},
                            "recommendation_rating": 5.0,
                            "target_price": "---",
                            "prediction_reason": "今日無特別預測資料"
                        }
                    
                    # 更新當日真實市場行情
                    cache[symbol]["price"] = quote["price"]
                    cache[symbol]["change"] = quote["change"]
                    cache[symbol]["change_percent"] = quote["change_percent"]
                    cache[symbol]["trend"] = quote["trend"]
                    cache[symbol]["volume"] = quote["volume"]
                    cache[symbol]["volume_raw"] = quote["volume_raw"]
                    cache[symbol]["transactions"] = quote["transactions"]
                    cache[symbol]["update_time"] = f"{today_date_str} 15:00 盤後分析"
                    
                    # 同步雷達圖技術分數
                    if "radar" in cache[symbol]:
                        tech_score = 10 if quote["trend"] == "bullish" else (4 if quote["trend"] == "bearish" else 6)
                        cache[symbol]["radar"]["technical"] = tech_score
                    
                    updated_count += 1
            except Exception as e:
                print(f"⚠️ 更新個股 {symbol} 失敗: {e}")
                
        print(f"✅ [data_exporter] 成功更新 {updated_count}/{len(all_symbols)} 支股票的真實今日股價！")
        
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
    
    # 5. 寫入元數據
    write_meta()
    
    print("\n" + "=" * 60)
    print("🎉 [data_exporter] 所有資料已成功輸出到 static/data/，準備部署至 Firebase！")
    print("=" * 60)


if __name__ == "__main__":
    main()
