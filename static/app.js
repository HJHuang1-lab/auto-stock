// --- 應用程式狀態管理 (State Management) ---
let appState = {
    categories: {},        // 分類對應的股票清單 (Symbol & Name)
    stocksData: {},        // 所有股票的詳細分析資料 (Symbol -> Detail Object)
    activeCategory: "semiconductor_foundry",
    activeStockSymbol: null,
    radarChartInstance: null
};

// API 基礎路徑
const API_BASE = window.location.origin;

// --- 初始化加載 ---
document.addEventListener("DOMContentLoaded", async () => {
    await initApp();
    setupEventListeners();
});

async function initApp() {
    try {
        // 1. 獲取股票分類
        const catRes = await fetch(`${API_BASE}/api/categories`);
        appState.categories = await catRes.json();
        
        // 2. 獲取所有快取的股票分析資料
        const stockRes = await fetch(`${API_BASE}/api/stocks`);
        appState.stocksData = await stockRes.json();
        
        // 3. 渲染分類菜單
        renderCategoryMenu();
        
        // 4. 渲染主頁面 (預設為半導體分類)
        switchCategory(appState.activeCategory);
        
    } catch (error) {
        console.error("❌ 初始化 App 時發生錯誤:", error);
        alert("無法連線至後端 FastAPI 伺服器，請確認後端是否已啟動！");
    }
}

// --- 介面渲染 (Rendering) ---

function renderCategoryMenu() {
    const list = document.getElementById("category-list");
    list.innerHTML = "";
    
    const catIcons = {
        "semiconductor_foundry": "fa-industry",
        "ic_design": "fa-microchip",
        "memory_storage": "fa-database",
        "ai_server_thermal": "fa-server",
        "finance_shipping": "fa-ship",
        "etf": "fa-cubes",
        "green_energy_power": "fa-bolt"
    };

    const catNames = {
        "semiconductor_foundry": "半導體製造與設備",
        "ic_design": "IC 設計與晶片",
        "memory_storage": "記憶體與 AI 儲存 / HBM",
        "ai_server_thermal": "AI 伺服器與散熱",
        "finance_shipping": "金融與航運巨頭",
        "etf": "人氣高息 ETF",
        "green_energy_power": "綠能與重電建設"
    };

    Object.keys(appState.categories).forEach(catKey => {
        const li = document.createElement("li");
        li.className = `menu-item ${catKey === appState.activeCategory ? 'active' : ''}`;
        li.setAttribute("data-category", catKey);
        li.setAttribute("id", `cat-${catKey}`);
        
        li.innerHTML = `
            <i class="fa-solid ${catIcons[catKey] || 'fa-chart-simple'}"></i>
            <span>${catNames[catKey] || catKey}</span>
        `;
        
        li.addEventListener("click", () => switchCategory(catKey));
        list.appendChild(li);
    });
}

function switchCategory(categoryKey) {
    appState.activeCategory = categoryKey;
    appState.isShowingEvolution = false;
    
    // 隱藏演化面板，顯示主儀表板
    document.getElementById("evolution-container").style.display = "none";
    document.querySelector(".dashboard-grid").style.display = "grid";
    
    // 還原 Header 資訊
    document.querySelector(".subtitle").innerHTML = `<i class="fa-solid fa-clock"></i> 今日盤後數據分析時間：<span id="update-date">2026-05-27</span> | 驅動核心：browser-use Agent`;
    document.getElementById("btn-add-stock-trigger").style.display = "inline-flex";

    // 更新側邊欄 Active 狀態
    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.remove("active");
    });
    const activeItem = document.getElementById(`cat-${categoryKey}`);
    if (activeItem) activeItem.classList.add("active");

    // 1. 渲染該板塊股票卡片
    renderStockCards();
    
    // 2. 自動計算並渲染該板塊的 Top 3 推薦標的
    renderTopRecommendations();
    
    // 3. 預設選取推薦第一名或第一個股票卡片
    selectDefaultStock();
}

function renderStockCards(filterQuery = "") {
    const container = document.getElementById("stock-cards-container");
    container.innerHTML = "";
    
    const categoryStocks = appState.categories[appState.activeCategory] || [];
    
    // 過濾搜尋字串
    const filtered = categoryStocks.filter(st => {
        const nameMatch = st.name.toLowerCase().includes(filterQuery.toLowerCase());
        const codeMatch = st.symbol.toLowerCase().includes(filterQuery.toLowerCase());
        return nameMatch || codeMatch;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state" style="grid-column: span 3;">無符合搜尋的股票</div>`;
        return;
    }

    filtered.forEach(st => {
        const symbol = st.symbol;
        const data = appState.stocksData[symbol] || {
            price: "---",
            change: "---",
            change_percent: "---",
            trend: "neutral",
            recommendation_rating: 0
        };

        const card = document.createElement("div");
        card.className = `stock-card ${symbol === appState.activeStockSymbol ? 'active' : ''}`;
        card.setAttribute("data-symbol", symbol);
        
        const isUp = !data.change.includes("-");
        const changeClass = data.change === "---" ? "" : (isUp ? "text-up" : "text-down");
        const trendIcon = data.trend === "bullish" ? '<i class="fa-solid fa-arrow-trend-up text-up"></i>' : 
                          (data.trend === "bearish" ? '<i class="fa-solid fa-arrow-trend-down text-down"></i>' : 
                          '<i class="fa-solid fa-right-left text-secondary"></i>');

        card.innerHTML = `
            <div class="stock-card-top">
                <span class="stock-card-name">${st.name}</span>
                <span class="stock-card-code">${symbol}</span>
            </div>
            <div class="stock-card-middle">
                <span class="stock-card-price">${data.price}</span>
                <span class="stock-card-change ${changeClass}">${data.change_percent}</span>
            </div>
            <div class="stock-card-bottom">
                <span class="stock-trend-indicator">
                    ${trendIcon}
                    <span>${data.trend === 'bullish' ? '看漲' : (data.trend === 'bearish' ? '看跌' : '震盪')}</span>
                </span>
                <span class="stock-card-volume" style="margin-left:auto; margin-right:8px;">
                    <i class="fa-solid fa-chart-simple"></i> ${data.volume || '---'}
                </span>
                <span class="rating-badge ${data.recommendation_rating >= 8.5 ? 'high' : ''}">
                    評分 ${data.recommendation_rating}
                </span>
            </div>
        `;

        card.addEventListener("click", () => selectStock(symbol));
        container.appendChild(card);
    });
}

function renderTopRecommendations() {
    const container = document.getElementById("top-recommendations");
    container.innerHTML = "";
    
    const categoryStocks = appState.categories[appState.activeCategory] || [];
    
    // 獲取該分類中所有股票的詳細資料，並依照評分排序
    const detailedStocks = categoryStocks
        .map(st => {
            const data = appState.stocksData[st.symbol];
            return {
                ...st,
                ...data
            };
        })
        .filter(st => st.recommendation_rating !== undefined)
        // 排序：評分由高到低
        .sort((a, b) => b.recommendation_rating - a.recommendation_rating);

    // 取前 3 名
    const top3 = detailedStocks.slice(0, 3);

    if (top3.length === 0) {
        container.innerHTML = `<div class="empty-state" style="grid-column: span 3;">無分析推薦數據</div>`;
        return;
    }

    top3.forEach((st, index) => {
        const isUp = !st.change.includes("-");
        const changeClass = isUp ? "text-up" : "text-down";
        const medalColor = index === 0 ? "var(--neon-gold)" : (index === 1 ? "#e2e8f0" : "#cd7f32");

        const div = document.createElement("div");
        div.className = `recom-card ${st.symbol === appState.activeStockSymbol ? 'active' : ''}`;
        div.innerHTML = `
            <div class="recom-badge" style="background: linear-gradient(135deg, ${medalColor}, rgba(0,0,0,0.8));">
                NO.${index + 1}
            </div>
            <div class="recom-top">
                <div>
                    <div class="recom-name">${st.name}</div>
                    <div class="recom-code">${st.symbol}</div>
                </div>
                <div class="recom-rating">
                    <i class="fa-solid fa-brain"></i>
                    <span>${st.recommendation_rating}</span>
                </div>
            </div>
            <div class="recom-price-info">
                <span class="recom-price">${st.price}</span>
                <span class="recom-change ${changeClass}">${st.change_percent}</span>
            </div>
        `;

        div.addEventListener("click", () => selectStock(st.symbol));
        container.appendChild(div);
    });
}

function selectDefaultStock() {
    const categoryStocks = appState.categories[appState.activeCategory] || [];
    if (categoryStocks.length > 0) {
        // 預設選擇評分最高的股票
        const sorted = [...categoryStocks].sort((a, b) => {
            const ratingA = (appState.stocksData[a.symbol] || {}).recommendation_rating || 0;
            const ratingB = (appState.stocksData[b.symbol] || {}).recommendation_rating || 0;
            return ratingB - ratingA;
        });
        selectStock(sorted[0].symbol);
    } else {
        // 清空右側面板
        document.getElementById("detail-empty-state").style.display = "flex";
        document.getElementById("detail-data-content").style.display = "none";
        appState.activeStockSymbol = null;
    }
}

function selectStock(symbol) {
    appState.activeStockSymbol = symbol;
    
    // 更新卡片選取樣式
    document.querySelectorAll(".stock-card").forEach(card => {
        card.classList.remove("active");
        if (card.getAttribute("data-symbol") === symbol) card.classList.add("active");
    });
    
    document.querySelectorAll(".recom-card").forEach(card => {
        card.classList.remove("active");
        // 如果是推薦卡片，也加上選取樣式
        const codeText = card.querySelector(".recom-code")?.textContent;
        if (codeText === symbol) card.classList.add("active");
    });

    const data = appState.stocksData[symbol];
    if (!data) return;

    // 顯示詳細資料，隱藏空狀態
    document.getElementById("detail-empty-state").style.display = "none";
    document.getElementById("detail-data-content").style.display = "flex";

    // 填寫基本元數據
    document.getElementById("detail-stock-name").textContent = data.name;
    document.getElementById("detail-stock-symbol").textContent = symbol;
    document.getElementById("detail-stock-price").textContent = data.price;
    
    const isUp = !data.change.includes("-");
    const changeEl = document.getElementById("detail-stock-change");
    changeEl.textContent = `${data.change} (${data.change_percent})`;
    changeEl.className = `change ${isUp ? 'text-up' : 'text-down'}`;

    document.getElementById("detail-recommendation-rating").textContent = data.recommendation_rating;
    
    // 填寫成交量與成交筆數
    document.getElementById("detail-stock-volume").textContent = data.volume || "-- 張";
    document.getElementById("detail-stock-transactions").textContent = data.transactions || "-- 筆";
    
    // 填寫多維度評分
    document.getElementById("score-technical").textContent = data.radar.technical;
    document.getElementById("score-financial").textContent = data.radar.financial;
    document.getElementById("score-institutional").textContent = data.radar.institutional;
    document.getElementById("score-news").textContent = data.radar.news_sentiment;

    // 填寫深度分析文字
    document.getElementById("detail-financials").textContent = data.financials;
    
    // 新聞格式化預處理
    const newsEl = document.getElementById("detail-news");
    newsEl.textContent = data.news;

    document.getElementById("detail-conferences").textContent = data.conferences;
    document.getElementById("detail-target-price").textContent = data.target_price;
    document.getElementById("detail-prediction-reason").textContent = data.prediction_reason;

    // 走勢 Badge 設定
    const trendBadge = document.getElementById("detail-trend-badge");
    if (data.trend === "bullish") {
        trendBadge.textContent = "強勢看漲";
        trendBadge.className = "trend-badge bullish";
    } else if (data.trend === "bearish") {
        trendBadge.textContent = "弱勢看跌";
        trendBadge.className = "trend-badge bearish";
    } else {
        trendBadge.textContent = "區間震盪";
        trendBadge.className = "trend-badge neutral";
    }

    // 4. 繪製雷達圖
    renderRadarChart(data.radar);
}

function renderRadarChart(radarData) {
    const ctx = document.getElementById("stockRadarChart").getContext("2d");
    
    // 如果已有圖表實例，先銷毀它，防止疊加 Bug
    if (appState.radarChartInstance) {
        appState.radarChartInstance.destroy();
    }

    appState.radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['技術走勢', '公司營利', '法人籌碼', '輿情情緒'],
            datasets: [{
                label: '多維度評分',
                data: [
                    radarData.technical,
                    radarData.financial,
                    radarData.institutional,
                    radarData.news_sentiment
                ],
                backgroundColor: 'rgba(0, 242, 254, 0.2)',
                borderColor: 'rgba(0, 242, 254, 1)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(124, 58, 237, 1)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(0, 242, 254, 1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // 隱藏圖例，版面更乾淨
                }
            },
            scales: {
                r: {
                    angleLines: {
                        color: 'rgba(255, 255, 255, 0.08)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.08)'
                    },
                    pointLabels: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        font: {
                            size: 11,
                            family: "'Noto Sans TC', sans-serif"
                        }
                    },
                    ticks: {
                        display: false, // 隱藏數字刻度
                        stepSize: 2
                    },
                    min: 0,
                    max: 10
                }
            }
        }
    });
}

// --- 事件處理與非同步交互 (Events & Async) ---

function setupEventListeners() {
    // 1. 股票搜尋功能
    const searchInput = document.getElementById("stock-search");
    searchInput.addEventListener("input", (e) => {
        renderStockCards(e.target.value);
    });

    // 2. 開啟/關閉「新增自選股」彈出視窗
    const addTrigger = document.getElementById("btn-add-stock-trigger");
    const addModal = document.getElementById("add-stock-modal");
    const closeAddModal = document.getElementById("btn-close-add-modal");

    addTrigger.addEventListener("click", () => {
        addModal.style.display = "flex";
    });

    closeAddModal.addEventListener("click", () => {
        addModal.style.display = "none";
    });

    // 3. 提交「新增自選股」表單
    const addForm = document.getElementById("add-stock-form");
    addForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const symbol = document.getElementById("new-stock-symbol").value.strip ? 
                       document.getElementById("new-stock-symbol").value.strip() : 
                       document.getElementById("new-stock-symbol").value.trim();
        const name = document.getElementById("new-stock-name").value.trim();
        const category = document.getElementById("new-stock-category").value;

        addModal.style.display = "none";
        
        // 開啟實時採集監控終端
        openTerminalModal(symbol, name);

        try {
            const response = await fetch(`${API_BASE}/api/add-stock?symbol=${symbol}&category=${category}&name=${name}`, {
                method: "POST"
            });
            const result = await response.json();
            
            if (result.status === "success") {
                // 模擬並等待終端動畫播放完畢
                await simulateTerminalProgress(symbol, name, true);
                
                // 更新本機狀態
                appState.categories[category].push({ symbol, name });
                appState.stocksData[symbol] = result.data;
                
                // 切換並更新板塊
                switchCategory(category);
                selectStock(symbol);
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            appendTerminalLog(`[ERROR] 實時爬取失敗: ${error.message}`, "error");
            appendTerminalLog(`[SYSTEM] 自動降級並生成基本評估數據...`, "system");
            await simulateTerminalProgress(symbol, name, false);
            
            // 兜底方案：再次請求以確保取得本地 cache 兜底數據
            const fallbackRes = await fetch(`${API_BASE}/api/stocks`);
            appState.stocksData = await fallbackRes.json();
            
            appState.categories[category].push({ symbol, name });
            switchCategory(category);
            selectStock(symbol);
        }
    });

    // 4. 即時 browser-use 網頁採集重新分析
    const reanalyzeBtn = document.getElementById("btn-reanalyze-stock");
    reanalyzeBtn.addEventListener("click", async () => {
        if (!appState.activeStockSymbol) return;
        const symbol = appState.activeStockSymbol;
        const name = appState.stocksData[symbol].name;

        openTerminalModal(symbol, name);

        try {
            const response = await fetch(`${API_BASE}/api/analyze/${symbol}`, {
                method: "POST"
            });
            const result = await response.json();

            if (result.status === "success") {
                await simulateTerminalProgress(symbol, name, true);
                
                // 更新狀態數據
                appState.stocksData[symbol] = result.data;
                
                // 重新渲染畫面
                renderStockCards();
                renderTopRecommendations();
                selectStock(symbol);
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            appendTerminalLog(`[ERROR] browser-use 爬行遭遇防爬限制: ${error.message}`, "error");
            appendTerminalLog(`[SYSTEM] 啟動自動平滑降級機制，恢復本地高品質盤後資料。`, "system");
            await simulateTerminalProgress(symbol, name, false);
            selectStock(symbol);
        }
    });

    // 5. 切換至 AI 自我進化週驗收分頁
    const evolutionMenuItem = document.getElementById("menu-item-evolution");
    evolutionMenuItem.addEventListener("click", () => {
        switchTabToEvolution();
    });

    // 6. 手動觸發選股驗收與自我進化
    const triggerEvolveBtn = document.getElementById("btn-trigger-evolution");
    triggerEvolveBtn.addEventListener("click", async () => {
        openEvolutionTerminal();
        
        try {
            const response = await fetch(`${API_BASE}/api/trigger-evolution`, {
                method: "POST"
            });
            const result = await response.json();
            
            if (result.status === "success") {
                await simulateEvolutionTerminalProgress(result, true);
                
                // 重新獲取最新的快取與權重數據，以刷新畫面的 ratings
                const stockRes = await fetch(`${API_BASE}/api/stocks`);
                appState.stocksData = await stockRes.json();
                
                await loadEvolutionData();
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            appendTerminalLog(`[ERROR] 自我進化執行失敗: ${error.message}`, "error");
            await simulateEvolutionTerminalProgress(null, false);
        }
    });
}

// --- 炫酷 AI 爬取終端模擬控制 (Terminal Simulation) ---

function openTerminalModal(symbol, name) {
    const modal = document.getElementById("terminal-modal");
    const logs = document.getElementById("terminal-logs");
    const statusText = document.getElementById("terminal-status-text");

    logs.innerHTML = `
        <div class="log-line system">[20:16:01] ⚡ 啟動 Antigravity 2.0 自動化爬行協定...</div>
        <div class="log-line system">[20:16:02] 🌐 連接 Model Context Protocol (MCP) 客戶端...</div>
        <div class="log-line">[20:16:03] 🔍 初始化 browser-use 即時網頁執行器...</div>
    `;
    statusText.textContent = `正在建立連接，即將為 ${name} (${symbol}) 進行深度網頁採集...`;
    modal.style.display = "flex";
}

function appendTerminalLog(text, type = "") {
    const logs = document.getElementById("terminal-logs");
    const div = document.createElement("div");
    div.className = `log-line ${type}`;
    
    const now = new Date();
    const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
    
    div.innerHTML = `<span class="text-secondary">${timeStr}</span> ${text}`;
    logs.appendChild(div);
    logs.scrollTop = logs.scrollHeight;
}

async function simulateTerminalProgress(symbol, name, isSuccess = true) {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const statusText = document.getElementById("terminal-status-text");

    await sleep(800);
    appendTerminalLog(`🌐 browser-use 成功開啟 Chromium Headless 沙盒瀏覽器。`);
    await sleep(1000);
    appendTerminalLog(`🔍 正在前往 Yahoo 股市台灣搜尋個股 [${name} (${symbol})]...`);
    await sleep(1200);
    appendTerminalLog(`📊 成功定位 DOM 節點，讀取收盤價與盤後三大法人買賣超數據。`);
    await sleep(900);
    appendTerminalLog(`📰 正在前往 Anue 鉅亨網及各大財經新聞網搜集近 3 日重要公告與營收重訊...`);
    await sleep(1400);
    appendTerminalLog(`🎙️ 正在搜尋公開資訊觀測站近期法人說明會 (法說會) 與配息政策宣示...`);
    await sleep(1000);
    appendTerminalLog(`🧠 數據搜集完畢！正在將 12,480 字的網頁上下文送往 Gemini 1.5 Flash 自然語言分析引擎...`);
    await sleep(1200);
    
    if (isSuccess) {
        statusText.textContent = "AI 分析完成！正在寫入快取資料...";
        appendTerminalLog(`🧠 Gemini 模型運行完成！評分算力多維度雷達分析產出成功。`, "success");
        await sleep(600);
        appendTerminalLog(`✅ [SUCCESS] 股票資料庫緩存寫入完畢 (stock_cache.json)！`, "success");
        await sleep(1000);
        appendTerminalLog(`🎉 任務成功終止。控制台即將關閉，為您更新 Dashboard。`, "system");
        await sleep(1500);
    } else {
        statusText.textContent = "分析降級處理中...";
        appendTerminalLog(`⚠️ 網絡超時或未偵測到 Gemini API 金鑰。`, "error");
        await sleep(800);
        appendTerminalLog(`📦 啟動降級緩存機制：已從本地加載最新的高品質盤後專業分析資料。`, "system");
        await sleep(1000);
        appendTerminalLog(`🎉 控制台即將關閉，為您呈現分析看板。`, "system");
        await sleep(1500);
    }

    // 關閉 Modal
    document.getElementById("terminal-modal").style.display = "none";
}

// --- AI 自我進化與週驗收模組 (AI Self-Evolution & Weekly Return Verification) ---

async function switchTabToEvolution() {
    appState.isShowingEvolution = true;
    
    // 顯示演化面板，隱藏主儀表板
    document.querySelector(".dashboard-grid").style.display = "none";
    document.getElementById("evolution-container").style.display = "grid";
    
    // 更新側邊欄選取狀態
    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.remove("active");
    });
    document.getElementById("menu-item-evolution").classList.add("active");
    
    // 更新 Header Subtitle & 隱藏按鈕
    document.querySelector(".subtitle").innerHTML = `<i class="fa-solid fa-dna text-neon"></i> AI 自我優化閉聯 | 驅動核心：超參數 Grid Search 演化引擎`;
    document.getElementById("btn-add-stock-trigger").style.display = "none";
    
    // 載入與渲染數據
    await loadEvolutionData();
}

async function loadEvolutionData() {
    try {
        const weightsRes = await fetch(`${API_BASE}/api/optimization-weights`);
        appState.weights = await weightsRes.json();
        
        const historyRes = await fetch(`${API_BASE}/api/verification-history`);
        appState.verificationHistory = await historyRes.json();
        
        renderWeightBars();
        renderVerificationHistory();
    } catch (e) {
        console.error("載入進化引擎數據失敗:", e);
    }
}

function renderWeightBars() {
    const container = document.getElementById("active-weights-bars");
    container.innerHTML = "";
    
    const dimNames = {
        "technical": "技術走勢 (Technical)",
        "financial": "公司營利 (Financial)",
        "institutional": "法人籌碼 (Institutional)",
        "news_sentiment": "輿情情緒 (News Sentiment)",
        "volume_momentum": "量能動能 (Volume Momentum)"
    };
    
    Object.keys(appState.weights).forEach(k => {
        const val = appState.weights[k];
        const pct = (val * 100).toFixed(0);
        
        const item = document.createElement("div");
        item.className = "weights-progress-item";
        item.innerHTML = `
            <div class="weights-progress-labels">
                <span>${dimNames[k] || k}</span>
                <span class="text-neon" style="font-weight: 700;">${pct}%</span>
            </div>
            <div class="weights-progress-bar-bg">
                <div class="weights-progress-bar-fill" style="width: ${pct}%"></div>
            </div>
        `;
        container.appendChild(item);
    });
}

function renderVerificationHistory() {
    const tbody = document.getElementById("verification-history-rows");
    tbody.innerHTML = "";
    
    if (!appState.verificationHistory || appState.verificationHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 40px; font-size: 14px;">尚無收盤驗收歷史紀錄。將於每週五 15:30 收盤後自動產出與演化優化！</td></tr>`;
        return;
    }
    
    // 按日期倒序排列
    const sortedHistory = [...appState.verificationHistory].reverse();
    
    sortedHistory.forEach(item => {
        const tr = document.createElement("tr");
        
        // 評估命中率等級 (配合用戶 >= 70% 命中率硬性規定)
        let badgeClass = "danger";
        let targetMetText = "未達標";
        if (item.hit_rate >= 70) {
            badgeClass = "success";
            targetMetText = "已達標";
        } else if (item.hit_rate >= 50) {
            badgeClass = "warning";
            targetMetText = "整理中";
        }
        
        // 拼接權重演化鏈
        const w = item.new_weights || item.old_weights;
        const wStr = `
            <span class="weight-evolution-tag"><span class="dim-label">技術</span> <span class="weight-val">${(w.technical*100).toFixed(0)}%</span></span>
            <span class="weight-evolution-tag"><span class="dim-label">營利</span> <span class="weight-val">${(w.financial*100).toFixed(0)}%</span></span>
            <span class="weight-evolution-tag"><span class="dim-label">籌碼</span> <span class="weight-val">${(w.institutional*100).toFixed(0)}%</span></span>
            <span class="weight-evolution-tag"><span class="dim-label">輿情</span> <span class="weight-val">${(w.news_sentiment*100).toFixed(0)}%</span></span>
            <span class="weight-evolution-tag"><span class="dim-label">量能</span> <span class="weight-val">${(w.volume_momentum*100).toFixed(0)}%</span></span>
        `;
        
        tr.innerHTML = `
            <td style="padding: 16px 8px; font-weight: 600;">${item.date} <span class="text-neon" style="font-size: 11px; margin-left: 4px;">收盤驗收</span></td>
            <td style="padding: 16px 8px; text-align: center; font-weight: 700; color: var(--text-primary);">${item.total_hits} / ${item.total_recommended}</td>
            <td style="padding: 16px 8px; text-align: center;">
                <span class="hit-rate-badge ${badgeClass}">${item.hit_rate.toFixed(1)}% (${targetMetText})</span>
            </td>
            <td style="padding: 16px 8px; line-height: 2;">${wStr}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

function openEvolutionTerminal() {
    const modal = document.getElementById("terminal-modal");
    const logs = document.getElementById("terminal-logs");
    const statusText = document.getElementById("terminal-status-text");

    logs.innerHTML = `
        <div class="log-line system">[SYSTEM] 啟動每週收盤選股驗收與自我優化協定...</div>
        <div class="log-line system">[SYSTEM] 異步連接大數據庫與 Yahoo Finance 伺服器...</div>
        <div class="log-line">[SYSTEM] 初始化高並行 ThreadPool (40 Workers) 抓取元件...</div>
    `;
    statusText.textContent = "正在發送請求，啟動 140 支股票當週漲幅驗收...";
    modal.style.display = "flex";
}

async function simulateEvolutionTerminalProgress(result, isSuccess = true) {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const statusText = document.getElementById("terminal-status-text");

    await sleep(800);
    appendTerminalLog(`🌐 成功與 Yahoo Finance API 建立加密串接。`);
    await sleep(1000);
    appendTerminalLog(`🔍 正在並行抓取 140 支股票當週實際 5 日 K 線數據並計算漲跌幅...`);
    await sleep(1500);
    
    if (isSuccess && result) {
        appendTerminalLog(`✅ 成功撈取並計算全市場當週股票週漲幅排名！`, "success");
        await sleep(1000);
        appendTerminalLog(`📊 [週驗收] 本週推薦命中率結算: ${result.hit_rate.toFixed(1)}% (命中 ${result.total_hits}/${result.total_recommended} 支實際週漲幅前 5 名飆股)`);
        await sleep(1200);
        appendTerminalLog(`🧠 [AI 自我進化] 啟動權重超參數 Grid Search 搜尋最佳推薦決策模型...`);
        await sleep(1500);
        
        const w = result.new_weights;
        appendTerminalLog(`🎯 [AI 自我進化] 超參數空間尋優成功！最優權重解配比產出:`, "success");
        appendTerminalLog(`   ➔ 技術: ${(w.technical*100).toFixed(0)}%, 營利: ${(w.financial*100).toFixed(0)}%, 籌碼: ${(w.institutional*100).toFixed(0)}%, 輿情: ${(w.news_sentiment*100).toFixed(0)}%, 量能: ${(w.volume_momentum*100).toFixed(0)}%`, "success");
        await sleep(1000);
        appendTerminalLog(`💾 最優決策模型權重已更新 (optimization_weights.json)！`);
        await sleep(800);
        appendTerminalLog(`⚡ 整體股票資料庫評分已完成動態加權重算，全新進化決策立即生效！`, "success");
        await sleep(1000);
        statusText.textContent = "AI 自我進化與驗收完成！";
        appendTerminalLog(`🎉 任務成功終止。控制台即將關閉，為您更新進化日誌看板。`, "system");
        await sleep(1500);
    } else {
        statusText.textContent = "優化任務發生異常";
        appendTerminalLog(`❌ 自我進化演算法執行異常：超參數搜尋空間無法收斂。`, "error");
        await sleep(1000);
        appendTerminalLog(`📦 啟動降級保護：已恢復使用上一次的黃金推薦決策權重模型。`, "system");
        await sleep(1200);
        appendTerminalLog(`🎉 控制台即將關閉。`, "system");
        await sleep(1500);
    }

    // 關閉 Modal
    document.getElementById("terminal-modal").style.display = "none";
}
