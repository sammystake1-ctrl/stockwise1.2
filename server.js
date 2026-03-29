const express = require("express");
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const STOCK_UNIVERSE = [
  {
    symbol: "VTI",
    name: "Vanguard Total Stock Market ETF",
    risk: "conservative",
    minHorizon: "short",
    tags: ["etf", "broad", "core"],
    desc: "Broad U.S. stock market exposure."
  },
  {
    symbol: "SCHD",
    name: "Schwab U.S. Dividend Equity ETF",
    risk: "conservative",
    minHorizon: "short",
    tags: ["etf", "dividend", "income"],
    desc: "Dividend-focused ETF for steadier income."
  },
  {
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    risk: "conservative",
    minHorizon: "medium",
    tags: ["etf", "broad", "large-cap"],
    desc: "Large-cap U.S. equity core holding."
  },
  {
    symbol: "MSFT",
    name: "Microsoft",
    risk: "moderate",
    minHorizon: "medium",
    tags: ["quality", "tech", "cashflow"],
    desc: "Large-cap compounder with strong cash flow."
  },
  {
    symbol: "AAPL",
    name: "Apple",
    risk: "moderate",
    minHorizon: "medium",
    tags: ["quality", "consumer", "tech"],
    desc: "Mega-cap quality stock with durable ecosystem."
  },
  {
    symbol: "GOOGL",
    name: "Alphabet",
    risk: "moderate",
    minHorizon: "medium",
    tags: ["quality", "tech", "ads"],
    desc: "Strong balance sheet and advertising moat."
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    risk: "aggressive",
    minHorizon: "long",
    tags: ["growth", "ai", "semis"],
    desc: "High-growth semiconductor leader."
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices",
    risk: "aggressive",
    minHorizon: "long",
    tags: ["growth", "semis", "ai"],
    desc: "Higher-volatility semiconductor growth name."
  },
  {
    symbol: "AMZN",
    name: "Amazon",
    risk: "aggressive",
    minHorizon: "long",
    tags: ["growth", "cloud", "consumer"],
    desc: "Growth-oriented large cap tied to cloud and retail."
  }
];

const HORIZON_RANK = {
  short: 1,
  medium: 2,
  long: 3,
  vlong: 4
};

function scoreStock(stock, profile) {
  let score = 0;

  if (stock.risk === profile.risk) score += 40;
  if (profile.risk === "moderate" && (stock.risk === "conservative" || stock.risk === "aggressive")) score += 20;
  if (profile.risk === "aggressive" && stock.risk === "moderate") score += 15;
  if (profile.risk === "conservative" && stock.risk === "moderate") score += 10;

  if ((HORIZON_RANK[profile.horizon] || 1) >= (HORIZON_RANK[stock.minHorizon] || 1)) score += 20;

  if (profile.age < 30 && stock.tags.includes("growth")) score += 15;
  if (profile.age >= 30 && profile.age < 50 && stock.tags.includes("quality")) score += 12;
  if (profile.age >= 50 && (stock.tags.includes("dividend") || stock.tags.includes("broad"))) score += 15;

  if (profile.wantETF && stock.tags.includes("etf")) score += 15;
  if (profile.wantDiv && stock.tags.includes("dividend")) score += 15;

  if (profile.goal === "income" && stock.tags.includes("dividend")) score += 12;
  if (profile.goal === "wealth" && (stock.tags.includes("growth") || stock.tags.includes("quality"))) score += 12;
  if (profile.goal === "preservation" && (stock.tags.includes("broad") || stock.tags.includes("dividend"))) score += 12;

  if (profile.avoid?.includes("tech") && stock.tags.includes("tech")) score -= 25;
  if (profile.avoid?.includes("growth") && stock.tags.includes("growth")) score -= 25;

  return score;
}

function isoDateDaysAgo(daysAgo = 7) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchLiveData(symbol) {
  const [quoteRes, targetRes, newsRes] = await Promise.all([
    axios.get("https://finnhub.io/api/v1/quote", {
      params: { symbol, token: FINNHUB_API_KEY }
    }),
    axios.get("https://finnhub.io/api/v1/stock/price-target", {
      params: { symbol, token: FINNHUB_API_KEY }
    }),
    axios.get("https://finnhub.io/api/v1/company-news", {
      params: {
        symbol,
        from: isoDateDaysAgo(7),
        to: todayIso(),
        token: FINNHUB_API_KEY
      }
    })
  ]);

  const quote = quoteRes.data || {};
  const target = targetRes.data || {};
  const news = Array.isArray(newsRes.data) ? newsRes.data.slice(0, 3) : [];

  return {
    currentPrice: quote.c ?? null,
    changePercent: quote.dp ?? null,
    high: quote.h ?? null,
    low: quote.l ?? null,
    open: quote.o ?? null,
    previousClose: quote.pc ?? null,
    targetMean: target.targetMean ?? null,
    targetHigh: target.targetHigh ?? null,
    targetLow: target.targetLow ?? null,
    news: news.map((item) => ({
      headline: item.headline || "No headline available",
      source: item.source || "Unknown source",
      url: item.url || "#",
      summary: item.summary || "",
      datetime: item.datetime || null
    }))
  };
}

app.post("/api/recommendations", async (req, res) => {
  try {
    const profile = {
      age: Number(req.body.age),
      risk: req.body.risk,
      amount: req.body.amount,
      horizon: req.body.horizon,
      wantDiv: !!req.body.wantDiv,
      wantETF: !!req.body.wantETF,
      goal: req.body.goal || "wealth",
      react: req.body.react || "hold",
      income: req.body.income || "",
      exp: req.body.exp || "beginner",
      avoid: (req.body.avoid || "").toLowerCase()
    };

    if (!profile.age || !profile.risk || !profile.horizon) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const ranked = STOCK_UNIVERSE
      .map((stock) => ({ ...stock, fitScore: scoreStock(stock, profile) }))
      .sort((a, b) => b.fitScore - a.fitScore)
      .slice(0, 6);

    const enriched = await Promise.all(
      ranked.map(async (stock) => {
        try {
          const live = await fetchLiveData(stock.symbol);
          return {
            symbol: stock.symbol,
            name: stock.name,
            fitScore: Math.min(99, Math.max(65, stock.fitScore)),
            description: stock.desc,
            risk: stock.risk,
            ...live
          };
        } catch (err) {
          console.error(`Live fetch failed for ${stock.symbol}:`, err.response?.data || err.message);
          return {
            symbol: stock.symbol,
            name: stock.name,
            fitScore: Math.min(99, Math.max(65, stock.fitScore)),
            description: stock.desc,
            risk: stock.risk,
            currentPrice: null,
            changePercent: null,
            targetMean: null,
            targetHigh: null,
            targetLow: null,
            news: []
          };
        }
      })
    );

    res.json({
      profile,
      recommendations: enriched
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Failed to build recommendations." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
