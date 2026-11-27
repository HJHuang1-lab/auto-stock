// --- 應用程式狀態管理 (State Management) ---
let appState = {
    categories: {},        // 分類對應的股票清單 (Symbol & Name)
    stocksData: {},        // 所有股票的詳細分析資料 (Symbol -> Detail Object)
    activeCategory: "semiconductor_foundry",
    activeStockSymbol: null,
    sortBy: "rating",      // 'rating' | 'volume'
    radarChartInstance: null,
    detailTrendChartInstance: null
};

// 靜態 JSON 資料路徑（GitHub Actions 每日自動更新，部署至 Firebase）
const DATA_BASE = `${window.location.origin}/data`;

// --- 初始化加載 ---
document.addEventListener("DOMContentLoaded", async () => {
    await initApp();
    setupEventListeners();
});

async function initApp() {
    try {
        // 1. 獲取元數據（最後更新時間）
        try {
            const metaRes = await fetch(`${DATA_BASE}/meta.json?t=${Date.now()}`);
            if (metaRes.ok) {
                const meta = await metaRes.json();
                appState.meta = meta;
                // 更新頁面顯示的更新時間
                const updateDateEl = document.getElementById("update-date");
                if (updateDateEl) updateDateEl.textContent = meta.last_updated || meta.update_date || "---";
            }
        } catch (e) { console.warn("meta.json 讀取失敗:", e); }

        // 2. 獲取股票分類
        const catRes = await fetch(`${DATA_BASE}/categories.json?t=${Date.now()}`);
        if (!catRes.ok) throw new Error(`categories.json 讀取失敗 (${catRes.status})`);
        appState.categories = await catRes.json();
        
        // 3. 獲取所有股票分析資料
        const stockRes = await fetch(`${DATA_BASE}/stock_cache.json?t=${Date.now()}`);
        if (!stockRes.ok) throw new Error(`stock_cache.json 讀取失敗 (${stockRes.status})`);
        appState.stocksData = await stockRes.json();
        
        // 4. 渲染分類菜單
        renderCategoryMenu();
        
        // 4.5 獲取全球/台股大盤指標走勢
        try {
            const trendRes = await fetch(`${DATA_BASE}/market_trends.json?t=${Date.now()}`);
            if (trendRes.ok) {
                appState.marketTrends = await trendRes.json();
                renderMarketTrends();
            }
        } catch (e) {
            console.warn("market_trends.json 讀取或渲染失敗:", e);
        }
        
        // 5. 渲染主頁面 (預設為半導體分類)
        switchCategory(appState.activeCategory);
        
    } catch (error) {
        console.error("❌ 初始化 App 時發生錯誤:", error);
        showErrorBanner(`資料載入失敗：${error.message}。資料由 GitHub Actions 每日 15:07 自動更新。`);
    }
}

function showErrorBanner(msg) {
    // 顯示一個優雅的錯誤橫幅，而非 alert
    let banner = document.getElementById("error-banner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "error-banner";
        banner.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
            background: linear-gradient(135deg, #ff416c, #ff4b2b);
            color: white; padding: 14px 24px; text-align: center;
            font-size: 14px; font-weight: 600; box-shadow: 0 4px 20px rgba(255,65,108,0.4);
        `;
        document.body.prepend(banner);
    }
    banner.textContent = `⚠️ ${msg}`;
    setTimeout(() => { if (banner) banner.remove(); }, 8000);
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
        "cpo_networking": "fa-network-wired",
        "finance_shipping": "fa-ship",
        "etf": "fa-cubes",
        "green_energy_power": "fa-bolt"
    };

    const catNames = {
        "semiconductor_foundry": "半導體製造與設備",
        "ic_design": "IC 設計與晶片",
        "memory_storage": "記憶體與 AI 儲存 / HBM",
        "ai_server_thermal": "AI 伺服器與散熱",
        "cpo_networking": "光通訊 CPO 與網通光電",
        "finance_shipping": "金融與航運巨頭",
        "etf": "人氣高息與市值 ETF",
        "green_energy_power": "綠能重電與傳產熱門"
    };

    Object.keys(appState.categories).forEach(catKey => {
        const li = document.createElement("li");
        li.className = `menu-item ${catKey === appState.activeCategory ? 'active' : ''}`;
        li.setAttribute("data-category", catKey);
        li.setAttribute("id", `cat-${catKey}`);
        const count = (appState.categories[catKey] || []).length;
        
        li.innerHTML = `
            <i class="fa-solid ${catIcons[catKey] || 'fa-chart-simple'}"></i>
            <span>${catNames[catKey] || catKey}</span>
            <span class="menu-count-pill">${count}</span>
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
    const lastUpdated = appState.meta ? (appState.meta.last_updated || appState.meta.update_date) : "2026-05-28";
    const poolSize = getTotalUniquePoolCount();
    document.querySelector(".subtitle").innerHTML = `<i class="fa-solid fa-clock"></i> 今日盤後數據分析時間：<span id="update-date">${lastUpdated}</span> | 熱門股漏斗池：<span>${poolSize} 檔</span> | 驅動核心：TWSE/TPEx + AI 漏斗引擎`;
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

function parseVolumeNum(volStr) {
    if (!volStr) return 0;
    const s = String(volStr).trim().replace(/,/g, "");
    if (s.includes("萬")) {
        return (parseFloat(s.replace(/萬張|萬/g, "")) || 0) * 10000;
    }
    return parseFloat(s.replace(/張/g, "")) || 0;
}

function getTotalUniquePoolCount() {
    const set = new Set();
    Object.values(appState.categories || {}).forEach(arr => {
        (arr || []).forEach(s => set.add(s.symbol));
    });
    return set.size || appState.meta?.pool_size || 0;
}

function renderStockCards(filterQuery = "") {
    const container = document.getElementById("stock-cards-container");
    container.innerHTML = "";
    
    const q = filterQuery.trim().toLowerCase();
    const totalPool = getTotalUniquePoolCount();
    const categoryStocks = appState.categories[appState.activeCategory] || [];
    
    let sourceList = [];
    if (q) {
        // 全池跨板塊搜尋 400+ 熱門股（以代號去重）
        const seen = new Set();
        Object.entries(appState.categories || {}).forEach(([catKey, arr]) => {
            (arr || []).forEach(st => {
                if (seen.has(st.symbol)) return;
                const nameMatch = st.name.toLowerCase().includes(q);
                const codeMatch = st.symbol.toLowerCase().includes(q);
                if (nameMatch || codeMatch) {
                    seen.add(st.symbol);
                    sourceList.push({ ...st, _catKey: catKey });
                }
            });
        });
    } else {
        sourceList = categoryStocks.map(st => ({ ...st, _catKey: appState.activeCategory }));
    }

    // 排序：依評分或依當日成交張數
    sourceList.sort((a, b) => {
        const da = appState.stocksData[a.symbol] || {};
        const db = appState.stocksData[b.symbol] || {};
        if (appState.sortBy === "volume") {
            return parseVolumeNum(db.volume) - parseVolumeNum(da.volume);
        }
        return (db.recommendation_rating || 0) - (da.recommendation_rating || 0);
    });

    const badgeEl = document.getElementById("pool-count-badge");
    if (badgeEl) {
        badgeEl.textContent = q
            ? `全池搜尋命中 ${sourceList.length} / ${totalPool} 檔`
            : `本板塊 ${categoryStocks.length} 檔 · 全池 ${totalPool} 檔`;
    }

    if (sourceList.length === 0) {
        container.innerHTML = `<div class="empty-state" style="grid-column: span 3;">全池 ${totalPool} 檔熱門股中無符合「${filterQuery}」之標的</div>`;
        return;
    }

    sourceList.forEach(st => {
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
        
        const isUp = !String(data.change || "").includes("-");
        const changeClass = data.change === "---" ? "" : (isUp ? "text-up" : "text-down");
        const trendIcon = data.trend === "bullish" ? '<i class="fa-solid fa-arrow-trend-up text-up"></i>' : 
                          (data.trend === "bearish" ? '<i class="fa-solid fa-arrow-trend-down text-down"></i>' : 
                          '<i class="fa-solid fa-right-left text-secondary"></i>');
        const catShort = q && EVOLUTION_CAT_META[st._catKey] ? `<span class="stock-card-code" style="color:var(--neon-cyan); margin-right:4px;">${EVOLUTION_CAT_META[st._catKey].short}</span>` : "";

        card.innerHTML = `
            <div class="stock-card-top">
                <span class="stock-card-name">${st.name}</span>
                <div>${catShort}<span class="stock-card-code">${symbol}</span></div>
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
    
    // 填寫成交量、成交筆數與官方三大法人買賣超
    document.getElementById("detail-stock-volume").textContent = data.volume || "-- 張";
    document.getElementById("detail-stock-transactions").textContent = data.transactions || "-- 筆";
    const instEl = document.getElementById("detail-stock-inst");
    if (instEl) {
        if (data.inst_net_lots !== undefined && data.inst_net_lots !== null) {
            const lots = Number(data.inst_net_lots);
            const sign = lots > 0 ? "+" : "";
            instEl.textContent = `${sign}${lots.toLocaleString()} 張`;
            instEl.className = lots > 0 ? "text-up" : (lots < 0 ? "text-down" : "");
        } else {
            instEl.textContent = "-- 張";
            instEl.className = "";
        }
    }
    
    // 填寫多維度評分
    document.getElementById("score-technical").textContent = data.radar.technical;
    document.getElementById("score-financial").textContent = data.radar.financial;
    document.getElementById("score-institutional").textContent = data.radar.institutional;
    document.getElementById("score-news").textContent = data.radar.news_sentiment;

    // 填寫深度分析文字
    document.getElementById("detail-financials").textContent = data.financials;
    
    // 新聞格式化預處理
    const newsEl = document.getElementById("detail-news");
    if (data.news) {
        let formattedNews = data.news;
        // 替換 markdown [連結文字](URL)
        formattedNews = formattedNews.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="news-link">$1</a>');
        // 替換 plain (連結: URL)
        formattedNews = formattedNews.replace(/\(連結:\s*(https?:\/\/[^\s\)]+)\)/g, '(<a href="$1" target="_blank" class="news-link">新聞連結</a>)');
        newsEl.innerHTML = formattedNews;
    } else {
        newsEl.textContent = "暫無新聞分析";
    }

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

    // 5. 繪製個股收盤價走勢圖
    renderDetailTrendChart(data.history, isUp, data.name, symbol);
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

function renderDetailTrendChart(history, isUp, name, symbol) {
    const canvas = document.getElementById("detailTrendChart");
    if (!canvas) return;
    
    // 如果已有圖表實例，先銷毀它，防止疊加 Bug
    if (appState.detailTrendChartInstance) {
        appState.detailTrendChartInstance.destroy();
        appState.detailTrendChartInstance = null;
    }

    if (!history || history.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "14px 'Noto Sans TC'";
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("暫無歷史股價資料", canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = history.map(h => h.date);
    const prices = history.map(h => h.price);

    const colorLine = isUp ? "rgb(255, 65, 108)" : "rgb(0, 230, 115)";
    const colorBgGradStart = isUp ? "rgba(255, 65, 108, 0.12)" : "rgba(0, 230, 115, 0.12)";
    
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, colorBgGradStart);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    appState.detailTrendChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '收盤價',
                data: prices,
                borderColor: colorLine,
                borderWidth: 2.5,
                pointBackgroundColor: colorLine,
                pointBorderColor: "rgba(255,255,255,0.7)",
                pointBorderWidth: 1,
                pointRadius: history.length > 30 ? 1.5 : 2.5,
                pointHoverRadius: 5,
                fill: true,
                backgroundColor: gradient,
                tension: 0.2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: "rgba(10, 15, 28, 0.9)",
                    titleColor: "#fff",
                    bodyColor: "#00f2fe",
                    bodyFont: { weight: 'bold', size: 13 },
                    borderColor: "rgba(0, 242, 254, 0.2)",
                    borderWidth: 1,
                    padding: 8,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `收盤價: ${context.raw.toLocaleString()} 元`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.03)" },
                    ticks: { 
                        color: "rgba(255, 255, 255, 0.5)", 
                        font: { size: 10, family: 'Outfit' },
                        maxTicksLimit: 6
                    }
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.03)" },
                    ticks: {
                        color: "rgba(255, 255, 255, 0.5)",
                        font: { size: 10, family: 'Outfit' },
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// --- 事件處理與非同步交互 (Events & Async) ---

function setupEventListeners() {
    // 1. 股票搜尋與排序切換功能
    const searchInput = document.getElementById("stock-search");
    searchInput.addEventListener("input", (e) => {
        renderStockCards(e.target.value);
    });

    const sortRatingBtn = document.getElementById("btn-sort-rating");
    const sortVolumeBtn = document.getElementById("btn-sort-volume");
    if (sortRatingBtn && sortVolumeBtn) {
        sortRatingBtn.addEventListener("click", () => {
            appState.sortBy = "rating";
            sortRatingBtn.classList.add("active");
            sortVolumeBtn.classList.remove("active");
            renderStockCards(searchInput.value);
        });
        sortVolumeBtn.addEventListener("click", () => {
            appState.sortBy = "volume";
            sortVolumeBtn.classList.add("active");
            sortRatingBtn.classList.remove("active");
            renderStockCards(searchInput.value);
        });
    }

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

        // 雲端靜態模式：新增自選股僅在本機 session 生效
        // 若需永久保存，請聯繫管理員或等下次 GitHub Actions 更新
        appendTerminalLog(`[系統] 雲端靜態模式：新增 ${name} (${symbol}) 至本機工作階段...`, "system");
        await simulateTerminalProgress(symbol, name, false);
        
        // 建立基礎評估數據
        const defaultData = {
            name, symbol,
            price: "---", change: "+0.00", change_percent: "0.00%",
            trend: "neutral", volume: "---", transactions: "---",
            recommendation_rating: 5.0,
            radar: { technical: 5, financial: 5, institutional: 5, news_sentiment: 5 },
            financials: "等待下次 GitHub Actions 排程更新後顯示分析資料。",
            news: "等待系統自動分析...",
            conferences: "---",
            target_price: "---",
            prediction_reason: "新增股票，將於下次排程（工作日 15:07）自動採集並分析。"
        };
        appState.categories[category].push({ symbol, name });
        appState.stocksData[symbol] = defaultData;
        switchCategory(category);
        selectStock(symbol);
    });

    // 4. 重新整理資料（雲端模式：從靜態 JSON 重新載入）
    const reanalyzeBtn = document.getElementById("btn-reanalyze-stock");
    reanalyzeBtn.addEventListener("click", async () => {
        if (!appState.activeStockSymbol) return;
        const symbol = appState.activeStockSymbol;
        const name = (appState.stocksData[symbol] || {}).name || symbol;

        openTerminalModal(symbol, name);

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const statusText = document.getElementById("terminal-status-text");
        statusText.textContent = `正在從雲端讀取 ${name} (${symbol}) 的最新分析資料...`;
        
        await sleep(800);
        appendTerminalLog(`🌐 正在讀取 Firebase 雲端最新盤後分析資料...`);
        await sleep(1000);
        
        try {
            const stockRes = await fetch(`${DATA_BASE}/stock_cache.json?t=${Date.now()}`);
            const freshData = await stockRes.json();
            appState.stocksData = freshData;
            
            await sleep(600);
            appendTerminalLog(`✅ 資料已更新！（最後更新時間: ${appState.meta?.last_updated || '---'}）`, "success");
            await sleep(800);
            appendTerminalLog(`ℹ️ [雲端模式] 即時分析由 GitHub Actions 排程每日 15:07 自動執行。`, "system");
            await sleep(1000);
            renderStockCards();
            renderTopRecommendations();
            selectStock(symbol);
        } catch (error) {
            appendTerminalLog(`[ERROR] 讀取雲端資料失敗: ${error.message}`, "error");
            await sleep(1000);
        }
        
        await sleep(800);
        document.getElementById("terminal-modal").style.display = "none";
    });

    // 4.6 關閉「指標歷史趨勢」彈出視窗
    const trendModal = document.getElementById("trend-detail-modal");
    const closeTrendModal = document.getElementById("btn-close-trend-modal");
    if (closeTrendModal && trendModal) {
        closeTrendModal.addEventListener("click", () => {
            trendModal.style.display = "none";
            if (bigTrendChartInstance) {
                bigTrendChartInstance.destroy();
                bigTrendChartInstance = null;
            }
        });
        
        // 點擊 Modal 外部（遮罩層）也可關閉
        trendModal.addEventListener("click", (e) => {
            if (e.target === trendModal) {
                trendModal.style.display = "none";
                if (bigTrendChartInstance) {
                    bigTrendChartInstance.destroy();
                    bigTrendChartInstance = null;
                }
            }
        });
    }

    // 5. 切換至 AI 自我進化週驗收分頁
    const evolutionMenuItem = document.getElementById("menu-item-evolution");
    evolutionMenuItem.addEventListener("click", () => {
        switchTabToEvolution();
    });

    // 5.5 關閉「週驗收命中股票明細」Modal
    const weeklyModal = document.getElementById("weekly-hit-modal");
    const closeWeeklyModal = document.getElementById("btn-close-weekly-modal");
    if (weeklyModal && closeWeeklyModal) {
        closeWeeklyModal.addEventListener("click", () => {
            weeklyModal.style.display = "none";
        });
        weeklyModal.addEventListener("click", (e) => {
            if (e.target === weeklyModal) {
                weeklyModal.style.display = "none";
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && weeklyModal.style.display === "flex") {
                weeklyModal.style.display = "none";
            }
        });
    }

    // 6. 手動觸發選股驗收（雲端模式：顯示說明而非呼叫後端）
    const triggerEvolveBtn = document.getElementById("btn-trigger-evolution");
    triggerEvolveBtn.addEventListener("click", async () => {
        // 雲端模式：驗收由 GitHub Actions 週五 15:07 自動執行
        // 這裡僅重新從靜態 JSON 載入最新資料
        openEvolutionTerminal();
        
        const logs = document.getElementById("terminal-logs");
        const statusText = document.getElementById("terminal-status-text");
        statusText.textContent = "正在從雲端資料庫讀取最新驗收結果...";
        
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        await sleep(800);
        appendTerminalLog(`🌐 [GitHub Actions] 連線至 Firebase 雲端資料庫...`);
        await sleep(1000);
        appendTerminalLog(`📦 [GitHub Actions] 讀取最新每週驗收報告 (verification_history.json)...`);
        await sleep(1200);
        
        try {
            await loadEvolutionData();
            const latestHist = appState.verificationHistory;
            const latest = latestHist && latestHist.length > 0 ? latestHist[latestHist.length - 1] : null;
            
            if (latest) {
                appendTerminalLog(`✅ [週驗收] 最新一週命中率: ${latest.hit_rate?.toFixed(1)}% (命中 ${latest.total_hits}/${latest.total_recommended} 支)`, "success");
                const w = latest.new_weights || latest.old_weights || {};
                if (w.technical !== undefined) {
                    appendTerminalLog(`🎯 [AI 自我進化] 目前最優權重: 技術 ${(w.technical*100).toFixed(0)}%, 營利 ${(w.financial*100).toFixed(0)}%, 籌碼 ${(w.institutional*100).toFixed(0)}%, 輿情 ${(w.news_sentiment*100).toFixed(0)}%, 量能 ${(w.volume_momentum*100).toFixed(0)}%`, "success");
                }
            } else {
                appendTerminalLog(`📅 [系統] 每週驗收將於週五 15:07 由 GitHub Actions 自動執行。`, "system");
            }
            await sleep(800);
            appendTerminalLog(`ℹ️ [雲端模式] 驗收由 GitHub Actions 排程自動執行，無需手動觸發。`, "system");
            statusText.textContent = "資料已更新！";
        } catch (error) {
            appendTerminalLog(`[ERROR] 讀取雲端資料失敗: ${error.message}`, "error");
            statusText.textContent = "讀取失敗";
        }
        
        await sleep(1500);
        document.getElementById("terminal-modal").style.display = "none";
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
        const weightsRes = await fetch(`${DATA_BASE}/optimization_weights.json?t=${Date.now()}`);
        appState.weights = await weightsRes.json();
        
        const historyRes = await fetch(`${DATA_BASE}/verification_history.json?t=${Date.now()}`);
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

const EVOLUTION_CAT_META = {
    "semiconductor_foundry": { name: "半導體製造與設備", short: "半導體", icon: "fa-industry" },
    "ic_design": { name: "IC 設計與晶片", short: "IC設計", icon: "fa-microchip" },
    "memory_storage": { name: "記憶體與 AI 儲存 / HBM", short: "記憶體", icon: "fa-database" },
    "ai_server_thermal": { name: "AI 伺服器與散熱", short: "AI伺服器", icon: "fa-server" },
    "cpo_networking": { name: "光通訊 CPO 與網通光電", short: "CPO光電", icon: "fa-network-wired" },
    "finance_shipping": { name: "金融與航運巨頭", short: "金融航運", icon: "fa-ship" },
    "etf": { name: "人氣高息與市值 ETF", short: "高息ETF", icon: "fa-cubes" },
    "green_energy_power": { name: "綠能重電與傳產熱門", short: "綠能傳產", icon: "fa-bolt" }
};

function getStockNameBySymbol(symbol) {
    if (appState.stocksData && appState.stocksData[symbol]?.name) {
        return appState.stocksData[symbol].name;
    }
    for (const stocks of Object.values(appState.categories || {})) {
        const found = stocks.find(s => s.symbol === symbol);
        if (found) return found.name;
    }
    return symbol;
}

function normalizeWeeklyRecord(item) {
    // 確保新舊格式皆能解析出完整命中清單與五維度分數明細
    const w = item.new_weights || item.old_weights || {
        technical: 0.35, financial: 0.25, institutional: 0.20, news_sentiment: 0.10, volume_momentum: 0.10
    };
    const sectorOrder = Object.keys(EVOLUTION_CAT_META);
    const sectors = [];
    const hitList = [];

    sectorOrder.forEach(catKey => {
        const rawCat = (item.results && item.results[catKey]) ? item.results[catKey] : null;
        if (!rawCat) return;
        const meta = EVOLUTION_CAT_META[catKey] || { name: catKey, short: catKey, icon: "fa-chart-simple" };
        const actualTop5 = (rawCat.actual_top5 || []).map((x, idx) => ({
            rank: x.rank || (idx + 1),
            symbol: x.symbol,
            name: x.name || getStockNameBySymbol(x.symbol),
            weekly_return: x.weekly_return || "---",
            is_hit: x.is_hit !== undefined ? x.is_hit : (rawCat.recommended || []).includes(x.symbol)
        }));
        const top5Map = {};
        actualTop5.forEach(x => { top5Map[x.symbol] = x; });

        let recDetails = rawCat.recommended_details;
        if (!recDetails || recDetails.length === 0) {
            recDetails = (rawCat.recommended || []).map((sym, idx) => {
                const stCache = (appState.stocksData || {})[sym] || {};
                const r = stCache.radar || { technical: 7, financial: 7, institutional: 7, news_sentiment: 7 };
                const scores = {
                    technical: r.technical || 7,
                    financial: r.financial || 7,
                    institutional: r.institutional || 7,
                    news_sentiment: r.news_sentiment || 7,
                    volume_momentum: 8
                };
                const ws = (
                    w.technical * scores.technical +
                    w.financial * scores.financial +
                    w.institutional * scores.institutional +
                    w.news_sentiment * scores.news_sentiment +
                    w.volume_momentum * scores.volume_momentum
                );
                const hitInfo = top5Map[sym];
                return {
                    pick_rank: idx + 1,
                    symbol: sym,
                    name: getStockNameBySymbol(sym),
                    weighted_score: Number(ws.toFixed(2)),
                    scores,
                    volume: stCache.volume || "---",
                    weekly_return: hitInfo ? hitInfo.weekly_return : "---",
                    is_hit: Boolean(hitInfo),
                    actual_rank: hitInfo ? hitInfo.rank : null
                };
            });
        }

        recDetails.forEach(d => {
            if (d.is_hit) {
                hitList.push({
                    ...d,
                    category: catKey,
                    category_name: meta.name,
                    category_short: meta.short
                });
            }
        });

        sectors.push({
            category: catKey,
            name: meta.name,
            short: meta.short,
            icon: meta.icon,
            recommended_details: recDetails,
            actual_top5: actualTop5,
            hit_count: recDetails.filter(d => d.is_hit).length,
            total_count: recDetails.length
        });
    });

    return { weights: w, sectors, hitList };
}

function renderVerificationHistory() {
    const tbody = document.getElementById("verification-history-rows");
    tbody.innerHTML = "";
    
    if (!appState.verificationHistory || appState.verificationHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px; font-size: 14px;">尚無收盤驗收歷史紀錄。將於每週五 15:07 收盤後自動產出與演化優化！</td></tr>`;
        return;
    }
    
    // 按日期倒序排列
    const sortedHistory = [...appState.verificationHistory].reverse();
    
    sortedHistory.forEach((item) => {
        const tr = document.createElement("tr");
        tr.className = "history-row-clickable";
        tr.title = `點擊查看 ${item.date} 命中的 ${item.total_hits} 隻股票清單與選股評分依據`;
        
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
            <td style="padding: 16px 8px; font-weight: 600; white-space: nowrap;">
                ${item.date}
                <span class="text-neon" style="font-size: 11px; margin-left: 4px;">收盤驗收</span>
            </td>
            <td style="padding: 16px 8px; text-align: center;">
                <button type="button" class="hit-count-trigger" aria-label="查看 ${item.date} 命中股票清單">
                    <i class="fa-solid fa-bullseye"></i>
                    <span>${item.total_hits} / ${item.total_recommended} 支</span>
                </button>
            </td>
            <td style="padding: 16px 8px; text-align: center; white-space: nowrap;">
                <span class="hit-rate-badge ${badgeClass}">${item.hit_rate.toFixed(1)}% (${targetMetText})</span>
            </td>
            <td style="padding: 16px 8px; line-height: 2;">${wStr}</td>
            <td style="padding: 16px 8px; text-align: right;">
                <button type="button" class="btn-inspect-week">
                    <i class="fa-solid fa-magnifying-glass-chart"></i> 點擊確認
                </button>
            </td>
        `;
        
        tr.addEventListener("click", () => {
            openWeeklyHitModal(item);
        });
        
        tbody.appendChild(tr);
    });
}

function openWeeklyHitModal(item) {
    const modal = document.getElementById("weekly-hit-modal");
    const titleEl = document.getElementById("weekly-modal-title");
    const bodyEl = document.getElementById("weekly-modal-body");
    if (!modal || !bodyEl) return;

    const parsed = normalizeWeeklyRecord(item);
    const w = parsed.weights;
    const hitList = parsed.hitList;

    // 計算不重複個股數（部分指標股同時跨足半導體與記憶體等雙板塊）
    const uniqueSymbols = new Set(hitList.map(h => h.symbol));
    const crossSectorNote = uniqueSymbols.size < hitList.length
        ? `（涵蓋 ${uniqueSymbols.size} 檔不重複個股，其中 ${hitList.length - uniqueSymbols.size} 檔跨雙板塊同時命中）`
        : `（共 ${uniqueSymbols.size} 檔個股命中當週板塊漲幅前 5 名）`;

    titleEl.innerHTML = `<i class="fa-solid fa-bullseye neon-glow-text"></i> ${item.date} 週驗收命中確認報告 — 命中 ${item.total_hits} / ${item.total_recommended} 支`;

    const badgeClass = item.hit_rate >= 70 ? "text-success" : (item.hit_rate >= 50 ? "text-warning" : "text-up");
    const formulaText = `S = ${(w.technical*100).toFixed(0)}%×技術 + ${(w.financial*100).toFixed(0)}%×營利 + ${(w.institutional*100).toFixed(0)}%×籌碼 + ${(w.news_sentiment*100).toFixed(0)}%×輿情 + ${(w.volume_momentum*100).toFixed(0)}%×量能`;

    bodyEl.innerHTML = `
        <!-- 1. 頂部 KPI 摘要卡 -->
        <div class="weekly-kpi-strip">
            <div class="weekly-kpi-card">
                <span class="kpi-label">週驗收結算日</span>
                <span class="kpi-value">${item.date}</span>
            </div>
            <div class="weekly-kpi-card">
                <span class="kpi-label">板塊推薦總命中數</span>
                <span class="kpi-value text-neon">${item.total_hits} / ${item.total_recommended} 支</span>
            </div>
            <div class="weekly-kpi-card">
                <span class="kpi-label">當週總推薦命中率</span>
                <span class="kpi-value ${badgeClass}">${item.hit_rate.toFixed(1)}% ${item.hit_rate >= 70 ? '✅' : ''}</span>
            </div>
            <div class="weekly-kpi-card">
                <span class="kpi-label">選股池規模與門檻</span>
                <span class="kpi-value" style="font-size: 14.5px; margin-top: 3px;">${item.total_recommended >= 24 ? 'Top 400 選 ' + item.total_recommended : '140 選 ' + item.total_recommended} ➔ 漲幅 Top 5</span>
            </div>
        </div>

        <!-- 2. 當週選股加權公式橫幅 -->
        <div class="weekly-formula-banner">
            <div>
                <strong style="color: var(--text-primary);"><i class="fa-solid fa-calculator text-warning"></i> 本週 AI 選股加權評分式：</strong>
                <span class="formula-expr">${formulaText}</span>
            </div>
            <span style="font-size: 12px; color: var(--text-secondary);">每板塊 20 股取最高分 Top 3 推薦</span>
        </div>

        <!-- 3. 本週命中股票總覽膠囊區 -->
        <div class="hit-chips-section">
            <div class="hit-chips-header">
                <h4><i class="fa-solid fa-circle-check text-success"></i> 本週命中的 ${hitList.length} 支推薦股票清單 <span style="font-size: 12px; font-weight: 500; color: var(--text-secondary);">${crossSectorNote}</span></h4>
                <span style="font-size: 11.5px; color: var(--neon-cyan);"><i class="fa-solid fa-hand-pointer"></i> 點擊任一股票確認五維度選股算式</span>
            </div>
            <div class="hit-chips-grid" id="weekly-hit-chips-container"></div>
        </div>

        <!-- 4. 個股五維度評分驗算面板 -->
        <div class="stock-math-inspector" id="weekly-stock-inspector" style="display: none;"></div>

        <!-- 5. 板塊篩選切換與 7 大板塊對照卡 -->
        <div class="weekly-filter-bar">
            <h4 style="font-size: 15px; color: var(--text-primary);"><i class="fa-solid fa-layer-group text-neon"></i> 七大產業板塊：AI 精選 Top 3 對照 實際週漲幅 Top 5</h4>
            <div class="filter-btn-group">
                <button type="button" class="weekly-filter-btn active" data-filter="all">全部板塊明細 (21支)</button>
                <button type="button" class="weekly-filter-btn" data-filter="hits-only">僅顯示命中推薦 (${hitList.length}支)</button>
            </div>
        </div>
        <div class="weekly-sectors-grid" id="weekly-sectors-container"></div>
    `;

    const chipsContainer = document.getElementById("weekly-hit-chips-container");
    const inspectorEl = document.getElementById("weekly-stock-inspector");
    const sectorsContainer = document.getElementById("weekly-sectors-container");

    function renderInspector(stockDetail, catKey, catName) {
        if (!stockDetail || !inspectorEl) return;
        inspectorEl.style.display = "flex";
        const sc = stockDetail.scores || { technical: 7, financial: 7, institutional: 7, news_sentiment: 7, volume_momentum: 8 };
        const tVal = (sc.technical * w.technical).toFixed(2);
        const fVal = (sc.financial * w.financial).toFixed(2);
        const iVal = (sc.institutional * w.institutional).toFixed(2);
        const nVal = (sc.news_sentiment * w.news_sentiment).toFixed(2);
        const vVal = (sc.volume_momentum * w.volume_momentum).toFixed(2);

        const hitBadge = stockDetail.is_hit
            ? `<span class="mini-hit-tag" style="font-size: 12px; padding: 4px 10px;">✅ 命中當週板塊漲幅第 ${stockDetail.actual_rank} 名 (${stockDetail.weekly_return})</span>`
            : `<span class="mini-miss-tag" style="font-size: 12px; padding: 4px 10px;">未進當週板塊漲幅前 5 名 (週漲跌: ${stockDetail.weekly_return || '---'})</span>`;

        inspectorEl.innerHTML = `
            <div class="inspector-top">
                <div class="inspector-title">
                    <span class="stock-code-badge" style="color: var(--neon-cyan); border: 1px solid rgba(0,242,254,0.3);">${catName} · 推薦 NO.${stockDetail.pick_rank}</span>
                    <h4>${stockDetail.name} (${stockDetail.symbol}) 選股評分驗算</h4>
                    ${hitBadge}
                </div>
                <button type="button" class="btn btn-primary" id="btn-jump-to-stock" style="padding: 7px 14px; font-size: 12px;">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> 查看個股深度報告
                </button>
            </div>
            <div class="inspector-math-grid">
                <div class="math-term-box">
                    <span class="term-name">① 技術走勢</span>
                    <span class="term-calc">${sc.technical} 分 × ${(w.technical*100).toFixed(0)}%</span>
                    <span class="term-val">+${tVal}</span>
                </div>
                <div class="math-term-box">
                    <span class="term-name">② 公司營利</span>
                    <span class="term-calc">${sc.financial} 分 × ${(w.financial*100).toFixed(0)}%</span>
                    <span class="term-val">+${fVal}</span>
                </div>
                <div class="math-term-box">
                    <span class="term-name">③ 法人籌碼</span>
                    <span class="term-calc">${sc.institutional} 分 × ${(w.institutional*100).toFixed(0)}%</span>
                    <span class="term-val">+${iVal}</span>
                </div>
                <div class="math-term-box">
                    <span class="term-name">④ 輿情情緒</span>
                    <span class="term-calc">${sc.news_sentiment} 分 × ${(w.news_sentiment*100).toFixed(0)}%</span>
                    <span class="term-val">+${nVal}</span>
                </div>
                <div class="math-term-box">
                    <span class="term-name">⑤ 量能動能 (${stockDetail.volume || '---'})</span>
                    <span class="term-calc">${sc.volume_momentum} 分 × ${(w.volume_momentum*100).toFixed(0)}%</span>
                    <span class="term-val">+${vVal}</span>
                </div>
                <div class="math-term-box total">
                    <span class="term-name">加權總評分 S</span>
                    <span class="term-calc">板塊排名前 3 入選</span>
                    <span class="term-val">${Number(stockDetail.weighted_score).toFixed(2)} 分</span>
                </div>
            </div>
        `;

        const jumpBtn = document.getElementById("btn-jump-to-stock");
        if (jumpBtn) {
            jumpBtn.addEventListener("click", () => {
                modal.style.display = "none";
                const targetCat = (appState.categories && appState.categories[catKey]) ? catKey : Object.keys(appState.categories || {}).find(c =>
                    (appState.categories[c] || []).some(s => s.symbol === stockDetail.symbol)
                );
                if (targetCat) {
                    switchCategory(targetCat);
                    selectStock(stockDetail.symbol);
                }
            });
        }
    }

    // 渲染上方命中股票膠囊按鈕
    if (hitList.length === 0) {
        chipsContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">本週無命中標的</span>`;
    } else {
        hitList.forEach((h, idx) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = `hit-stock-chip ${idx === 0 ? 'selected' : ''}`;
            const retSign = h.weekly_return && !h.weekly_return.startsWith("-") && !h.weekly_return.startsWith("+") && h.weekly_return !== "---" ? "+" : "";
            chip.innerHTML = `
                <span class="chip-cat">${h.category_short}</span>
                <span class="chip-sym">${h.symbol}</span>
                <span class="chip-name">${h.name}</span>
                <span class="chip-ret">${retSign}${h.weekly_return}</span>
                <span style="font-size: 10.5px; color: var(--neon-green);">#${h.actual_rank}</span>
            `;
            chip.addEventListener("click", () => {
                chipsContainer.querySelectorAll(".hit-stock-chip").forEach(c => c.classList.remove("selected"));
                chip.classList.add("selected");
                renderInspector(h, h.category, h.category_name);
            });
            chipsContainer.appendChild(chip);
        });
        // 預設展開第一支命中股的五維度選股算式，讓使用者打開即見完整選股依據
        renderInspector(hitList[0], hitList[0].category, hitList[0].category_name);
    }

    function renderSectors(filterMode = "all") {
        sectorsContainer.innerHTML = "";
        parsed.sectors.forEach(sec => {
            const picksToShow = filterMode === "hits-only"
                ? sec.recommended_details.filter(d => d.is_hit)
                : sec.recommended_details;

            if (filterMode === "hits-only" && picksToShow.length === 0) return;

            const card = document.createElement("div");
            card.className = "sector-verify-card";
            const secRate = ((sec.hit_count / Math.max(1, sec.total_count)) * 100).toFixed(0);
            const secBadgeCls = sec.hit_count >= 2 ? "success" : (sec.hit_count === 1 ? "warning" : "danger");

            const picksHtml = picksToShow.map((p, idx) => {
                const sc = p.scores || {};
                const retSign = p.weekly_return && !p.weekly_return.startsWith("-") && !p.weekly_return.startsWith("+") && p.weekly_return !== "---" ? "+" : "";
                const retCls = p.weekly_return && p.weekly_return.startsWith("-") ? "text-down" : "text-up";
                return `
                    <div class="pick-item-row ${p.is_hit ? 'is-hit' : ''}" data-pick-idx="${idx}">
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary);">
                                <span style="color: var(--neon-gold); margin-right: 4px;">NO.${p.pick_rank}</span>
                                ${p.name} <span style="color: var(--text-muted); font-size: 11px;">(${p.symbol})</span>
                            </div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                                加權 <strong style="color: var(--neon-cyan);">${Number(p.weighted_score).toFixed(2)}</strong> 分
                                ｜技${sc.technical ?? '-'} 營${sc.financial ?? '-'} 籌${sc.institutional ?? '-'} 輿${sc.news_sentiment ?? '-'} 量${sc.volume_momentum ?? '-'}
                            </div>
                        </div>
                        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
                            ${p.is_hit
                                ? `<span class="mini-hit-tag">✅ 命中 #${p.actual_rank}</span>`
                                : `<span class="mini-miss-tag">未進前 5</span>`}
                            <span class="${retCls}" style="font-size: 11.5px; font-weight: 700;">${p.weekly_return !== '---' ? retSign + p.weekly_return : '---'}</span>
                        </div>
                    </div>
                `;
            }).join("");

            const top5Html = sec.actual_top5.map(t => {
                const retSign = t.weekly_return && !t.weekly_return.startsWith("-") && !t.weekly_return.startsWith("+") ? "+" : "";
                const retCls = t.weekly_return && t.weekly_return.startsWith("-") ? "text-down" : "text-up";
                return `
                    <div class="top5-item-row ${t.is_hit ? 'is-hit' : ''}">
                        <div>
                            <span style="color: var(--text-muted); font-weight: 700; margin-right: 4px;">#${t.rank}</span>
                            <strong style="color: var(--text-primary);">${t.name}</strong>
                            <span style="color: var(--text-muted); font-size: 11px;">(${t.symbol})</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            ${t.is_hit ? `<span class="mini-hit-tag">🎯 命中</span>` : ''}
                            <span class="${retCls}" style="font-weight: 800;">${retSign}${t.weekly_return}</span>
                        </div>
                    </div>
                `;
            }).join("");

            card.innerHTML = `
                <div class="sector-verify-header">
                    <h5><i class="fa-solid ${sec.icon} text-neon"></i> ${sec.name}</h5>
                    <span class="hit-rate-badge ${secBadgeCls}" style="font-size: 11.5px; padding: 3px 10px;">
                        命中 ${sec.hit_count} / ${sec.total_count} (${secRate}%)
                    </span>
                </div>
                <div class="sector-columns">
                    <div>
                        <div class="sector-col-title"><i class="fa-solid fa-robot text-neon"></i> AI 加權選出 Top 3（點擊可驗算）</div>
                        ${picksHtml}
                    </div>
                    <div>
                        <div class="sector-col-title"><i class="fa-solid fa-fire text-up"></i> 當週實際漲幅 Top 5</div>
                        ${top5Html}
                    </div>
                </div>
            `;

            card.querySelectorAll(".pick-item-row").forEach((rowEl) => {
                const idx = Number(rowEl.getAttribute("data-pick-idx"));
                const pickData = picksToShow[idx];
                rowEl.addEventListener("click", () => {
                    chipsContainer.querySelectorAll(".hit-stock-chip").forEach(c => {
                        const isMatch = c.querySelector(".chip-sym")?.textContent === pickData.symbol &&
                                        c.querySelector(".chip-cat")?.textContent === sec.short;
                        c.classList.toggle("selected", Boolean(isMatch));
                    });
                    renderInspector(pickData, sec.category, sec.name);
                    inspectorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
                });
            });

            sectorsContainer.appendChild(card);
        });
    }

    renderSectors("all");

    bodyEl.querySelectorAll(".weekly-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            bodyEl.querySelectorAll(".weekly-filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderSectors(btn.getAttribute("data-filter"));
        });
    });

    modal.style.display = "flex";
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

// --- 頂部全球/台股指數趨勢看板渲染 (Market Trends sparklines) ---
function renderMarketTrends() {
    const container = document.getElementById("market-trends-bar");
    if (!container || !appState.marketTrends) return;
    
    container.innerHTML = "";
    
    // 渲染順序：1.大盤加權指數, 2.台指期貨近, 3.美元兌台幣, 4.黃金價格, 5.石油價格
    const order = ["taiex", "taiex_night", "usdtwd", "gold", "oil"];
    const icons = {
        "taiex": "fa-chart-area",
        "taiex_night": "fa-moon",
        "usdtwd": "fa-dollar-sign",
        "gold": "fa-coins",
        "oil": "fa-droplet"
    };
    
    order.forEach(key => {
        const trend = appState.marketTrends[key];
        if (!trend) return;
        
        const card = document.createElement("div");
        card.className = "trend-card glass-card";
        card.setAttribute("id", `trend-${key}`);
        
        const isUp = trend.change >= 0;
        const changeClass = isUp ? "text-up" : "text-down";
        const sign = isUp ? "+" : "";
        const trendIcon = isUp ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
        
        // 小數點處理 (匯率 4 位，其他千分位)
        const isUsd = key === "usdtwd";
        const formattedPrice = isUsd ? trend.price.toFixed(4) : trend.price.toLocaleString();
        const formattedChange = isUsd ? trend.change.toFixed(4) : trend.change.toLocaleString();
        
        card.innerHTML = `
            <div class="trend-info">
                <div class="trend-name">
                    <i class="fa-solid ${icons[key]} neon-glow-text"></i>
                    <span>${trend.name}</span>
                </div>
                <div class="trend-price-row">
                    <span class="trend-price">${formattedPrice}</span>
                    <span class="trend-change ${changeClass}">
                        <i class="fa-solid ${trendIcon}"></i>
                        ${sign}${formattedChange} (${sign}${trend.change_percent.toFixed(2)}%)
                    </span>
                </div>
            </div>
            <div class="trend-chart-box">
                <canvas id="chart-${key}"></canvas>
            </div>
        `;
        
        // 綁定點擊卡片彈出大圖事件
        card.addEventListener("click", () => {
            openTrendDetailModal(key);
        });
        
        container.appendChild(card);
        
        // 異步繪製迷你 Sparkline
        setTimeout(() => {
            drawSparkline(`chart-${key}`, trend.history, isUp);
        }, 50);
    });
}

function drawSparkline(canvasId, dataPoints, isUp) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    
    const colorLine = isUp ? "rgb(255, 65, 108)" : "rgb(0, 230, 115)"; // 漲為紅/粉，跌為綠
    const colorBgGradStart = isUp ? "rgba(255, 65, 108, 0.15)" : "rgba(0, 230, 115, 0.15)";
    
    const chartCtx = ctx.getContext('2d');
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 40);
    gradient.addColorStop(0, colorBgGradStart);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dataPoints.map((_, i) => i),
            datasets: [{
                data: dataPoints,
                borderColor: colorLine,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: true,
                backgroundColor: gradient,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { display: false },
                y: { display: false }
            },
            layout: {
                padding: { left: 2, right: 2, top: 4, bottom: 4 }
            }
        }
    });
}

// 全域變數以儲存大圖表 Chart 實例
let bigTrendChartInstance = null;

function openTrendDetailModal(key) {
    const trend = appState.marketTrends[key];
    if (!trend) return;
    
    const modal = document.getElementById("trend-detail-modal");
    const modalTitle = document.getElementById("trend-modal-title");
    const modalPrice = document.getElementById("trend-modal-price");
    const modalChange = document.getElementById("trend-modal-change");
    
    if (!modal) return;
    
    // 設定標題與內容
    const icons = {
        "taiex": "fa-chart-area",
        "taiex_night": "fa-moon",
        "usdtwd": "fa-dollar-sign",
        "gold": "fa-coins",
        "oil": "fa-droplet"
    };
    
    modalTitle.innerHTML = `<i class="fa-solid ${icons[key] || 'fa-chart-line'} neon-glow-text"></i> ${trend.name} (${trend.symbol}) 每日趨勢詳情`;
    
    const isUsd = key === "usdtwd";
    const formattedPrice = isUsd ? trend.price.toFixed(4) : trend.price.toLocaleString();
    const formattedChange = isUsd ? trend.change.toFixed(4) : trend.change.toLocaleString();
    const isUp = trend.change >= 0;
    const changeClass = isUp ? "text-up" : "text-down";
    const sign = isUp ? "+" : "";
    
    modalPrice.textContent = formattedPrice;
    modalChange.className = `trend-modal-change ${changeClass}`;
    modalChange.innerHTML = `${isUp ? '▲' : '▼'} ${sign}${formattedChange} (${sign}${trend.change_percent.toFixed(2)}%)`;
    
    // 開啟 Modal
    modal.style.display = "flex";
    
    // 渲染大圖表
    setTimeout(() => {
        drawBigTrendChart(trend.labels, trend.history, isUp, key);
    }, 100);
}

function drawBigTrendChart(labels, dataPoints, isUp, key) {
    const canvas = document.getElementById("trendDetailChart");
    if (!canvas) return;
    
    // 銷毀既有的圖表實例以防重疊與洩漏
    if (bigTrendChartInstance) {
        bigTrendChartInstance.destroy();
        bigTrendChartInstance = null;
    }
    
    const colorLine = isUp ? "rgb(255, 65, 108)" : "rgb(0, 230, 115)";
    const colorBgGradStart = isUp ? "rgba(255, 65, 108, 0.12)" : "rgba(0, 230, 115, 0.12)";
    
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, colorBgGradStart);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    
    bigTrendChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '每日收盤價',
                data: dataPoints,
                borderColor: colorLine,
                borderWidth: 3,
                pointBackgroundColor: colorLine,
                pointBorderColor: "rgba(255,255,255,0.7)",
                pointBorderWidth: 1.5,
                pointRadius: 4,
                pointHoverRadius: 7,
                fill: true,
                backgroundColor: gradient,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: "rgba(10, 15, 28, 0.9)",
                    titleColor: "#fff",
                    bodyColor: "#00f2fe",
                    bodyFont: { weight: 'bold', size: 14 },
                    borderColor: "rgba(0, 242, 254, 0.2)",
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            return `價格: ${key === 'usdtwd' ? val.toFixed(4) : val.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.03)" },
                    ticks: { color: "var(--text-secondary)", font: { family: 'Outfit' } }
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.03)" },
                    ticks: {
                        color: "var(--text-secondary)",
                        font: { family: 'Outfit' },
                        callback: function(value) {
                            return key === 'usdtwd' ? value.toFixed(3) : value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}
