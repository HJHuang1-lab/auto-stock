import asyncio
import os
import sys
from browser_use import Agent

# 檢查是否安裝了 langchain-google-genai，若無則提示
try:
    from langchain_google_genai import ChatGoogleGenerativeAI
except ImportError:
    print("【錯誤】未找到 langchain-google-genai 套件，請先在終端執行：")
    print("pip install langchain-google-genai")
    sys.exit(1)

async def main():
    print("=" * 60)
    print("  🚀 Antigravity 2.0 - browser-use 半導體先進封裝論文檢索測試  ")
    print("=" * 60)

    # 1. 檢查並獲取 Gemini API Key
    # 如果環境變數中沒有，則提示用戶輸入
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("💡 提示：系統環境變數中未偵測到 GEMINI_API_KEY。")
        api_key = input("🔑 請輸入您的 Gemini API Key (或直接回車跳過，若您已在系統層級設定): ").strip()
        if api_key:
            os.environ["GEMINI_API_KEY"] = api_key
        else:
            print("❌ 錯誤：必須提供 GEMINI_API_KEY 才能執行 AI Agent。")
            return

    # 2. 初始化 Gemini LLM (推薦使用 1.5 Pro 或 1.5 Flash 處理長上下文)
    print("\n🤖 正在初始化 Gemini 1.5 Flash 模型...")
    llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash")

    # 3. 定義您的半導體學術檢索任務
    # 這是一個跨頁面、需要輸入與閱讀的任務，非常適合 browser-use 展現能力
    task = (
        "Go to Google Scholar (https://scholar.google.com). "
        "Search for 'TSMC CoWoS packaging technology 2025 2026'. "
        "Find the top 3 papers from the search results, "
        "and return a list containing their titles, authors, and brief descriptions."
    )

    print(f"\n📋 任務設定：\n「{task}」")
    print("\n🎯 瀏覽器即將啟動！您將看到 AI 自動打開瀏覽器、輸入搜尋關鍵字並抓取資料...")
    print("提示：此過程大約需要 1-2 分鐘，請保持網路連線。")
    print("-" * 60)

    # 4. 建立並運行 Agent
    agent = Agent(
        task=task,
        llm=llm,
    )

    try:
        history = await agent.run()
        print("\n" + "=" * 60)
        print("🎉 任務成功完成！以下是 AI Agent 的執行結果：")
        print("=" * 60)
        
        # 輸出最終結果
        if history and history.final_result():
            print(history.final_result())
        else:
            print("未取得明確的最終結果，以下為執行軌跡最後一步：")
            if history and history.history:
                print(history.history[-1])
            
    except Exception as e:
        print(f"\n❌ 執行過程中發生錯誤: {e}")
        print("請確認 Playwright 瀏覽器是否已正確下載（執行 python -m playwright install 進行驗證）。")

if __name__ == "__main__":
    # Windows 環境下的 asyncio 事件循環兼容處理
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
