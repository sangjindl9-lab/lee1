// Calculator definitions. Labels come from L.f (fields), L.o (options), L.c (titles + formula notes).
(function () {
  const SQ3 = Math.sqrt(3), PI = Math.PI;
  const num = v => (v === "" || v == null) ? NaN : Number(String(v).replace(",", "."));
  const has = v => isFinite(v);
  const list = s => String(s || "").split(/[\s,;]+/).map(num).filter(x => isFinite(x) && x > 0);
  function need(...a) { if (a.some(x => !has(x))) throw "need"; }
  function pos(...a) { if (a.some(x => !(x > 0))) throw "pos"; }
  function pf(x) { if (!(x > 0 && x <= 1)) throw "pf"; return x; }
  function phaseFactor(sys) { return sys === "ac3" ? SQ3 : 1; }

  window.CALCS = [
    { id: "ohm", inputs: [["V", "V"], ["I", "A"], ["R", "Ω"], ["P", "W"]], note: "two",
      run(v) {
        let { V, I, R, P } = v; const n = [V, I, R, P].filter(has).length;
        if (n < 2) throw "two";
        if (has(V) && has(I)) { R = V / I; P = V * I; }
        else if (has(V) && has(R)) { I = V / R; P = V * I; }
        else if (has(V) && has(P)) { I = P / V; R = V / I; }
        else if (has(I) && has(R)) { V = I * R; P = V * I; }
        else if (has(I) && has(P)) { V = P / I; R = V / I; }
        else if (has(R) && has(P)) { V = Math.sqrt(P * R); I = V / R; }
        return [["V", V, "V"], ["I", I, "A"], ["R", R, "Ω"], ["P", P, "W"]];
      } },
    { id: "voltage", inputs: [["I", "A"], ["R", "Ω"]], run({ I, R }) { need(I, R); return [["V", I * R, "V"], ["P", I * I * R, "W"]]; } },
    { id: "current", inputs: [["sys", ["dc", "ac1", "ac3"]], ["P", "W"], ["V", "V"], ["PF", ""]],
      run({ sys, P, V, PF }) { need(P, V); pos(V); const k = sys === "dc" ? 1 : pf(has(PF) ? PF : 1); return [["I", P / (phaseFactor(sys) * V * k), "A"]]; } },
    { id: "resistance", inputs: [["V", "V"], ["I", "A"]], run({ V, I }) { need(V, I); pos(I); return [["R", V / I, "Ω"], ["P", V * I, "W"]]; } },
    { id: "active", inputs: [["sys", ["dc", "ac1", "ac3"]], ["V", "V"], ["I", "A"], ["PF", ""]],
      run({ sys, V, I, PF }) { need(V, I); const k = sys === "dc" ? 1 : pf(has(PF) ? PF : 1); const P = phaseFactor(sys) * V * I * k; return [["P", P, "W"], ["Pk", P / 1000, "kW"]]; } },
    { id: "apparent", inputs: [["sys", ["ac1", "ac3"]], ["V", "V"], ["I", "A"]],
      run({ sys, V, I }) { need(V, I); const S = phaseFactor(sys) * V * I; return [["S", S, "VA"], ["Sk", S / 1000, "kVA"]]; } },
    { id: "reactive", inputs: [["sys", ["ac1", "ac3"]], ["V", "V"], ["I", "A"], ["PF", ""]],
      run({ sys, V, I, PF }) { need(V, I, PF); pf(PF); const S = phaseFactor(sys) * V * I; const Q = S * Math.sqrt(1 - PF * PF); return [["Q", Q, "var"], ["Qk", Q / 1000, "kvar"]]; } },
    { id: "pf", inputs: [["P", "W"], ["S", "VA"]],
      run({ P, S }) { need(P, S); pos(S); const k = P / S; if (k > 1 || k < 0) throw "pf"; return [["PF", k, ""], ["ang", Math.acos(k) * 180 / PI, "°"], ["Q", Math.sqrt(S * S - P * P), "var"]]; } },
    { id: "pfcorr", inputs: [["P", "kW"], ["PF1", ""], ["PF2", ""]],
      run({ P, PF1, PF2 }) { need(P, PF1, PF2); pf(PF1); pf(PF2); if (PF2 <= PF1) throw "pf2";
        const t1 = Math.tan(Math.acos(PF1)), t2 = Math.tan(Math.acos(PF2)); return [["Qc", P * (t1 - t2), "kvar"]]; } },
    { id: "resComb", inputs: [["mode", ["series", "parallel"]], ["vals", "Ω"]], text: ["vals"],
      run({ mode, vals }) { const a = list(vals); if (a.length < 2) throw "vals";
        const r = mode === "series" ? a.reduce((s, x) => s + x, 0) : 1 / a.reduce((s, x) => s + 1 / x, 0); return [["Rt", r, "Ω"]]; } },
    { id: "indComb", inputs: [["mode", ["series", "parallel"]], ["vals", "mH"]], text: ["vals"],
      run({ mode, vals }) { const a = list(vals); if (a.length < 2) throw "vals";
        const r = mode === "series" ? a.reduce((s, x) => s + x, 0) : 1 / a.reduce((s, x) => s + 1 / x, 0); return [["Lt", r, "mH"]]; } },
    { id: "capComb", inputs: [["mode", ["series", "parallel"]], ["vals", "µF"]], text: ["vals"],
      run({ mode, vals }) { const a = list(vals); if (a.length < 2) throw "vals";
        const r = mode === "parallel" ? a.reduce((s, x) => s + x, 0) : 1 / a.reduce((s, x) => s + 1 / x, 0); return [["Ct", r, "µF"]]; } },
    { id: "capVolt", inputs: [["Q1", "kvar"], ["V1", "V"], ["V2", "V"], ["f1", "Hz"], ["f2", "Hz"]],
      run({ Q1, V1, V2, f1, f2 }) { need(Q1, V1, V2); pos(V1); const a = has(f1) && has(f2) && f1 > 0 ? f2 / f1 : 1; return [["Q2", Q1 * (V2 / V1) ** 2 * a, "kvar"]]; } },
    { id: "reactance", inputs: [["f", "Hz"], ["L", "mH"], ["C", "µF"]],
      run({ f, L, C }) { need(f); pos(f); const out = [];
        if (has(L)) out.push(["XL", 2 * PI * f * L / 1000, "Ω"]);
        if (has(C) && C > 0) out.push(["XC", 1 / (2 * PI * f * C * 1e-6), "Ω"]);
        if (has(L) && has(C) && C > 0) out.push(["fr", 1 / (2 * PI * Math.sqrt(L / 1000 * C * 1e-6)), "Hz"]);
        if (!out.length) throw "need"; return out; } },
    { id: "vdiv", inputs: [["Vin", "V"], ["R1", "Ω"], ["R2", "Ω"]],
      run({ Vin, R1, R2 }) { need(Vin, R1, R2); pos(R1 + R2); return [["Vout", Vin * R2 / (R1 + R2), "V"], ["I", Vin / (R1 + R2), "A"]]; } },
    { id: "idiv", inputs: [["It", "A"], ["R1", "Ω"], ["R2", "Ω"]],
      run({ It, R1, R2 }) { need(It, R1, R2); pos(R1 + R2); return [["I1", It * R2 / (R1 + R2), "A"], ["I2", It * R1 / (R1 + R2), "A"]]; } },
    { id: "joule", inputs: [["I", "A"], ["R", "Ω"], ["t", "s"]],
      run({ I, R, t }) { need(I, R, t); const E = I * I * R * t; return [["E", E, "J"], ["Ek", E / 3.6e6, "kWh"], ["cal", E / 4.184, "cal"]]; } },
    { id: "vdrop", inputs: [["sys", ["dc", "ac1", "ac3"]], ["mat", ["cu", "al"]], ["V", "V"], ["I", "A"], ["len", "m"], ["A", "mm²"]],
      run({ sys, mat, V, I, len, A }) { need(V, I, len, A); pos(A, V); const rho = mat === "al" ? 0.0282 : 0.0178;
        const k = sys === "ac3" ? SQ3 : 2; const dv = k * len * I * rho / A; return [["dV", dv, "V"], ["dVp", dv / V * 100, "%"], ["Vend", V - dv, "V"]]; } },
    { id: "wsize", inputs: [["sys", ["dc", "ac1", "ac3"]], ["mat", ["cu", "al"]], ["V", "V"], ["I", "A"], ["len", "m"], ["drop", "%"]],
      run({ sys, mat, V, I, len, drop }) { need(V, I, len, drop); pos(drop, V); const rho = mat === "al" ? 0.0282 : 0.0178;
        const k = sys === "ac3" ? SQ3 : 2; const A = k * len * I * rho / (V * drop / 100);
        const std = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630];
        const pick = std.find(s => s >= A) || A; return [["Amin", A, "mm²"], ["Astd", pick, "mm²"]]; } },
    { id: "motor", inputs: [["sys", ["ac1", "ac3"]], ["P", "kW"], ["V", "V"], ["PF", ""], ["eta", "%"]],
      run({ sys, P, V, PF, eta }) { need(P, V, PF, eta); pf(PF); pos(eta, V); const I = P * 1000 / (phaseFactor(sys) * V * PF * eta / 100);
        return [["I", I, "A"], ["Pin", P / (eta / 100), "kW"], ["hp", P / 0.746, "HP"]]; } },
    { id: "ups", inputs: [["load", "W"], ["hrs", "h"], ["bv", "V"], ["eff", "%"], ["dod", "%"]],
      run({ load, hrs, bv, eff, dod }) { need(load, hrs, bv); pos(bv); const e = has(eff) && eff > 0 ? eff / 100 : 0.85; const d = has(dod) && dod > 0 ? dod / 100 : 1;
        const Wh = load * hrs / (e * d); return [["Wh", Wh, "Wh"], ["Ah", Wh / bv, "Ah"]]; } },
    { id: "antenna", inputs: [["fM", "MHz"], ["vf", ""]],
      run({ fM, vf }) { need(fM); pos(fM); const k = has(vf) && vf > 0 ? vf : 0.95; const wl = 299.792458 / fM;
        return [["wl", wl, "m"], ["half", wl / 2 * k, "m"], ["quarter", wl / 4 * k, "m"]]; } },
    { id: "led", inputs: [["Vs", "V"], ["Vf", "V"], ["If", "mA"]],
      run({ Vs, Vf, If }) { need(Vs, Vf, If); pos(If); if (Vs <= Vf) throw "led"; const R = (Vs - Vf) / (If / 1000);
        return [["R", R, "Ω"], ["P", (Vs - Vf) * If / 1000, "W"]]; } },
    { id: "cost", inputs: [["P", "W"], ["hrs", "h"], ["days", ""], ["price", ""]],
      run({ P, hrs, days, price }) { need(P, hrs); const d = has(days) ? days : 30; const kWh = P * hrs * d / 1000;
        const out = [["kWh", kWh, "kWh"]]; if (has(price)) out.push(["money", kWh * price, ""]); return out; } }
  ];

  window.fmt = function (x) {
    if (!isFinite(x)) return "—";
    const a = Math.abs(x);
    if (a !== 0 && (a < 0.001 || a >= 1e9)) return x.toExponential(3);
    const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 4;
    return Number(x.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
  };
  window.parseNum = num;
})();
