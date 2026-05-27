import os
import sys

# Windows 終端機編碼相容處理，防止 cp950 輸出 emoji 時出錯
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# 引入核心 Agent 模組
from stock_agent import (
    DEFAULT_CATEGORIES, 
    load_cached_data, 
    save_cached_data, 
    analyze_stock_symbol
)

app = FastAPI(
    title="AI 盤後股票智能分析 API",
    description="提供盤後股票分類、即時分析及 AI 推薦推薦等服務"
)

# 支援跨域請求 (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 設定靜態檔案路徑
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR)

# --- 網頁路由 ---

@app.get("/")
def get_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "歡迎使用 AI 股票分析 API！請先建立 static/index.html 檔案。"}

@app.get("/style.css")
def get_css():
    css_path = os.path.join(STATIC_DIR, "style.css")
    if os.path.exists(css_path):
        return FileResponse(css_path)
    raise HTTPException(status_code=404, detail="style.css not found")

@app.get("/app.js")
def get_js():
    js_path = os.path.join(STATIC_DIR, "app.js")
    if os.path.exists(js_path):
        return FileResponse(js_path)
    raise HTTPException(status_code=404, detail="app.js not found")


# --- API 路由 ---

@app.get("/api/categories")
def get_categories():
    """
    獲取預設股票分類
    """
    return DEFAULT_CATEGORIES

@app.get("/api/stocks")
def get_all_stocks_data():
    """
    獲取目前本地快取中所有股票的盤後分析資料
    """
    return load_cached_data()

@app.get("/api/stock/{symbol}")
async def get_single_stock_data(symbol: str):
    """
    獲取單一股票的盤後快取資料
    """
    cache = load_cached_data()
    if symbol in cache:
        return cache[symbol]
    raise HTTPException(status_code=404, detail=f"找不到 {symbol} 的數據")

@app.post("/api/analyze/{symbol}")
async def trigger_stock_analysis(symbol: str):
    """
    觸發特定股票的 browser-use 實時爬取與分析。
    """
    try:
        print(f"📡 接收到對 {symbol} 進行 AI 實時分析的 API 請求...")
        result = await analyze_stock_symbol(symbol)
        return {
            "status": "success",
            "message": f"股票 {symbol} 分析成功！",
            "data": result
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"執行 AI 分析時發生錯誤: {str(e)}"
        )

@app.post("/api/add-stock")
async def add_custom_stock(symbol: str, category: str, name: str):
    """
    允許用戶在網頁上自訂新增股票代號到特定分類
    """
    if category not in DEFAULT_CATEGORIES:
        raise HTTPException(status_code=400, detail="無效的股票分類")
    
    # 檢查是否已存在
    exists = any(item["symbol"] == symbol for item in DEFAULT_CATEGORIES[category])
    if not exists:
        DEFAULT_CATEGORIES[category].append({"symbol": symbol, "name": name})
    
    # 立即觸發一次靜態初始分析
    result = await analyze_stock_symbol(symbol)
    
    return {
        "status": "success",
        "message": f"成功新增股票 {name} ({symbol})",
        "data": result
    }

@app.get("/api/optimization-weights")
def get_optimization_weights():
    """
    獲取當前的股票篩選與評分決策權重
    """
    from stock_agent import load_recommendation_weights
    return load_recommendation_weights()

@app.get("/api/verification-history")
def get_verification_history():
    """
    獲取每週收盤選股驗收與進化日誌記錄
    """
    import json
    history_file = "verification_history.json"
    if os.path.exists(history_file):
        try:
            with open(history_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

@app.post("/api/trigger-evolution")
async def trigger_evolution():
    """
    手動或透過網頁觸發每週五的收盤選股驗收與權重自我進化
    """
    try:
        from weekly_evaluator import run_weekly_verification_and_optimize
        print("📡 接收到手動觸發週五選股驗收與權重自我優化的請求...")
        result = run_weekly_verification_and_optimize()
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"執行自我優化時發生錯誤: {str(e)}"
        )

import datetime
import asyncio

async def daily_scheduler():
    """
    於周一~周五 15:07 自動觸發所有股票的最新盤後採集與分析，且在週五額外執行每週驗收。
    """
    while True:
        now = datetime.datetime.now()
        # 設定每天的目標時間：下午 3:07 (15:07:00)
        target_time = now.replace(hour=15, minute=7, second=0, microsecond=0)
        
        # 如果今天已經過了 15:07，目標時間改為明天
        if now >= target_time:
            target_time += datetime.timedelta(days=1)
            
        wait_seconds = (target_time - now).total_seconds()
        print(f"⏰ [自動排程] 下一次自動盤後分析將於 {target_time} 執行 (需等待 {wait_seconds:.1f} 秒)...")
        
        # 異步等待
        await asyncio.sleep(wait_seconds)
        
        # 再次檢查當前時間是否為周一至周五 (Monday=0 to Friday=4)
        current_day = datetime.datetime.now().weekday()
        if current_day <= 4:
            print(f"⚡ [自動排程] 當前時間已到 15:07，且今天是工作日 (星期 {current_day+1})，啟動盤後採集任務...")
            
            # 遍歷所有分類中的所有股票進行 browser-use 實時採集
            for category, stocks in DEFAULT_CATEGORIES.items():
                for st in stocks:
                    symbol = st["symbol"]
                    name = st["name"]
                    print(f"🔄 [自動排程] 正在採集與分析 {name} ({symbol})...")
                    try:
                        await analyze_stock_symbol(symbol)
                        print(f"✅ [自動排程] {name} ({symbol}) 分析完成。")
                    except Exception as e:
                        print(f"❌ [自動排程] {name} ({symbol}) 分析失敗: {e}")
                    # 每次採集間隔 10 秒，避免被財經網站封鎖 IP
                    await asyncio.sleep(10)
                    
            print("🎉 [自動排程] 每日盤後自動分析任務全部完成！資料庫已更新。")
            
            # 如果今天是週五 (weekday 為 4)，在 15:07 執行完分析後，額外執行每週驗收與自我進化機制
            if current_day == 4:
                print("📅 [自動排程] 今天是星期五，額外啟動週五收盤總驗收與決策權重自我優化機制...")
                try:
                    from weekly_evaluator import run_weekly_verification_and_optimize
                    run_weekly_verification_and_optimize()
                    print("✅ [自動排程] 星期五收盤選股驗收與權重自我進化已成功執行！")
                except Exception as e:
                    print(f"❌ [自動排程] 星期五選股驗收執行失敗: {e}")
        else:
            print(f"📅 [自動排程] 今天是星期 {current_day+1} (非工作日)，跳過 15:07 採集排程。")

@app.on_event("startup")
async def startup_event():
    # 啟動背景每日自動分析排程器
    asyncio.create_task(daily_scheduler())

if __name__ == "__main__":
    print("🚀 正在啟動後端 FastAPI 伺服器...")
    print("📍 前端首頁請瀏覽: http://127.0.0.1:8000")
    uvicorn.run("backend:app", host="127.0.0.1", port=8000, reload=True)
