"""
market_funnel.py
================
免金鑰 TWSE (證交所) + TPEx (櫃買中心) 全市場熱門股三層漏斗引擎：
- L1 全市場廣度掃描 (0 Token, 免費官方 OpenAPI, <6 秒掃描上市櫃 ~2,200 檔)
- L2 熱門股池篩選與冷熱快取量化評估 (預設鎖定成交量 + 成交值雙指標 Top 400 熱門股)
- L3 各板塊 Top 5 批次新聞採集與 Gemini Batch Prompt 精析 (每日僅需 ~8 次 API 呼叫)
"""

import os
import re
import json
import datetime
import urllib3
import requests
from concurrent.futures import ThreadPoolExecutor

urllib3.disable_warnings()

DYNAMIC_CATEGORIES_FILE = "dynamic_categories.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

SECTOR_LABELS = {
    "semiconductor_foundry": "半導體製造與設備",
    "ic_design": "IC 設計與晶片",
    "memory_storage": "記憶體與 AI 儲存 / HBM",
    "ai_server_thermal": "AI 伺服器與散熱",
    "cpo_networking": "光通訊 CPO 與網通光電",
    "finance_shipping": "金融與航運巨頭",
    "etf": "人氣高息與市值 ETF",
    "green_energy_power": "綠能重電與傳產熱門",
}

# 細分半導體子領域關鍵字（區分 IC 設計 / 記憶體儲存 / 晶圓封測設備）
IC_DESIGN_KEYWORDS = (
    "聯發科", "聯詠", "瑞昱", "創意", "世芯", "力旺", "矽力", "智原", "威盛", "驊訊",
    "新唐", "天鈺", "矽創", "敦泰", "原相", "創惟", "盛群", "信驊", "祥碩", "譜瑞",
    "愛普", "神盾", "義隆", "致新", "茂達", "钰太", "鈺太", "晶心科", "M31", "巨有",
    "凌陽", "偉詮電", "通嘉", "松翰", "笙科", "九齊", "杰力", "富鼎", "大中", "尼克森",
    "威鋒", "安國", "芯鼎", "揚智", "太欣", "沛亨", "矽統", "聯傑", "亞信", "達發"
)

MEMORY_STORAGE_KEYWORDS = (
    "南亞科", "華邦電", "旺宏", "群聯", "威剛", "十銓", "創見", "宜鼎", "力成", "至上",
    "鈺創", "晶豪科", "欣興", "南電", "景碩", "同欣電", "宇瞻", "品安", "商丞", "點序",
    "廣穎", "華東", "福懋科", "南茂"
)

CPO_OPTICAL_KEYWORDS = (
    "智邦", "上詮", "波若威", "華星光", "光聖", "聯亞", "聯鈞", "眾達", "前鼎", "光環",
    "統新", "東典", "創威", "正基", "中磊", "啟碁", "神準", "明泰", "正文", "合勤控",
    "昇達科", "台揚", "建漢", "仲琦", "耀登", "全新", "穩懋", "宏捷科", "環宇", "IET",
    "大立光", "玉晶光", "亞光", "佳能", "今國光", "先進光", "中光電", "友達", "群創", "彩晶"
)


def _safe_float(val, default=None):
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(",", "").replace("+", "").replace("%", "")
    if not s or s in ("---", "--", "-", "N/A", "nan", "None"):
        return default
    try:
        return float(s)
    except Exception:
        return default


def _safe_int(val, default=0):
    f = _safe_float(val, None)
    return int(round(f)) if f is not None else default


def _is_valid_tw_symbol(code: str) -> bool:
    """
    僅保留標準 4 碼上市櫃普通股 (1101~9999) 與原型/槓反/主動型 ETF (00xxxx)，
    自動排除 6 碼認購售權證 (03~08xxxx, 7xxxxx)、可轉債與 TDR。
    """
    if not code:
        return False
    code = code.strip()
    return bool(re.match(r"^([1-9]\d{3}|00\d{2,4}[A-Z]?)$", code))


def fetch_twse_tpex_snapshot() -> dict:
    """
    並行擷取證交所 (TWSE) 與櫃買中心 (TPEx) 8 張官方免費公開總表。
    回傳 dict: symbol -> 統一結構化行情、三大法人籌碼、估值與產業代碼。
    """
    urls = {
        "twse_day": "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        "twse_pe": "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
        "twse_info": "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
        "twse_inst": "https://www.twse.com.tw/rwd/zh/fund/T86?selectType=ALLBUT0999&response=json",
        "tpex_day": "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
        "tpex_pe": "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis",
        "tpex_info": "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
        "tpex_inst": "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&id=&response=json",
    }

    def _get_json(item):
        key, url = item
        try:
            r = requests.get(url, headers=HEADERS, timeout=10, verify=False)
            if r.status_code == 200:
                return key, r.json()
        except Exception as e:
            print(f"⚠️ [L1 漏斗] 讀取 {key} 異常: {e}")
        return key, None

    print("🚀 [L1 全市場掃描] 正在並行擷取證交所 TWSE 與櫃買 TPEx 官方免費公開總表...")
    raw_map = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        for k, data in executor.map(_get_json, urls.items()):
            raw_map[k] = data

    universe = {}

    # 1. 解析上市每日收盤行情 (TWSE STOCK_DAY_ALL)
    for row in (raw_map.get("twse_day") or []):
        code = str(row.get("Code", "")).strip()
        if not _is_valid_tw_symbol(code):
            continue
        close_p = _safe_float(row.get("ClosingPrice"))
        if close_p is None or close_p <= 0:
            continue
        vol_shares = _safe_int(row.get("TradeVolume"), 0)
        trade_val = _safe_float(row.get("TradeValue"), 0.0) or 0.0
        trans = _safe_int(row.get("Transaction"), 0)
        raw_chg_str = str(row.get("Change", "0")).strip()
        chg = _safe_float(raw_chg_str, 0.0) or 0.0
        if "-" in raw_chg_str and chg > 0:
            chg = -chg
        prev_p = close_p - chg
        chg_pct = (chg / prev_p * 100.0) if prev_p > 0 else 0.0

        universe[code] = {
            "symbol": code,
            "name": str(row.get("Name", code)).strip(),
            "market": "TWSE",
            "price_num": close_p,
            "change_num": round(chg, 2),
            "change_pct_num": round(chg_pct, 2),
            "open_num": _safe_float(row.get("OpeningPrice"), close_p),
            "high_num": _safe_float(row.get("HighestPrice"), close_p),
            "low_num": _safe_float(row.get("LowestPrice"), close_p),
            "volume_shares": vol_shares,
            "volume_units": round(vol_shares / 1000.0, 1),
            "trade_value": trade_val,
            "transactions_num": trans,
            "industry_code": "",
            "pe": None,
            "pb": None,
            "dividend_yield": None,
            "foreign_net_lots": 0,
            "trust_net_lots": 0,
            "dealer_net_lots": 0,
            "inst_total_lots": 0,
        }

    # 2. 解析上櫃每日收盤行情 (TPEx Daily Close)
    for row in (raw_map.get("tpex_day") or []):
        code = str(row.get("SecuritiesCompanyCode", "")).strip()
        if not _is_valid_tw_symbol(code) or code in universe:
            continue
        close_p = _safe_float(row.get("Close"))
        if close_p is None or close_p <= 0:
            continue
        vol_shares = _safe_int(row.get("TradingShares"), 0)
        trade_val = _safe_float(row.get("TransactionAmount"), 0.0) or 0.0
        trans = _safe_int(row.get("TransactionNumber"), 0)
        raw_chg_str = str(row.get("Change", "0")).strip()
        chg = _safe_float(raw_chg_str, 0.0) or 0.0
        if "-" in raw_chg_str and chg > 0:
            chg = -chg
        prev_p = close_p - chg
        chg_pct = (chg / prev_p * 100.0) if prev_p > 0 else 0.0

        universe[code] = {
            "symbol": code,
            "name": str(row.get("CompanyName", code)).strip(),
            "market": "TPEx",
            "price_num": close_p,
            "change_num": round(chg, 2),
            "change_pct_num": round(chg_pct, 2),
            "open_num": _safe_float(row.get("Open"), close_p),
            "high_num": _safe_float(row.get("High"), close_p),
            "low_num": _safe_float(row.get("Low"), close_p),
            "volume_shares": vol_shares,
            "volume_units": round(vol_shares / 1000.0, 1),
            "trade_value": trade_val,
            "transactions_num": trans,
            "industry_code": "",
            "pe": None,
            "pb": None,
            "dividend_yield": None,
            "foreign_net_lots": 0,
            "trust_net_lots": 0,
            "dealer_net_lots": 0,
            "inst_total_lots": 0,
        }

    # 3. 合併產業代碼 (TWSE & TPEx)
    for row in (raw_map.get("twse_info") or []):
        code = str(row.get("公司代號", "")).strip()
        if code in universe:
            universe[code]["industry_code"] = str(row.get("產業別", "")).strip().zfill(2)

    for row in (raw_map.get("tpex_info") or []):
        code = str(row.get("SecuritiesCompanyCode", "")).strip()
        if code in universe:
            universe[code]["industry_code"] = str(row.get("SecuritiesIndustryCode", "")).strip().zfill(2)

    # 4. 合併估值指標 PE / PB / 殖利率
    for row in (raw_map.get("twse_pe") or []):
        code = str(row.get("Code", "")).strip()
        if code in universe:
            universe[code]["pe"] = _safe_float(row.get("PEratio"))
            universe[code]["dividend_yield"] = _safe_float(row.get("DividendYield"))
            universe[code]["pb"] = _safe_float(row.get("PBratio"))

    for row in (raw_map.get("tpex_pe") or []):
        code = str(row.get("SecuritiesCompanyCode", "")).strip()
        if code in universe:
            universe[code]["pe"] = _safe_float(row.get("PriceEarningRatio"))
            universe[code]["dividend_yield"] = _safe_float(row.get("YieldRatio"))
            universe[code]["pb"] = _safe_float(row.get("PriceBookRatio"))

    # 5. 合併上市三大法人買賣超 (TWSE T86)
    twse_inst = raw_map.get("twse_inst")
    if isinstance(twse_inst, dict) and twse_inst.get("data"):
        for row in twse_inst["data"]:
            if not row or len(row) < 12:
                continue
            code = str(row[0]).strip()
            if code in universe:
                foreign_sh = _safe_int(row[4], 0) + _safe_int(row[7], 0)
                trust_sh = _safe_int(row[10], 0)
                dealer_sh = _safe_int(row[11], 0)
                total_sh = _safe_int(row[-1], foreign_sh + trust_sh + dealer_sh)
                universe[code]["foreign_net_lots"] = int(round(foreign_sh / 1000.0))
                universe[code]["trust_net_lots"] = int(round(trust_sh / 1000.0))
                universe[code]["dealer_net_lots"] = int(round(dealer_sh / 1000.0))
                universe[code]["inst_total_lots"] = int(round(total_sh / 1000.0))

    # 6. 合併上櫃三大法人買賣超 (TPEx dailyTrade)
    tpex_inst = raw_map.get("tpex_inst")
    if isinstance(tpex_inst, dict) and tpex_inst.get("tables"):
        t0 = tpex_inst["tables"][0]
        for row in (t0.get("data") or []):
            if not row or len(row) < 15:
                continue
            code = str(row[0]).strip()
            if code in universe:
                foreign_sh = _safe_int(row[4], 0)
                trust_sh = _safe_int(row[13], 0)
                total_sh = _safe_int(row[-1], 0)
                dealer_sh = total_sh - foreign_sh - trust_sh
                universe[code]["foreign_net_lots"] = int(round(foreign_sh / 1000.0))
                universe[code]["trust_net_lots"] = int(round(trust_sh / 1000.0))
                universe[code]["dealer_net_lots"] = int(round(dealer_sh / 1000.0))
                universe[code]["inst_total_lots"] = int(round(total_sh / 1000.0))

    print(f"✅ [L1 全市場掃描] 成功建構 {len(universe)} 檔上市櫃普通股與 ETF 完整盤後快照！")
    return universe


def classify_stock_sector(symbol: str, name: str, industry_code: str, seed_sector_map: dict) -> str:
    """
    將任意台股智能歸類至 8 大核心觀察板塊。
    若為種子核心股，優先保留既定分類（確保歷史連續性）。
    """
    if symbol in seed_sector_map:
        return seed_sector_map[symbol]

    if symbol.startswith("00"):
        return "etf"

    # 關鍵字優先精準分流
    if any(kw in name for kw in IC_DESIGN_KEYWORDS):
        return "ic_design"
    if any(kw in name for kw in MEMORY_STORAGE_KEYWORDS):
        return "memory_storage"
    if any(kw in name for kw in CPO_OPTICAL_KEYWORDS):
        return "cpo_networking"

    # 依據證交所/櫃買官方產業別代碼分流
    if industry_code == "24":  # 半導體業
        return "semiconductor_foundry"
    if industry_code in ("26", "27"):  # 光電業、通信網路業
        return "cpo_networking"
    if industry_code in ("25", "28", "29", "30", "31", "36"):  # 電腦週邊、零組件、資服、其他電子、雲端
        return "ai_server_thermal"
    if industry_code in ("15", "17"):  # 航運業、金融保險業
        return "finance_shipping"

    # 電機機械(05)、電器電纜(06)、綠能環保(35)、油電(23) 及其他高成交量傳產/生技龍頭
    return "green_energy_power"


def select_top_hot_pool(universe: dict, default_categories: dict, target_size: int = 400) -> tuple[dict, list]:
    """
    從全市場 ~2,200 檔標的中，無成本篩選出「成交量前 300~500 大熱門股池」(預設 400 檔)：
    1. 100% 保留原有核心種子指標股 (~133 檔)
    2. 納入全市場「成交金額 Top 80」高價權值與千金股（避免高價低張數如世芯、川湖、大立光遺漏）
    3. 依「當日成交張數」由高至低補滿至 target_size (預設 400 檔)
    回傳: (dynamic_categories_dict, selected_symbols_list)
    """
    seed_sector_map = {}
    seed_name_map = {}
    # 注意：部分核心股原本同時存在於半導體與記憶體雙板塊，完整保留其雙板塊席次，並以首見板塊為主映射
    dynamic_cats = {k: [] for k in SECTOR_LABELS.keys()}
    existing_in_cat = {k: set() for k in SECTOR_LABELS.keys()}

    selected_symbols = set()

    for cat, stocks in default_categories.items():
        if cat not in dynamic_cats:
            dynamic_cats[cat] = []
            existing_in_cat[cat] = set()
        for st in stocks:
            sym = st["symbol"]
            nm = universe.get(sym, {}).get("name") or st["name"]
            seed_name_map[sym] = nm
            if sym not in seed_sector_map:
                seed_sector_map[sym] = cat
            if sym not in existing_in_cat[cat]:
                dynamic_cats[cat].append({"symbol": sym, "name": nm})
                existing_in_cat[cat].add(sym)
            selected_symbols.add(sym)

    # 依成交金額排序，先鎖定前 80 大重心股（機構法人主戰場；ETF 上限控制在 45 檔以將名額留給實體產業飆股）
    MAX_ETF_COUNT = 45
    by_value = sorted(universe.values(), key=lambda x: x.get("trade_value", 0.0), reverse=True)
    for item in by_value[:80]:
        if len(selected_symbols) >= target_size:
            break
        sym = item["symbol"]
        if sym not in selected_symbols:
            cat = classify_stock_sector(sym, item["name"], item["industry_code"], seed_sector_map)
            if cat == "etf" and len(dynamic_cats["etf"]) >= MAX_ETF_COUNT:
                continue
            dynamic_cats[cat].append({"symbol": sym, "name": item["name"]})
            existing_in_cat[cat].add(sym)
            selected_symbols.add(sym)

    # 再依當日成交張數排序，補滿至 target_size (預設 400 檔人氣熱門股)
    by_volume = sorted(universe.values(), key=lambda x: x.get("volume_units", 0.0), reverse=True)
    for item in by_volume:
        if len(selected_symbols) >= target_size:
            break
        sym = item["symbol"]
        if sym not in selected_symbols:
            cat = classify_stock_sector(sym, item["name"], item["industry_code"], seed_sector_map)
            if cat == "etf" and len(dynamic_cats["etf"]) >= MAX_ETF_COUNT:
                continue
            dynamic_cats[cat].append({"symbol": sym, "name": item["name"]})
            existing_in_cat[cat].add(sym)
            selected_symbols.add(sym)

    # 各板塊內部按當日成交量降序排列，讓熱門股優先展示
    for cat in dynamic_cats:
        dynamic_cats[cat].sort(
            key=lambda s: universe.get(s["symbol"], {}).get("volume_units", 0.0),
            reverse=True
        )

    print(
        f"🎯 [L2 熱門股池鎖定] 已組建 {len(selected_symbols)} 檔高流動性熱門股池 "
        f"({', '.join(f'{SECTOR_LABELS[k]}:{len(v)}' for k, v in dynamic_cats.items())})"
    )
    return dynamic_cats, list(selected_symbols)


def compute_funnel_5d_scores(snap: dict, prev_cache_item: dict = None) -> dict:
    """
    基於證交所/櫃買真實價量、三大法人買賣超與本益比/殖利率，計算客觀五維度分數 (1~10 分)。
    """
    chg_pct = snap.get("change_pct_num", 0.0)
    vol_units = snap.get("volume_units", 0.0)
    high_p = snap.get("high_num") or snap["price_num"]
    low_p = snap.get("low_num") or snap["price_num"]
    close_p = snap["price_num"]

    # 1. 技術走勢 (Technical: 漲跌幅 + 日內收盤強弱位置 + 帶量突破)
    intraday_pos = (close_p - low_p) / (high_p - low_p) if high_p > low_p else 0.5
    if chg_pct >= 5.0:
        tech = 10
    elif chg_pct >= 2.5:
        tech = 9
    elif chg_pct >= 0.5:
        tech = 8
    elif chg_pct >= -0.8:
        tech = 7
    elif chg_pct >= -3.0:
        tech = 6
    else:
        tech = 5
    if intraday_pos >= 0.75 and chg_pct > 0 and vol_units >= 5000:
        tech = min(10, tech + 1)

    # 2. 公司營利與估值 (Financial: 官方 PE / PB / 現金殖利率)
    pe = snap.get("pe")
    dy = snap.get("dividend_yield")
    pb = snap.get("pb")
    fin = 7
    if pe is not None and pe > 0:
        if 6 <= pe <= 22:
            fin += 2
        elif 22 < pe <= 38:
            fin += 1
        elif pe > 80:
            fin -= 1
    elif snap["symbol"].startswith("00"):
        fin = 8  # ETF 一籃子龍頭穩健配置
    if dy is not None and dy >= 4.0:
        fin = min(10, fin + 1)
    if pb is not None and 0 < pb <= 1.8:
        fin = min(10, fin + 1)
    fin = min(10, max(5, fin))

    # 3. 法人籌碼 (Institutional: 真實外資 + 投信 + 自營商買賣超張數)
    inst_lots = snap.get("inst_total_lots", 0)
    trust_lots = snap.get("trust_net_lots", 0)
    foreign_lots = snap.get("foreign_net_lots", 0)
    if inst_lots >= 3000 or trust_lots >= 600:
        inst = 10
    elif inst_lots >= 800 or trust_lots >= 150:
        inst = 9
    elif inst_lots >= 100 or (foreign_lots > 0 and trust_lots > 0):
        inst = 8
    elif inst_lots >= -200:
        inst = 7
    elif inst_lots >= -1500:
        inst = 6
    else:
        inst = 5

    # 4. 輿情與市場熱度 (News & Sentiment: 交易筆數熱度 + 土洋法人共識 + 動能)
    trans = snap.get("transactions_num", 0)
    news = 7
    if chg_pct > 1.5 and inst_lots > 0:
        news += 1
    if foreign_lots > 0 and trust_lots > 0:
        news += 1  # 土洋同買共識高
    if trans >= 15000 and chg_pct > 0:
        news += 1
    elif chg_pct < -2.5 and inst_lots < -500:
        news -= 1
    news = min(10, max(5, news))

    return {
        "technical": tech,
        "financial": fin,
        "institutional": inst,
        "news_sentiment": news,
    }


def build_l2_quantitative_report(snap: dict, scores: dict) -> dict:
    """
    零 Token 極速量化報告產生器：融合證交所/櫃買真實三大法人籌碼與 PE/PB/殖利率數據。
    """
    mkt_label = "上市" if snap["market"] == "TWSE" else "上櫃"
    pe_str = f"{snap['pe']:.1f} 倍" if snap.get("pe") else "N/A (或 ETF)"
    pb_str = f"{snap['pb']:.2f} 倍" if snap.get("pb") else "---"
    dy_str = f"{snap['dividend_yield']:.2f}%" if snap.get("dividend_yield") else "---"

    f_lots = snap.get("foreign_net_lots", 0)
    t_lots = snap.get("trust_net_lots", 0)
    d_lots = snap.get("dealer_net_lots", 0)
    tot_lots = snap.get("inst_total_lots", 0)

    def _fmt_lot(n):
        return f"買超 {n:,} 張" if n > 0 else (f"賣超 {abs(n):,} 張" if n < 0 else "持平 0 張")

    financials = (
        f"【{mkt_label}官方估值與營利指標】目前本益比 (PE) 為 {pe_str}，"
        f"股價淨值比 (PB) 為 {pb_str}，現金殖利率達 {dy_str}。"
        f"當日成交總金額約 {snap.get('trade_value', 0) / 1e8:.2f} 億元，流動性位居全市場前段班。"
    )

    vol_str = f"{snap['volume_units']:,.0f} 張"
    trans_str = f"{snap['transactions_num']:,} 筆"
    news = (
        f"1. 【三大法人籌碼實況】今日三大法人合計{_fmt_lot(tot_lots)}（外資{_fmt_lot(f_lots)}、投信{_fmt_lot(t_lots)}、自營商{_fmt_lot(d_lots)}）。\n"
        f"2. 【市場交投熱度】全場成交量達 {vol_str}、撮合筆數 {trans_str}，日內高低區間介於 {snap['low_num']:.2f} ~ {snap['high_num']:.2f} 元。\n"
        f"3. 【量化籌碼訊號】{'外資與投信同步偏多操作，籌碼安定度高' if (f_lots > 0 and t_lots > 0) else ('法人買盤積極進駐推升動能' if tot_lots > 200 else '短線以市場量能換手為主，留意法人動向轉折')}。"
    )

    conferences = (
        f"【殖利率與價值追蹤】官方最新公告現金殖利率基準為 {dy_str}（PB {pb_str}）。"
        f"建議持續追蹤每月 10 日前公告之單月合併營收年增率，以及季度法說會對毛利率與產能稼動率之最新展望。"
    )

    chg_pct = snap.get("change_pct_num", 0.0)
    action_desc = "價漲量增偏多格局" if chg_pct > 0.5 else ("震盪整理蓄勢" if chg_pct >= -0.8 else "短線回測支撐")
    prediction_reason = (
        f"綜合{mkt_label}盤後數據，該股今日呈{action_desc}（單日 {chg_pct:+.2f}%），"
        f"搭配三大法人合計{_fmt_lot(tot_lots)}，技術評分 {scores['technical']}/10、籌碼評分 {scores['institutional']}/10。"
    )

    return {
        "financials": financials,
        "news": news,
        "conferences": conferences,
        "prediction_reason": prediction_reason,
    }


def batch_enrich_category_top_picks_llm(
    category_name: str,
    picks_payload: list,
    gemini_key: str,
    call_gemini_fn,
) -> dict:
    """
    L3 批次 AI 深度精析：將同一板塊的 Top 5 強勢股打包為單一 Prompt，
    1 次 API Request 同時產出 5 檔股票的專業新聞結論與趨勢研判（節省 80%~94% API 配額）。
    回傳: {symbol: {financials, news, conferences, prediction_reason}}
    """
    if not gemini_key or not picks_payload:
        return {}

    stocks_block = json.dumps(picks_payload, ensure_ascii=False, indent=2)
    prompt = (
        f"你是一位頂尖台股量化與產業研究員。以下是「{category_name}」板塊今日綜合評分最高的前 {len(picks_payload)} 檔重點熱門股盤後真實數據（含證交所/櫃買中心三大法人買賣超、估值與最新 RSS 新聞標題）：\n"
        f"{stocks_block}\n\n"
        f"請以繁體中文為每一檔股票撰寫精煉、具數據支撐的專業分析，並回傳一個純 JSON 物件（Key 為股票代號 symbol）：\n"
        f"{{\n"
        f"  \"股票代號\": {{\n"
        f"    \"financials\": \"1~2句結合PE、PB、殖利率與成交金額的財務估值評價\",\n"
        f"    \"news\": \"3點編號摘要 (1., 2., 3.)，結合真實新聞標題連結 [標題](URL) 與三大法人買賣超張數解讀\",\n"
        f"    \"conferences\": \"1~2句針對產業趨勢、法說展望與配息殖利率之重點提示\",\n"
        f"    \"prediction_reason\": \"2句結合今日價量筆數與法人籌碼的明日/本週走勢研判\"\n"
        f"  }}\n"
        f"}}\n"
        f"請只輸出合法 JSON，不要加上 ```json 標記。"
    )

    raw_text = call_gemini_fn(gemini_key, prompt)
    if not raw_text:
        return {}
    try:
        clean = raw_text.strip()
        if clean.startswith("```"):
            clean = re.sub(r"^```(?:json)?\s*", "", clean)
            clean = re.sub(r"\s*```$", "", clean)
        parsed = json.loads(clean)
        return parsed if isinstance(parsed, dict) else {}
    except Exception as e:
        print(f"⚠️ [L3 批次精析] 解析 {category_name} Gemini 回應失敗: {e}")
        return {}


def fetch_short_history_yahoo(symbol: str, market: str = "TWSE") -> list:
    """
    僅針對「首次新進榜、本地尚無歷史 K 線」的熱門股，輕量抓取近 1 個月收盤價序列。
    """
    suffixes = [".TW", ".TWO"] if market == "TWSE" else [".TWO", ".TW"]
    for suffix in suffixes:
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}{suffix}?range=1mo&interval=1d"
            r = requests.get(url, headers=HEADERS, timeout=4)
            if r.status_code == 200:
                res = r.json().get("chart", {}).get("result")
                if res and "timestamp" in res[0]:
                    ts_list = res[0].get("timestamp", [])
                    closes = res[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
                    hist = []
                    for t, c in zip(ts_list, closes):
                        if c is not None:
                            dt = (datetime.datetime.utcfromtimestamp(t) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")
                            hist.append({"date": dt, "price": round(float(c), 2)})
                    if hist:
                        return hist[-30:]
        except Exception:
            pass
    return []


def run_top_hot_funnel_pipeline(
    default_categories: dict,
    cache: dict,
    compute_weighted_rating_fn,
    fetch_rss_fn,
    call_gemini_fn,
    target_pool_size: int = 400,
) -> tuple[dict, dict]:
    """
    執行完整 L1 -> L2 -> L3 熱門股漏斗管線，回傳 (dynamic_categories, updated_cache)。
    """
    universe = fetch_twse_tpex_snapshot()
    if not universe:
        print("⚠️ [漏斗引擎] 官方 API 暫時無法連線，回退使用既有分類與快取。")
        return default_categories, cache

    dynamic_cats, selected_symbols = select_top_hot_pool(
        universe, default_categories, target_size=target_pool_size
    )

    now_tw = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    today_date = now_tw.strftime("%Y-%m-%d")
    today_ts = now_tw.strftime("%Y-%m-%d %H:%M")

    # 找出首次進榜且無歷史走勢的新熱門股，並行補齊 1 個月迷你 K 線 (上限 30 筆收盤價，保持檔案輕量)
    missing_hist_syms = [
        sym for sym in selected_symbols
        if sym in universe and not (cache.get(sym, {}).get("history"))
    ]
    if missing_hist_syms:
        print(f"📈 [L2 冷熱快取] 為 {len(missing_hist_syms)} 檔新進榜熱門股並行補齊近 1 個月收盤走勢...")
        with ThreadPoolExecutor(max_workers=20) as ex:
            fetched_hists = list(ex.map(
                lambda s: (s, fetch_short_history_yahoo(s, universe[s]["market"])),
                missing_hist_syms
            ))
        for sym, h_list in fetched_hists:
            if h_list:
                cache.setdefault(sym, {})["history"] = h_list

    # L2: 對全部 400 檔熱門股進行即時價量、三大法人籌碼與五維評分更新 (0 Token, 純記憶體毫秒級運算)
    for sym in selected_symbols:
        snap = universe.get(sym)
        if not snap:
            continue

        prev_item = cache.get(sym, {})
        price = snap["price_num"]
        chg = snap["change_num"]
        chg_pct = snap["change_pct_num"]
        vol_units = snap["volume_units"]
        trend = "bullish" if chg > 0 else ("bearish" if chg < 0 else "neutral")

        if vol_units >= 10000:
            vol_display = f"{vol_units / 10000:.1f}萬張"
        else:
            vol_display = f"{vol_units:,.0f}張"

        scores_4d = compute_funnel_5d_scores(snap, prev_item)
        rating = compute_weighted_rating_fn(scores_4d, vol_units, trend)

        # 滾動追加今日收盤價至歷史序列（保留最近 30 個交易日，兼顧走勢圖與週驗收且大幅縮減 JSON 體積）
        hist = list(prev_item.get("history", []))
        if hist:
            if hist[-1].get("date") != today_date:
                hist.append({"date": today_date, "price": round(price, 2)})
            else:
                hist[-1]["price"] = round(price, 2)
        else:
            hist = [{"date": today_date, "price": round(price, 2)}]
        hist = hist[-30:]

        # 若今日已有 L3 AI 精析報告則保留，否則使用高品質 L2 官方籌碼估值量化報告
        already_llm_today = (
            today_date in str(prev_item.get("update_time", ""))
            and prev_item.get("analysis_tier") == "L3_AI"
        )
        if already_llm_today:
            desc = {
                "financials": prev_item["financials"],
                "news": prev_item["news"],
                "conferences": prev_item["conferences"],
                "prediction_reason": prev_item["prediction_reason"],
            }
            tier = "L3_AI"
        else:
            desc = build_l2_quantitative_report(snap, scores_4d)
            tier = "L2_QUANT"

        cache[sym] = {
            "symbol": sym,
            "name": snap["name"],
            "market": snap["market"],
            "price": f"{price:.2f}",
            "change": f"{chg:+.2f}",
            "change_percent": f"{chg_pct:+.2f}%",
            "trend": trend,
            "volume": vol_display,
            "volume_raw": f"{vol_units:,.0f} 張",
            "transactions": f"{snap['transactions_num']:,} 筆",
            "inst_net_lots": snap["inst_total_lots"],
            "foreign_net_lots": snap["foreign_net_lots"],
            "trust_net_lots": snap["trust_net_lots"],
            "pe": snap["pe"],
            "pb": snap["pb"],
            "dividend_yield": snap["dividend_yield"],
            "history": hist,
            "radar": {
                "technical": scores_4d["technical"],
                "financial": scores_4d["financial"],
                "institutional": scores_4d["institutional"],
                "news_sentiment": scores_4d["news_sentiment"],
                "overall": rating,
            },
            "financials": desc["financials"],
            "news": desc["news"],
            "conferences": desc["conferences"],
            "recommendation_rating": rating,
            "target_price": f"{price * 0.95:.1f} - {price * 1.10:.1f} 元",
            "prediction_reason": desc["prediction_reason"],
            "analysis_tier": tier,
            "update_time": f"{today_ts} 盤後分析",
        }

    # 僅保留當期活躍 Top 400 熱門股與核心種子股，防止長年運行後 JSON 無限膨脹
    keep_syms = set(selected_symbols)
    cache = {sym: item for sym, item in cache.items() if sym in keep_syms}
    for item in cache.values():
        if "history" in item and len(item["history"]) > 30:
            item["history"] = item["history"][-30:]

    # L3: 針對 8 大板塊各自評分最高之 Top 5 強勢股抓取最新 RSS 新聞，並啟動批次 Gemini 深度精析
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    disable_llm = os.environ.get("DISABLE_STOCK_LLM", "false").lower() == "true"

    top_candidates_by_cat = {}
    rss_targets = set()
    for cat, st_list in dynamic_cats.items():
        ranked = sorted(
            st_list,
            key=lambda s: cache.get(s["symbol"], {}).get("recommendation_rating", 0),
            reverse=True,
        )
        top5 = ranked[:5]
        top_candidates_by_cat[cat] = top5
        for s in top5:
            rss_targets.add(s["symbol"])

    print(f"📰 [L3 重點精析] 正在為各板塊 Top 5 共 {len(rss_targets)} 檔領頭羊並行抓取最新 RSS 新聞...")
    rss_map = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        for sym, arts in ex.map(lambda s: (s, fetch_rss_fn(s)), list(rss_targets)):
            rss_map[sym] = arts or []

    # 先將真實 RSS 新聞標題注入這 ~40 檔領頭羊（即使無 API Key 也能顯示即時新聞連結！）
    for sym, arts in rss_map.items():
        if arts and sym in cache and cache[sym].get("analysis_tier") != "L3_AI":
            existing_lines = cache[sym]["news"].split("\n")
            chip_line = existing_lines[0] if existing_lines else ""
            rss_lines = [chip_line] if chip_line else []
            for idx, art in enumerate(arts[:2], start=2):
                rss_lines.append(f"{idx}. 【焦點新聞】[{art['title']}]({art['link']})")
            cache[sym]["news"] = "\n".join(rss_lines)

    if gemini_key and not disable_llm:
        print(f"🧠 [L3 批次 AI 精析] 啟動 Gemini 批次研判（8 大板塊僅需 {len(top_candidates_by_cat)} 次 API 呼叫）...")
        for cat, top5 in top_candidates_by_cat.items():
            need_llm = [
                s for s in top5
                if cache.get(s["symbol"], {}).get("analysis_tier") != "L3_AI"
            ]
            if not need_llm:
                continue
            payload = []
            for s in need_llm:
                sym = s["symbol"]
                ci = cache.get(sym, {})
                arts = rss_map.get(sym, [])[:3]
                payload.append({
                    "symbol": sym,
                    "name": ci.get("name", s["name"]),
                    "price": ci.get("price"),
                    "change_percent": ci.get("change_percent"),
                    "volume": ci.get("volume_raw"),
                    "transactions": ci.get("transactions"),
                    "inst_net_lots": ci.get("inst_net_lots", 0),
                    "foreign_net_lots": ci.get("foreign_net_lots", 0),
                    "trust_net_lots": ci.get("trust_net_lots", 0),
                    "pe": ci.get("pe"),
                    "pb": ci.get("pb"),
                    "dividend_yield": ci.get("dividend_yield"),
                    "news_headlines": [{"title": a["title"], "link": a["link"]} for a in arts],
                })
            llm_results = batch_enrich_category_top_picks_llm(
                SECTOR_LABELS.get(cat, cat), payload, gemini_key, call_gemini_fn
            )
            for sym, enriched in llm_results.items():
                if sym in cache and isinstance(enriched, dict):
                    for k in ("financials", "news", "conferences", "prediction_reason"):
                        if enriched.get(k):
                            cache[sym][k] = enriched[k]
                    cache[sym]["analysis_tier"] = "L3_AI"
    else:
        print("ℹ️ [L3 批次 AI 精析] 未設定 GEMINI_API_KEY 或已停用 LLM，已使用官方三大法人籌碼 + 即時 RSS 量化引擎完成全池更新（0 Token）！")

    # 持久化儲存動態熱門股分類表
    with open(DYNAMIC_CATEGORIES_FILE, "w", encoding="utf-8") as f:
        json.dump(dynamic_cats, f, ensure_ascii=False, indent=2)

    return dynamic_cats, cache
