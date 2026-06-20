import { useState, useMemo } from "react";
import { ComposedChart, AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ============================================================
// Constants
// ============================================================
const TAX_BRACKETS = [
  { limit: 1950000, rate: 0.05, deduction: 0 },
  { limit: 3300000, rate: 0.10, deduction: 97500 },
  { limit: 6950000, rate: 0.20, deduction: 427500 },
  { limit: 9000000, rate: 0.23, deduction: 636000 },
  { limit: 18000000, rate: 0.33, deduction: 1536000 },
  { limit: 40000000, rate: 0.40, deduction: 2796000 },
  { limit: Infinity, rate: 0.45, deduction: 4796000 },
];

const EDU_COSTS = {
  elementary: { public: 30, private: 160 },
  middle: { public: 50, private: 140 },
  high: { public: 45, private: 100 },
  university: { national: 80, private: 130 },
};

const NHI = {
  medical: { incomeRate: 0.0754, perCapita: 45400, household: 24800, cap: 650000 },
  support: { incomeRate: 0.0258, perCapita: 15600, household: 0, cap: 240000 },
  care: { incomeRate: 0.0222, perCapita: 17000, household: 0, cap: 170000 },
};

const NATIONAL_PENSION_MONTHLY = 17510;
const RESIDENT_TAX_RATE = 0.10;
const RESIDENT_TAX_PERCAPITA = 5000;
const RECONSTRUCTION_TAX_RATE = 0.021;
const BASIC_DEDUCTION = 580000;
const CONSUMPTION_TAX_SIMPLIFIED_RATES = {
  service: 0.50, wholesale: 0.90, retail: 0.80,
  manufacturing: 0.70, realestate: 0.60, other: 0.60,
};

// ============================================================
// Calculations
// ============================================================
function calcIncomeTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome <= bracket.limit) {
      return Math.floor(taxableIncome * bracket.rate - bracket.deduction);
    }
  }
  return 0;
}

function calcNHI(totalIncome, age, numInsured) {
  const base = Math.max(0, totalIncome - 430000);
  let medical = Math.min(NHI.medical.cap, base * NHI.medical.incomeRate + NHI.medical.perCapita * numInsured + NHI.medical.household);
  let support = Math.min(NHI.support.cap, base * NHI.support.incomeRate + NHI.support.perCapita * numInsured);
  let care = 0;
  if (age >= 40 && age < 65) {
    care = Math.min(NHI.care.cap, base * NHI.care.incomeRate + NHI.care.perCapita * numInsured);
  }
  return Math.floor(medical + support + care);
}

function calcConsumptionTax(revenue, category) {
  const deemed = CONSUMPTION_TAX_SIMPLIFIED_RATES[category] || 0.50;
  return Math.max(0, Math.floor(revenue * 0.10 - revenue * 0.10 * deemed));
}

function getEducationCost(childAge, settings) {
  if (childAge < 6) return 0;
  if (childAge <= 11) return (settings.elementary === "private" ? EDU_COSTS.elementary.private : EDU_COSTS.elementary.public) * 10000;
  if (childAge <= 14) return (settings.middle === "private" ? EDU_COSTS.middle.private : EDU_COSTS.middle.public) * 10000;
  if (childAge <= 17) return (settings.high === "private" ? EDU_COSTS.high.private : EDU_COSTS.high.public) * 10000;
  if (childAge <= 21) return (settings.university === "private" ? EDU_COSTS.university.private : EDU_COSTS.university.national) * 10000;
  return 0;
}

function simulate(params) {
  const years = [];
  let investmentAssets = params.investmentAssets * 10000;
  let cashAssets = params.cashAssets * 10000;
  let fireYear = null;

  for (let y = 0; y <= params.simYears; y++) {
    const age = params.currentAge + y;
    const year = new Date().getFullYear() + y;

    const mainRevenue = params.hourlyRate * params.monthlyHours * 12;
    const sideRevenue = params.sideIncome * 10000;
    const totalRevenue = mainRevenue + sideRevenue;
    const mainExpenses = mainRevenue * (params.mainExpenseRate / 100);
    const sideExpenses = sideRevenue * (params.sideExpenseRate / 100);
    const businessIncome = totalRevenue - mainExpenses - sideExpenses;

    const blueDeduction = params.blueReturn === "65" ? 650000 : params.blueReturn === "10" ? 100000 : 0;
    const mutualAid = params.mutualAid * 10000 * 12;
    const ideco = params.ideco * 10000 * 12;
    const nationalPension = NATIONAL_PENSION_MONTHLY * 12;
    const nhiInsured = 1 + (params.hasSpouse && params.spouseIncome < 130 ? 1 : 0) + params.children.length;
    const nhiAmount = calcNHI(businessIncome, age, nhiInsured);
    const socialInsurance = nationalPension + nhiAmount;
    const totalDeductions = blueDeduction + mutualAid + ideco + socialInsurance + BASIC_DEDUCTION;
    const taxableIncome = Math.max(0, businessIncome - totalDeductions);

    const incomeTax = calcIncomeTax(taxableIncome);
    const reconstructionTax = Math.floor(incomeTax * RECONSTRUCTION_TAX_RATE);
    const residentTax = Math.max(0, Math.floor(taxableIncome * RESIDENT_TAX_RATE + RESIDENT_TAX_PERCAPITA));
    const consumptionTax = params.isConsumptionTaxPayer ? calcConsumptionTax(totalRevenue, params.consumptionTaxCategory) : 0;
    const totalTax = incomeTax + reconstructionTax + residentTax + consumptionTax;

    const netIncome = totalRevenue - mainExpenses - sideExpenses - totalTax - socialInsurance;
    const spouseNet = params.hasSpouse ? params.spouseIncome * 10000 : 0;
    const livingExpenses = params.monthlyLiving * 10000 * 12;
    const mortgageRemaining = params.mortgageYears - y;
    const mortgageAnnual = mortgageRemaining > 0 ? params.monthlyMortgage * 10000 * 12 : 0;

    let educationTotal = 0;
    for (const child of params.children) {
      educationTotal += getEducationCost(child.age + y, child.edu);
    }

    const totalExpenses = livingExpenses + mortgageAnnual + educationTotal;
    const surplus = netIncome + spouseNet - totalExpenses - mutualAid - ideco;

    const investmentReturn = Math.floor(investmentAssets * (params.returnRate / 100));
    const nisaMax = params.nisaAnnual * 10000;

    if (surplus >= 0) {
      const toInvest = Math.min(surplus, nisaMax);
      investmentAssets += toInvest + investmentReturn;
      cashAssets += surplus - toInvest;
    } else {
      if (cashAssets + surplus >= 0) {
        cashAssets += surplus;
        investmentAssets += investmentReturn;
      } else {
        const deficit = Math.abs(surplus) - cashAssets;
        cashAssets = 0;
        investmentAssets = investmentAssets + investmentReturn - deficit;
      }
    }

    // FIRE metrics
    const fireIncome = investmentAssets * 0.04 + sideRevenue + spouseNet;
    const fireExpenses = totalExpenses + mutualAid + ideco;
    const fireRatio = fireExpenses > 0 ? fireIncome / fireExpenses : 0;
    const isFire = fireIncome >= fireExpenses;
    if (isFire && !fireYear) fireYear = { age, year };

    // Required investment assets for FIRE (what's needed so 4% covers the gap)
    const gapForFire = Math.max(0, fireExpenses - sideRevenue - spouseNet);
    const requiredAssets = gapForFire / 0.04;

    years.push({
      year, age,
      mainRevenue: Math.round(mainRevenue),
      sideRevenue: Math.round(sideRevenue),
      totalRevenue: Math.round(totalRevenue),
      businessIncome: Math.round(businessIncome),
      incomeTax, reconstructionTax, residentTax, consumptionTax,
      totalTax, nhiAmount, nationalPension,
      socialInsurance,
      netIncome: Math.round(netIncome),
      spouseNet: Math.round(spouseNet),
      livingExpenses, mortgageAnnual, educationTotal,
      totalExpenses: Math.round(totalExpenses),
      mutualAid, ideco,
      surplus: Math.round(surplus),
      investmentAssets: Math.round(investmentAssets),
      cashAssets: Math.round(cashAssets),
      totalAssets: Math.round(investmentAssets + cashAssets),
      investmentReturn: Math.round(investmentReturn),
      isFire, fireRatio, fireIncome: Math.round(fireIncome),
      fireExpenses: Math.round(fireExpenses),
      requiredAssets: Math.round(requiredAssets),
    });
  }
  return { years, fireYear };
}

// ============================================================
// UI Components
// ============================================================
const fmt = (n) => {
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1) + "億";
  if (Math.abs(n) >= 10000) return Math.round(n / 10000).toLocaleString() + "万";
  return n.toLocaleString();
};
const fmtMan = (n) => Math.round(n / 10000).toLocaleString() + "万円";

// --- FIRE Progress Ring ---
function FireProgressRing({ ratio, fireYear, currentAge }) {
  const pct = Math.min(ratio * 100, 100);
  const achieved = pct >= 100;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const yearsLeft = fireYear ? fireYear.age - currentAge : null;

  return (
    <div style={{
      background: achieved
        ? "linear-gradient(135deg, #1a3a2a 0%, #0f2b1e 100%)"
        : "linear-gradient(135deg, #1a2332 0%, #1e293b 100%)",
      borderRadius: 16, padding: "24px 28px", marginBottom: 20, position: "relative", overflow: "hidden",
      boxShadow: achieved ? "0 0 40px rgba(45, 122, 95, 0.3), 0 4px 12px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.15)",
    }}>
      {/* Glow effect when achieved */}
      {achieved && (
        <div style={{
          position: "absolute", top: -40, right: -40, width: 200, height: 200,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(45,200,120,0.15) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        {/* Ring */}
        <div style={{ position: "relative", width: 130, height: 130, flexShrink: 0 }}>
          <svg width="130" height="130" viewBox="0 0 130 130">
            <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
            <circle cx="65" cy="65" r={r} fill="none"
              stroke={achieved ? "#4ade80" : pct > 70 ? "#fbbf24" : "#60a5fa"}
              strokeWidth="10" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={offset}
              transform="rotate(-90 65 65)"
              style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.5s ease",
                filter: achieved ? "drop-shadow(0 0 8px rgba(74,222,128,0.5))" : "none" }}
            />
          </svg>
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
          }}>
            <span style={{
              fontSize: 28, fontWeight: 800, color: "#fff",
              fontVariantNumeric: "tabular-nums",
              textShadow: achieved ? "0 0 12px rgba(74,222,128,0.4)" : "none",
            }}>{Math.round(pct)}%</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em" }}>FIRE達成率</span>
          </div>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 180 }}>
          {achieved ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", letterSpacing: "0.05em" }}>
                  ✦ サイドFIRE 達成
                </span>
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                投資資産の4%取り崩し＋副業収入で<br />年間支出をカバーできる状態です
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                  {fireYear ? (
                    <>
                      <span style={{ fontSize: 32, fontWeight: 800, color: "#fbbf24", fontVariantNumeric: "tabular-nums",
                        textShadow: "0 0 12px rgba(251,191,36,0.3)" }}>
                        {yearsLeft}
                      </span>
                      <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", marginLeft: 4 }}>年後に達成</span>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>（{fireYear.age}歳）</span>
                    </>
                  ) : (
                    <span style={{ color: "#f87171" }}>シミュレーション期間内に未達成</span>
                  )}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                資産4%＋副業＋配偶者収入 ≥ 年間支出で達成
              </div>
            </>
          )}

          {/* Mini metrics */}
          <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>FIRE収入</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                {fmtMan(ratio > 0 ? Math.round(ratio * 100) > 100 ? 0 : 0 : 0)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sections, Sliders, etc ---
function Section({ title, open, onToggle, children }) {
  return (
    <div style={{ borderBottom: "1px solid #e2e5e9", paddingBottom: open ? 16 : 0, marginBottom: 12 }}>
      <button onClick={onToggle} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        width: "100%", background: "none", border: "none", cursor: "pointer",
        padding: "8px 0", fontSize: 14, fontWeight: 600, color: "#1a2332", letterSpacing: "0.02em",
      }}>
        {title}
        <span style={{ fontSize: 12, color: "#8a919c", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
      </button>
      {open && <div style={{ paddingTop: 8 }}>{children}</div>}
    </div>
  );
}

function Slider({ label, value, onChange, min, max, step = 1, unit = "", formatter }) {
  const display = formatter ? formatter(value) : `${value.toLocaleString()}${unit}`;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: "#4a5060" }}>{label}</span>
        <span style={{ fontWeight: 600, color: "#1a2332", fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#2d7a5f" }} />
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 13 }}>
      <span style={{ color: "#4a5060" }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{
        width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
        background: value ? "#2d7a5f" : "#ccd0d5", position: "relative", transition: "background 0.2s",
      }}>
        <span style={{
          position: "absolute", top: 2, left: value ? 22 : 2, width: 20, height: 20,
          borderRadius: 10, background: "#fff", transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }} />
      </button>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 13 }}>
      <span style={{ color: "#4a5060" }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ fontSize: 13, padding: "3px 8px", borderRadius: 4, border: "1px solid #d0d4da", background: "#fff" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ChildConfig({ index, child, onChange, onRemove }) {
  const update = (key, val) => onChange({ ...child, [key]: val });
  const updateEdu = (key, val) => onChange({ ...child, edu: { ...child.edu, [key]: val } });
  const eduOpts = (pub, priv) => [{ value: "public", label: pub }, { value: "private", label: priv }];
  return (
    <div style={{ background: "#f4f6f8", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>子ども{index + 1}</span>
        <button onClick={onRemove} style={{ fontSize: 11, color: "#c44b3f", background: "none", border: "none", cursor: "pointer" }}>削除</button>
      </div>
      <Slider label="現在の年齢" value={child.age} onChange={v => update("age", v)} min={0} max={22} unit="歳" />
      <Select label="小学校" value={child.edu.elementary} onChange={v => updateEdu("elementary", v)} options={eduOpts("公立", "私立")} />
      <Select label="中学校" value={child.edu.middle} onChange={v => updateEdu("middle", v)} options={eduOpts("公立", "私立")} />
      <Select label="高校" value={child.edu.high} onChange={v => updateEdu("high", v)} options={eduOpts("公立", "私立")} />
      <Select label="大学" value={child.edu.university} onChange={v => updateEdu("university", v)} options={[{ value: "public", label: "国公立" }, { value: "private", label: "私立" }]} />
    </div>
  );
}

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 10, padding: "16px 18px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)", minWidth: 140, flex: 1,
    }}>
      <div style={{ fontSize: 11, color: "#8a919c", marginBottom: 4, letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#1a2332", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#8a919c", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ fontSize: 12, background: "#fff", border: "1px solid #e2e5e9", borderRadius: 8, padding: "10px 14px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>{d.age}歳（{d.year}年）</div>
      <div style={{ display: "grid", gap: 3 }}>
        <div><span style={{ color: "#888" }}>投資資産:</span> <span style={{ color: "#2d7a5f", fontWeight: 600 }}>{fmtMan(d.investmentAssets)}</span></div>
        <div><span style={{ color: "#888" }}>現金:</span> <span style={{ color: "#3b6fa0", fontWeight: 600 }}>{fmtMan(d.cashAssets)}</span></div>
        <div><span style={{ color: "#888" }}>FIRE必要額:</span> <span style={{ color: "#e88c30", fontWeight: 500 }}>{fmtMan(d.requiredAssets)}</span></div>
        <div style={{ borderTop: "1px solid #eee", paddingTop: 4, marginTop: 2, fontWeight: 700 }}>
          合計: {fmtMan(d.totalAssets)}
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          FIRE達成率: <span style={{ color: d.fireRatio >= 1 ? "#16a34a" : "#e88c30", fontWeight: 600 }}>{Math.round(d.fireRatio * 100)}%</span>
        </div>
      </div>
      {d.isFire && <div style={{ color: "#16a34a", fontWeight: 700, marginTop: 6, fontSize: 13 }}>🎯 サイドFIRE達成</div>}
    </div>
  );
}

// ============================================================
// Main App
// ============================================================
const defaultChild = () => ({ age: 2, edu: { elementary: "public", middle: "public", high: "public", university: "public" } });

export default function App() {
  const [currentAge, setCurrentAge] = useState(37);
  const [simYears, setSimYears] = useState(28);
  const [hasSpouse, setHasSpouse] = useState(true);
  const [hourlyRate, setHourlyRate] = useState(4500);
  const [monthlyHours, setMonthlyHours] = useState(80);
  const [mainExpenseRate, setMainExpenseRate] = useState(10);
  const [sideIncome, setSideIncome] = useState(200);
  const [sideExpenseRate, setSideExpenseRate] = useState(15);
  const [spouseIncome, setSpouseIncome] = useState(190);
  const [monthlyLiving, setMonthlyLiving] = useState(20);
  const [monthlyMortgage, setMonthlyMortgage] = useState(9);
  const [mortgageYears, setMortgageYears] = useState(34);
  const [children, setChildren] = useState([defaultChild()]);
  const [investmentAssets, setInvestmentAssets] = useState(3300);
  const [cashAssets, setCashAssets] = useState(500);
  const [returnRate, setReturnRate] = useState(5);
  const [nisaAnnual, setNisaAnnual] = useState(120);
  const [blueReturn, setBlueReturn] = useState("65");
  const [mutualAid, setMutualAid] = useState(3);
  const [ideco, setIdeco] = useState(6.8);
  const [isConsumptionTaxPayer, setIsConsumptionTaxPayer] = useState(true);
  const [consumptionTaxCategory, setConsumptionTaxCategory] = useState("service");
  const [openSections, setOpenSections] = useState({ basic: true, main: true, side: true, living: false, children: false, assets: false, tax: false });
  const [showTable, setShowTable] = useState(false);

  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));
  const addChild = () => { if (children.length < 3) setChildren([...children, defaultChild()]); };
  const removeChild = (i) => setChildren(children.filter((_, idx) => idx !== i));
  const updateChild = (i, c) => setChildren(children.map((ch, idx) => idx === i ? c : ch));

  const params = useMemo(() => ({
    currentAge, simYears, hasSpouse, hourlyRate, monthlyHours, mainExpenseRate,
    sideIncome, sideExpenseRate, spouseIncome: hasSpouse ? spouseIncome : 0,
    monthlyLiving, monthlyMortgage, mortgageYears, children,
    investmentAssets, cashAssets, returnRate, nisaAnnual,
    blueReturn, mutualAid, ideco, isConsumptionTaxPayer, consumptionTaxCategory,
  }), [currentAge, simYears, hasSpouse, hourlyRate, monthlyHours, mainExpenseRate,
    sideIncome, sideExpenseRate, spouseIncome, monthlyLiving, monthlyMortgage,
    mortgageYears, children, investmentAssets, cashAssets, returnRate, nisaAnnual,
    blueReturn, mutualAid, ideco, isConsumptionTaxPayer, consumptionTaxCategory]);

  const result = useMemo(() => simulate(params), [params]);
  const year0 = result.years[0];
  const fireYear = result.fireYear;

  return (
    <div style={{
      maxWidth: 1200, margin: "0 auto", padding: "0 16px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
    }}>
      <header style={{ padding: "28px 0 20px", borderBottom: "2px solid #1a2332", marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "#8a919c", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Side FIRE Simulator</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a2332", margin: 0 }}>サイドFIRE・フリーランス転向シミュレーター</h1>
        <p style={{ fontSize: 12, color: "#8a919c", marginTop: 6 }}>フリーランス特有の税・社会保険を考慮した資産シミュレーション</p>
      </header>

      <style>{`
        @media (max-width: 800px) { .sim-grid { grid-template-columns: 1fr !important; } }
        .sim-grid input[type=range] { height: 6px; }
        .data-table { font-size: 11px; }
        .data-table th, .data-table td { padding: 6px 8px; white-space: nowrap; }
        .data-table tr.fire-row td { background: #f0fdf4; }
        .data-table tr.fire-row td:first-child { box-shadow: inset 3px 0 0 #16a34a; }
      `}</style>

      <div className="sim-grid" style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24, alignItems: "start" }}>
        {/* ===== INPUT PANEL ===== */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <Section title="👤 基本情報" open={openSections.basic} onToggle={() => toggleSection("basic")}>
            <Slider label="現在の年齢" value={currentAge} onChange={setCurrentAge} min={20} max={60} unit="歳" />
            <Slider label="シミュレーション期間" value={simYears} onChange={setSimYears} min={5} max={40}
              formatter={v => `${v}年（${currentAge + v}歳まで）`} />
            <Toggle label="配偶者あり" value={hasSpouse} onChange={setHasSpouse} />
            {hasSpouse && <Slider label="配偶者 年間手取り" value={spouseIncome} onChange={setSpouseIncome} min={0} max={800} step={10} unit="万円" />}
          </Section>

          <Section title="💼 本業収入（フリーランス）" open={openSections.main} onToggle={() => toggleSection("main")}>
            <Slider label="時給単価" value={hourlyRate} onChange={setHourlyRate} min={2000} max={15000} step={100}
              formatter={v => `${v.toLocaleString()}円/h`} />
            <Slider label="月稼働時間" value={monthlyHours} onChange={setMonthlyHours} min={20} max={200} step={5} unit="時間" />
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, padding: "4px 8px", background: "#f9fafb", borderRadius: 4 }}>
              → 月収 {Math.round(hourlyRate * monthlyHours / 10000).toLocaleString()}万円 ／ 年収 {Math.round(hourlyRate * monthlyHours * 12 / 10000).toLocaleString()}万円（税引前）
            </div>
            <Slider label="経費率" value={mainExpenseRate} onChange={setMainExpenseRate} min={0} max={50} unit="%" />
          </Section>

          <Section title="✍️ 副業・創作収入" open={openSections.side} onToggle={() => toggleSection("side")}>
            <Slider label="年間収入" value={sideIncome} onChange={setSideIncome} min={0} max={1000} step={10} unit="万円" />
            <Slider label="経費率" value={sideExpenseRate} onChange={setSideExpenseRate} min={0} max={50} unit="%" />
          </Section>

          <Section title="🏠 生活費・住宅" open={openSections.living} onToggle={() => toggleSection("living")}>
            <Slider label="月額生活費（住宅ローン除く）" value={monthlyLiving} onChange={setMonthlyLiving} min={5} max={50} unit="万円" />
            <Slider label="住宅ローン月額" value={monthlyMortgage} onChange={setMonthlyMortgage} min={0} max={25} step={0.5}
              formatter={v => v === 0 ? "なし" : `${v}万円`} />
            {monthlyMortgage > 0 && <Slider label="残年数" value={mortgageYears} onChange={setMortgageYears} min={0} max={35} unit="年" />}
          </Section>

          <Section title="🎓 子ども・教育費" open={openSections.children} onToggle={() => toggleSection("children")}>
            {children.map((child, i) => (
              <ChildConfig key={i} index={i} child={child} onChange={c => updateChild(i, c)} onRemove={() => removeChild(i)} />
            ))}
            {children.length < 3 && (
              <button onClick={addChild} style={{ fontSize: 12, color: "#2d7a5f", background: "none", border: "1px dashed #2d7a5f", borderRadius: 6, padding: "6px 12px", cursor: "pointer", width: "100%" }}>
                + 子どもを追加
              </button>
            )}
          </Section>

          <Section title="📈 資産・投資" open={openSections.assets} onToggle={() => toggleSection("assets")}>
            <Slider label="投資資産" value={investmentAssets} onChange={setInvestmentAssets} min={0} max={10000} step={50} unit="万円" />
            <Slider label="現金・預金" value={cashAssets} onChange={setCashAssets} min={0} max={5000} step={50} unit="万円" />
            <Slider label="期待リターン率" value={returnRate} onChange={setReturnRate} min={0} max={10} step={0.5} unit="%" />
            <Slider label="年間NISA投資枠" value={nisaAnnual} onChange={setNisaAnnual} min={0} max={360} step={10} unit="万円" />
          </Section>

          <Section title="🧾 節税・社会保険" open={openSections.tax} onToggle={() => toggleSection("tax")}>
            <Select label="青色申告控除" value={blueReturn} onChange={setBlueReturn}
              options={[{ value: "65", label: "65万円" }, { value: "10", label: "10万円" }, { value: "0", label: "なし" }]} />
            <Slider label="小規模企業共済" value={mutualAid} onChange={setMutualAid} min={0} max={7} step={0.5}
              formatter={v => v === 0 ? "なし" : `月${v}万円`} />
            <Slider label="iDeCo" value={ideco} onChange={setIdeco} min={0} max={6.8} step={0.1}
              formatter={v => v === 0 ? "なし" : `月${v}万円`} />
            <Toggle label="消費税課税事業者" value={isConsumptionTaxPayer} onChange={setIsConsumptionTaxPayer} />
            {isConsumptionTaxPayer && (
              <Select label="簡易課税みなし仕入率" value={consumptionTaxCategory} onChange={setConsumptionTaxCategory}
                options={[
                  { value: "service", label: "サービス業（50%）" }, { value: "other", label: "その他事業（60%）" },
                  { value: "manufacturing", label: "製造業等（70%）" }, { value: "retail", label: "小売業（80%）" },
                  { value: "wholesale", label: "卸売業（90%）" },
                ]} />
            )}
          </Section>
        </div>

        {/* ===== OUTPUT PANEL ===== */}
        <div>
          {/* FIRE Progress Hero */}
          <FireProgressRing ratio={year0.fireRatio} fireYear={fireYear} currentAge={currentAge} />

          {/* Summary Cards */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <SummaryCard label="年間手取り（初年度）" value={fmtMan(year0.netIncome)} sub={`税・社保: ${fmtMan(year0.totalTax + year0.socialInsurance)}`} />
            <SummaryCard label="世帯手取り" value={fmtMan(year0.netIncome + year0.spouseNet)} sub={`年間支出: ${fmtMan(year0.totalExpenses)}`} />
            <SummaryCard label="年間収支" value={(year0.surplus >= 0 ? "+" : "") + fmtMan(year0.surplus)}
              color={year0.surplus >= 0 ? "#2d7a5f" : "#c44b3f"}
              sub={`FIRE収入: ${fmtMan(year0.fireIncome)} / 必要: ${fmtMan(year0.fireExpenses)}`} />
          </div>

          {/* Tax breakdown */}
          <div style={{
            background: "#fff", borderRadius: 10, padding: 16, marginBottom: 20,
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)", fontSize: 12, color: "#4a5060",
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#1a2332" }}>初年度 税・社保の内訳</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "4px 16px" }}>
              <div>所得税: {fmtMan(year0.incomeTax)}</div>
              <div>住民税: {fmtMan(year0.residentTax)}</div>
              <div>復興特別税: {fmtMan(year0.reconstructionTax)}</div>
              <div>消費税: {fmtMan(year0.consumptionTax)}</div>
              <div>国民健康保険: {fmtMan(year0.nhiAmount)}</div>
              <div>国民年金: {fmtMan(year0.nationalPension)}</div>
              <div style={{ fontWeight: 600, color: "#1a2332" }}>合計: {fmtMan(year0.totalTax + year0.socialInsurance)}</div>
            </div>
          </div>

          {/* Chart: Assets vs FIRE threshold */}
          <div style={{
            background: "#fff", borderRadius: 10, padding: "16px 8px 8px 0",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2332", paddingLeft: 20, marginBottom: 4 }}>資産推移 vs FIRE必要額</div>
            <div style={{ fontSize: 11, color: "#8a919c", paddingLeft: 20, marginBottom: 8 }}>
              オレンジ線 = 投資資産がこの額に達すればサイドFIRE達成
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={result.years} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <defs>
                  <linearGradient id="gInvest" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2d7a5f" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2d7a5f" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gCash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b6fa0" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3b6fa0" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="age" tick={{ fontSize: 11 }} tickFormatter={v => `${v}歳`} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmt(v)} width={56} />
                <Tooltip content={<CustomTooltip />} />
                {fireYear && <ReferenceLine x={fireYear.age} stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3"
                  label={{ value: `🎯 FIRE ${fireYear.age}歳`, fill: "#16a34a", fontSize: 12, fontWeight: 700, position: "top" }} />}
                <Area type="monotone" dataKey="investmentAssets" stackId="1" stroke="#2d7a5f" strokeWidth={2} fill="url(#gInvest)" name="投資資産" />
                <Area type="monotone" dataKey="cashAssets" stackId="1" stroke="#3b6fa0" fill="url(#gCash)" name="現金" />
                <Line type="monotone" dataKey="requiredAssets" stroke="#e88c30" strokeWidth={2} strokeDasharray="8 4" dot={false} name="FIRE必要額" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Table toggle */}
          <button onClick={() => setShowTable(!showTable)} style={{
            fontSize: 13, color: "#2d7a5f", background: "#fff", border: "1px solid #d0d4da",
            borderRadius: 8, padding: "8px 16px", cursor: "pointer", marginBottom: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            {showTable ? "年別テーブルを閉じる" : "年別キャッシュフロー表を表示"}
          </button>

          {showTable && (
            <div style={{ overflowX: "auto", background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
                <thead>
                  <tr style={{ background: "#f4f6f8", textAlign: "center", fontSize: 11 }}>
                    <th style={{ textAlign: "left", padding: "8px" }}>年齢</th>
                    <th>本業</th><th>副業</th><th>税・社保</th><th>手取り</th><th>配偶者</th>
                    <th>生活費</th><th>教育費</th><th>ローン</th><th>年間収支</th>
                    <th>投資資産</th><th>現金</th><th>総資産</th><th>FIRE率</th>
                  </tr>
                </thead>
                <tbody>
                  {result.years.map(d => (
                    <tr key={d.year} className={d.isFire ? "fire-row" : ""} style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ textAlign: "left", fontWeight: 500, padding: "6px 8px" }}>
                        {d.age}歳<span style={{ color: "#aaa", marginLeft: 4 }}>({d.year})</span>
                        {d.isFire && fireYear && d.age === fireYear.age && <span style={{ marginLeft: 4 }}>🎯</span>}
                      </td>
                      <td>{fmtMan(d.mainRevenue)}</td>
                      <td>{fmtMan(d.sideRevenue)}</td>
                      <td style={{ color: "#c44b3f" }}>{fmtMan(d.totalTax + d.socialInsurance)}</td>
                      <td style={{ fontWeight: 600 }}>{fmtMan(d.netIncome)}</td>
                      <td>{fmtMan(d.spouseNet)}</td>
                      <td>{fmtMan(d.livingExpenses)}</td>
                      <td>{d.educationTotal > 0 ? fmtMan(d.educationTotal) : "-"}</td>
                      <td>{d.mortgageAnnual > 0 ? fmtMan(d.mortgageAnnual) : "-"}</td>
                      <td style={{ fontWeight: 600, color: d.surplus >= 0 ? "#2d7a5f" : "#c44b3f" }}>
                        {d.surplus >= 0 ? "+" : ""}{fmtMan(d.surplus)}
                      </td>
                      <td>{fmtMan(d.investmentAssets)}</td>
                      <td>{fmtMan(d.cashAssets)}</td>
                      <td style={{ fontWeight: 600 }}>{fmtMan(d.totalAssets)}</td>
                      <td style={{
                        fontWeight: 600,
                        color: d.fireRatio >= 1 ? "#16a34a" : d.fireRatio >= 0.7 ? "#e88c30" : "#6b7280",
                      }}>
                        {Math.round(d.fireRatio * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 11, color: "#aaa", marginTop: 20, lineHeight: 1.6 }}>
            ※ 本シミュレーターは概算です。実際の税額・保険料は自治体・控除状況により異なります。
            国民健康保険料は代表的な料率による概算値です。投資リターンは確定ではありません。
            サイドFIRE達成 = 投資資産の4%取り崩し＋副業収入＋配偶者収入 ≥ 年間総支出。
            重要な判断の際は税理士・FP等にご相談ください。
          </div>
        </div>
      </div>
    </div>
  );
}
