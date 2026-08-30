/* =========================================================
   TWINKHDS - Demo App Logic (GEMASTE X EXPO 2026)
   Semua data & inferensi AI pada file ini adalah SIMULASI
   untuk keperluan demonstrasi antarmuka (lihat modal "Tentang").
   Alur: Data Pasien (Nama, Usia, Gender, BB, TB) -> Panduan Auskultasi
   -> Rekam 4 Titik (A/P/T/M) -> Proses AI (CNN + Logistic Regression)
   -> Hasil (Jantung Normal/Abnormal) -> Penjelasan AI (Grad-CAM)
   -> Kontribusi Parameter (Odds Ratio & LinearSHAP)
   ========================================================= */
(function(){
  "use strict";

  /* ---------------- constants ---------------- */
  const POINTS = [
    { id:1, code:"A", name:"Aorta",      desc:"Sela iga kedua kanan" },
    { id:2, code:"P", name:"Pulmonal",   desc:"Sela iga kedua kiri" },
    { id:3, code:"T", name:"Trikuspid",  desc:"Sela iga keempat kiri" },
    { id:4, code:"M", name:"Mitral",     desc:"Apeks jantung" },
  ];

  /* ---------------- 2-tier hasil biner (TIDAK ada triase / override) ---------------- */
  const RESULT_TEXT = {
    "normal": {
      label:"JANTUNG NORMAL", sub:"Tidak terdeteksi kelainan. Tetap jaga pola hidup sehat dan lakukan pemeriksaan ulang pada kunjungan berikutnya ke puskesmas.", cls:"low",
      action:"Tidak ditemukan tanda abnormalitas jantung yang signifikan. Edukasi orang tua/pengasuh mengenai tanda bahaya, dan jadwalkan pemeriksaan rutin berikutnya sesuai jadwal Posyandu/Puskesmas.",
      checklist:["Edukasi tanda bahaya kepada orang tua/pengasuh","Catat hasil pada rekam medis pasien","Jadwalkan pemeriksaan rutin berikutnya"]
    },
    "abnormal": {
      label:"JANTUNG ABNORMAL", sub:"Terdeteksi kelainan. Rujuk ke Rumah Sakit (FKRTL) mengikuti alur rujukan berjenjang JKN.", cls:"high",
      action:"Rujuk pasien ke fasilitas kesehatan lanjutan (dokter spesialis anak/kardiologi anak) untuk konfirmasi lebih lanjut (mis. ekokardiografi), sertakan hasil & skor probabilitas ini pada surat rujukan, dan jelaskan temuan kepada orang tua/pengasuh.",
      checklist:["Siapkan surat rujukan ke faskes lanjutan (FKRTL)","Sertakan hasil & skor probabilitas pada rujukan","Jelaskan temuan kepada orang tua/pengasuh","Catat pada rekam medis untuk tindak lanjut"]
    },
  };
  const CLS_LABEL = { high:"Abnormal", low:"Normal" };
  const CLS_PILL  = { high:"pill-red", low:"pill-green" };

  /* ---------------- state ---------------- */
  const state = {
    patient:{ name:"", age:"", ageUnit:"tahun", gender:"", weight:"", height:"" },
    points:[],
    result:null,
    lastExamScreen:"beranda",
    meetingNo: 1,
  };

  const AGE_MIN_DAYS = 29;    // > 28 hari
  const AGE_MAX_DAYS = 6574;  // < 18 tahun (17 tahun 11 bulan, hari terakhir sebelum ulang tahun ke-18)
  function ageToDays(value, unit){
    value = parseFloat(value) || 0;
    if(unit==="hari") return value;
    if(unit==="bulan") return value*30;
    return value*365; // tahun
  }
  function ageToYears(value, unit){ return ageToDays(value, unit) / 365; }
  function formatAgeDisplay(value, unit){
    const unitLabel = unit==="hari" ? "Hari" : unit==="bulan" ? "Bulan" : "Tahun";
    return `${value} ${unitLabel}`;
  }

  /* ---------------- history (localStorage) ---------------- */
  const HKEY = "twinkhds_gemaste_history_v1";
  function loadHistory(){
    try{
      const raw = localStorage.getItem(HKEY);
      if(raw) return JSON.parse(raw);
    }catch(e){}
    return [
      { name:"Nayla Putri", id:"P-2026-8942", ageDisplay:"3 Tahun", gender:"P", weight:12.5, height:88,  tier:"abnormal", probMurmur:0.81, when:"29 Agu 2026, 09:14" },
      { name:"Raka Aditya", id:"P-2026-8941", ageDisplay:"8 Tahun", gender:"L", weight:26,   height:126, tier:"normal",   probMurmur:0.14, when:"28 Agu 2026, 08:47" },
      { name:"Zahra Amelia", id:"P-2026-8938", ageDisplay:"45 Hari", gender:"P", weight:4.2,  height:54,  tier:"normal",   probMurmur:0.22, when:"27 Agu 2026, 10:02" },
    ];
  }
  function saveHistory(list){ try{ localStorage.setItem(HKEY, JSON.stringify(list)); }catch(e){} }
  let history = loadHistory();

  /* ---------------- helpers ---------------- */
  const $  = (sel,root)=> (root||document).querySelector(sel);
  const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function rand(min,max){ return Math.random()*(max-min)+min; }

  function isScreenVisible(name){
    const el = $(`.screen[data-screen="${name}"]`);
    return !!(el && el.classList.contains("visible"));
  }

  function showToast(msg){
    const t = $("#toast");
    $("#toastText").textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(()=>t.classList.remove("show"), 2200);
  }

  /* ---------------- navigation ---------------- */
  const NAV_GROUP = {
    "beranda":"beranda",
    "riwayat":"riwayat",
  };

  const NAV_ITEMS = [
    { key:"beranda", label:"Home", target:"beranda",
      icon:'<path d="M3 11l9-8 9 8"/><path d="M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9"/>' },
    { key:"riwayat", label:"History", target:"riwayat",
      icon:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>' },
    { key:"info", label:"Info", target:"__info__",
      icon:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".4" fill="currentColor"/>' },
  ];

  function renderBottomNav(){
    $$("[data-navbar]").forEach(nav=>{
      nav.innerHTML = NAV_ITEMS.map(it=>`
        <button class="nav-item" data-navkey="${it.key}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.icon}</svg>
          <span>${it.label}</span>
        </button>`).join("");
    });
  }

  function goTo(screenName){
    if(!screenName) return;
    $$(".screen").forEach(s=>s.classList.remove("visible"));
    const target = $(`.screen[data-screen="${screenName}"]`);
    if(!target){ return; }
    target.classList.add("visible");
    $("#appScroll").scrollTop = 0;
    const grp = NAV_GROUP[screenName];
    $$(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.navkey===grp));
    if(NAV_GROUP[screenName]==="pemeriksaan") state.lastExamScreen = screenName;
    afterNav(screenName);
    document.dispatchEvent(new CustomEvent("twinkhds:phone-nav", { detail: { screen: screenName } }));
  }

  function afterNav(screenName){
    if(screenName==="beranda") renderBeranda();
    if(screenName==="proses-auskultasi") syncAuscultationScreen();
    if(screenName==="hasil-skrining") renderHasil();
    if(screenName==="penjelasan-ai") renderPenjelasan();
    if(screenName==="faktor-risiko") renderFaktorRisiko();
    if(screenName==="riwayat") renderRiwayat();
  }

  /* delegate all nav / action clicks */
  document.addEventListener("click", (e)=>{
    const navBtn = e.target.closest("[data-nav]");
    if(navBtn){ goTo(navBtn.dataset.nav); return; }

    const navItem = e.target.closest(".nav-item");
    if(navItem){
      const item = NAV_ITEMS.find(i=>i.key===navItem.dataset.navkey);
      if(item.target==="__info__"){
        handleAction("open-about");
      } else {
        goTo(item.target);
      }
      return;
    }

    const actionBtn = e.target.closest("[data-action]");
    if(actionBtn){ handleAction(actionBtn.dataset.action); return; }

    // segmented / option control selection
    const segBtn = e.target.closest(".seg button");
    if(segBtn){
      const seg = segBtn.closest(".seg");
      $$("button", seg).forEach(b=>b.classList.remove("selected"));
      segBtn.classList.add("selected");
      onSegChange(seg.id, segBtn.dataset.val);
      return;
    }
  });

  function handleAction(action){
    if(action==="open-about") $("#aboutModal").classList.add("visible");
    if(action==="close-about") $("#aboutModal").classList.remove("visible");
    if(action==="download-report") downloadReport();
    if(action==="export-csv") exportCsv();
    if(action==="save-finish") finishAndSave();
  }

  /* ---------------- BERANDA ---------------- */
  function renderBeranda(){
    $("#statPasien").textContent = history.length;
    const list = history.slice(0,3);
    $("#homeHistoryList").innerHTML = list.map(h=>historyItemHTML(h)).join("") ||
      `<p style="font-size:12.5px;color:var(--ink-300);">Belum ada riwayat pemeriksaan.</p>`;
  }

  function historyItemHTML(h){
    const rt = RESULT_TEXT[h.tier];
    const cls = rt.cls;
    return `<div class="history-item ${cls==='high'?'high':''}">
      <div class="num" style="background:${cls==='high'?'var(--red-600)':'var(--green-700)'}">${cls==="high"?"!":"✓"}</div>
      <div class="content">
        <h4>${h.name}</h4>
        <p>${rt.label}</p>
        <span class="pill ${CLS_PILL[cls]}">${cls==='high'?"Rujukan":"Selesai"}</span>
      </div>
      <span class="history-time">${h.when}</span>
    </div>`;
  }

  /* ---------------- DATA PASIEN (Nama, Usia, Gender, BB, TB) ---------------- */
  function onSegChange(segId, val){
    if(segId==="pGender") state.patient.gender = val;
    if(segId==="pAgeUnit"){
      state.patient.ageUnit = val;
      const unitLabel = val==="hari" ? "Hari" : val==="bulan" ? "Bulan" : "Tahun";
      $("#pAgeUnitLabel").textContent = unitLabel;
    }
    validatePatientForm();
  }

  function validateAge(){
    const val = $("#pAge").value;
    const errEl = $("#pAgeError");
    if(!val){ errEl.style.display="none"; return false; }
    const days = ageToDays(val, state.patient.ageUnit);
    if(days < AGE_MIN_DAYS){
      errEl.textContent = "Usia terlalu muda. Batas bawah TWINKHDS adalah lebih dari 28 hari.";
      errEl.style.display = "block";
      return false;
    }
    if(days >= AGE_MAX_DAYS){
      errEl.textContent = "Usia terlalu tua. Batas atas TWINKHDS adalah kurang dari 18 tahun.";
      errEl.style.display = "block";
      return false;
    }
    errEl.style.display = "none";
    return true;
  }

  function validatePatientForm(){
    const p = state.patient;
    const ageOk = validateAge();
    const ok = $("#pName").value.trim().length>1 && $("#pAge").value && ageOk && p.gender
      && $("#pWeight").value && $("#pHeight").value;
    $("#btnLanjutEvaluasi").disabled = !ok;
  }
  $("#pName")   && $("#pName").addEventListener("input", ()=>{ state.patient.name=$("#pName").value; validatePatientForm(); });
  $("#pAge")    && $("#pAge").addEventListener("input", ()=>{ state.patient.age=$("#pAge").value; validatePatientForm(); });
  $("#pWeight") && $("#pWeight").addEventListener("input", ()=>{ state.patient.weight=$("#pWeight").value; validatePatientForm(); });
  $("#pHeight") && $("#pHeight").addEventListener("input", ()=>{ state.patient.height=$("#pHeight").value; validatePatientForm(); });

  $("#btnLanjutEvaluasi") && $("#btnLanjutEvaluasi").addEventListener("click", ()=>{
    if($("#btnLanjutEvaluasi").disabled) return;
    goTo("panduan-auskultasi");
  });

  /* ---------------- PANDUAN -> PROSES AUSKULTASI (disinkronkan dgn perangkat fisik) ---------------- */
  function renderPointList(activeIdx, mode){
    $("#pointList").innerHTML = POINTS.map((p,i)=>{
      const done = state.points[i];
      let cls = "point-row";
      if(i===activeIdx && (mode==="recording"||mode==="badsignal")) cls+=" active"; else if(done) cls+=" done";
      let statusHtml = "";
      if(done){
        statusHtml = `<span class="point-status pill-tag tag-normal">✓ Terekam</span>`;
      } else if(i===activeIdx && mode==="recording"){
        statusHtml = `<span class="point-status" style="color:var(--green-700)">Merekam…</span>`;
      } else if(i===activeIdx && mode==="badsignal"){
        statusHtml = `<span class="point-status pill-tag tag-wheeze">Sinyal Lemah, Mengulang</span>`;
      }
      return `<div class="${cls}"><div class="point-num">${p.code}</div><div class="point-name"><b style="text-transform:uppercase;">${p.name}</b><span class="point-desc">${p.desc}</span></div>${statusHtml}</div>`;
    }).join("");
    updateLanjutButton();
  }

  function updateLanjutButton(){
    const btn = $("#btnLanjutAuskultasi");
    if(!btn) return;
    const allDone = state.points.length===4 && state.points.every(p=>p);
    btn.disabled = !allDone;
  }

  function setTimerDisplay(pct, secLabel){
    $("#timerBarFill").style.width = (pct*100)+"%";
    $("#timerNum").textContent = secLabel;
  }

  function syncAuscultationScreen(){
    state.points = new Array(4).fill(null);
    const snap = window.TwinkhdsDevice ? window.TwinkhdsDevice.getSnapshot() : null;
    if(snap){
      snap.results.forEach((r,i)=>{ if(r) state.points[i] = { id:i+1, code:snap.pointCodes[i], name:snap.pointNames[i], desc:snap.pointDescs[i], murmur:r.murmur, prob:r.prob }; });
      if(snap.state === "recording"){
        $("#activePointLabel").textContent = `Titik Aktif: ${snap.pointNames[snap.cursor]} (${snap.pointDescs[snap.cursor].toLowerCase()})`;
        renderPointList(snap.cursor, "recording");
      } else if(snap.state === "badsignal"){
        $("#activePointLabel").textContent = `⚠ Sinyal Lemah, Mengulang Titik ${snap.pointNames[snap.cursor]}`;
        renderPointList(snap.cursor, "badsignal");
      } else if(snap.state === "allDone"){
        $("#activePointLabel").textContent = "✓ 4 Titik Selesai Direkam";
        renderPointList(-1, "waiting");
      } else {
        $("#activePointLabel").textContent = "Menunggu perangkat mulai merekam…";
        renderPointList(-1, "waiting");
      }
    } else {
      $("#activePointLabel").textContent = "Menunggu perangkat mulai merekam…";
      renderPointList(-1, "waiting");
    }
    setTimerDisplay(0, "00:00 / 00:15");
  }

  let phoneAusTimer = null;

  document.addEventListener("twinkhds:point-start", (e)=>{
    const { index, name, desc, duration } = e.detail;
    if(!isScreenVisible("proses-auskultasi")) return;
    $("#activePointLabel").textContent = `Titik Aktif: ${name} (${desc.toLowerCase()})`;
    renderPointList(index, "recording");
    let elapsed = 0;
    clearInterval(phoneAusTimer);
    phoneAusTimer = setInterval(()=>{
      elapsed += 100;
      const pct = clamp(elapsed/(duration*1000), 0, 1);
      const shown = Math.min(15, Math.ceil((elapsed/1000)*(15/duration)));
      setTimerDisplay(pct, `00:${String(shown).padStart(2,"0")} / 00:15`);
      if(elapsed >= duration*1000) clearInterval(phoneAusTimer);
    }, 100);
  });

  document.addEventListener("twinkhds:signal-warning", (e)=>{
    if(!isScreenVisible("proses-auskultasi")) return;
    clearInterval(phoneAusTimer);
    const snap = window.TwinkhdsDevice.getSnapshot();
    $("#activePointLabel").textContent = `⚠ Sinyal Lemah, Mengulang Titik ${snap.pointNames[e.detail.index]}`;
    setTimerDisplay(1, "Mengulang…");
    renderPointList(e.detail.index, "badsignal");
  });

  document.addEventListener("twinkhds:point-result", (e)=>{
    const { index, code, name, desc, murmur, prob } = e.detail;
    state.points[index] = { id:index+1, code, name, desc, murmur, prob };
    if(isScreenVisible("proses-auskultasi")){
      renderPointList(index, "complete");
    }
  });

  document.addEventListener("twinkhds:all-done", ()=>{
    if(!isScreenVisible("proses-auskultasi")) return;
    $("#activePointLabel").textContent = "✓ 4 Titik Selesai Direkam";
    setTimerDisplay(1, "00:15 / 00:15");
    renderPointList(-1, "waiting");
  });

  document.addEventListener("twinkhds:reset", ()=>{
    if(isScreenVisible("proses-auskultasi")) syncAuscultationScreen();
  });

  // Setelah 4 titik selesai direkam, langsung lanjut ke Proses AI (Berat/Tinggi Badan
  // sudah diisi sejak layar Data Pasien, jadi tidak ada layar parameter terpisah).
  $("#btnLanjutAuskultasi") && $("#btnLanjutAuskultasi").addEventListener("click", ()=>{
    if($("#btnLanjutAuskultasi").disabled) return;
    goTo("proses-ai");
    runAIProcessing();
  });

  /* ---------------- PROSES AI ---------------- */
  function runAIProcessing(){
    const rows = $$("#aiSteps .step-row");
    rows.forEach(r=>{ r.classList.remove("done","current"); $(".step-tag",r).textContent="ANTRIAN"; });
    let i=0;
    function next(){
      if(!isScreenVisible("proses-ai")) return;
      if(i>0){ rows[i-1].classList.remove("current"); rows[i-1].classList.add("done"); $(".step-tag",rows[i-1]).textContent="SELESAI"; }
      if(i>=rows.length){
        computeResult();
        setTimeout(()=>{ if(isScreenVisible("proses-ai")) goTo("hasil-skrining"); }, 450);
        return;
      }
      rows[i].classList.add("current");
      $(".step-tag",rows[i]).textContent="MEMPROSES";
      i++;
      setTimeout(next, 700);
    }
    next();
  }

  /* ---------------- SIMULASI SKORING (Model 1 CNN -> MAX Pooling -> Model 2 Logistic Regression) ---------------- */
  function computeResult(){
    const p = state.patient;

    const pointProbs = state.points.map(pt=> pt ? pt.prob : 0);
    const probMurmur = Math.max(0, ...pointProbs); // agregasi 4 titik via MAX Pooling
    const murmurCount = state.points.filter(pt=>pt && pt.murmur).length;

    const ageY = ageToYears(p.age, p.ageUnit) || 5;
    const ageDisplay = formatAgeDisplay(p.age||"-", p.ageUnit);
    const weight = parseFloat(p.weight) || 15;
    const height = parseFloat(p.height) || 95;
    const genderVal = p.gender === "P" ? 1 : 0;

    /* Z = β0 + β1(Prob.Murmur) + β2(Usia) + β3(Gender) + β4(BB) + β5(TB)
       Koefisien di bawah ini HANYA untuk simulasi tampilan antarmuka
       (lihat modal "Tentang"), bukan hasil pelatihan model sesungguhnya. */
    const z = -3.0
      + 6.4 * probMurmur
      + 0.05 * (ageY - 5)
      + 0.15 * genderVal
      + 0.01 * (weight - 20)
      - 0.006 * (height - 110)
      + rand(-0.35, 0.35);
    const pAbnormal = 1 / (1 + Math.exp(-z));
    const tier = pAbnormal >= 0.5 ? "abnormal" : "normal";           // threshold 0,5, bawaan sigmoid
    const confidence = (tier==="abnormal" ? pAbnormal : (1-pAbnormal)) * 100;

    /* Kontribusi faktor: Odds Ratio (tim internal) & LinearSHAP (nakes) - simulasi tampilan */
    const factors = [];
    factors.push(probMurmur>=0.5
      ? { label:`Probabilitas Murmur Tinggi (${Math.round(probMurmur*100)}%)`, weight:probMurmur*100, positive:true }
      : { label:`Probabilitas Murmur Rendah (${Math.round(probMurmur*100)}%)`, weight:(1-probMurmur)*60, positive:false });
    factors.push({ label:`Usia (${ageDisplay})`, weight:clamp(Math.abs(ageY-5)*6+18,0,100), positive: ageY<1 || ageY>12 });
    factors.push({ label:`Jenis Kelamin (${genderVal===1?"Perempuan":"Laki-laki"})`, weight:22, positive: genderVal===1 });
    factors.push({ label:`Berat Badan (${weight} Kg)`, weight:clamp(Math.abs(weight-20)*2+16,0,100), positive: weight<12 || weight>35 });
    factors.push({ label:`Tinggi Badan (${height} Cm)`, weight:clamp(Math.abs(height-110)/1.5+16,0,100), positive: height<85 });

    const finalFactors = factors.sort((a,b)=>b.weight-a.weight).slice(0,5);
    const sumW = finalFactors.reduce((s,f)=>s+f.weight,0) || 1;
    finalFactors.forEach(f=>{
      f.relPct = Math.round((f.weight/sumW)*100);
      const magnitude = 0.08 + (f.weight/100)*0.42 + rand(-0.02,0.02);
      f.shap = (f.positive ? magnitude : -magnitude);
      // Odds Ratio disimulasikan dari arah & besar kontribusi SHAP (OR=1 artinya netral)
      f.oddsRatio = Math.exp(f.shap * 2.3);
    });

    state.result = {
      tier, confidence, probMurmur, murmurCount,
      ageY, ageDisplay, weight, height, gender:p.gender,
      factors: finalFactors,
    };
  }

  /* ---------------- HASIL ---------------- */
  function renderHasil(){
    const r = state.result;
    if(!r) return;
    const rt = RESULT_TEXT[r.tier];
    const banner = $("#resultBanner");
    banner.className = "result-banner " + rt.cls;
    $("#resultTitle").textContent = rt.label;
    $("#resultSub").textContent = rt.sub;
    $("#resultAcousticTag").textContent = "Skor Probabilitas: " + r.confidence.toFixed(1) + "%";

    $("#actionChecklist").innerHTML = rt.checklist.map(t=>`
      <label class="check-row"><input type="checkbox"><span>${t}</span></label>`).join("");
    $("#resultActionNote").textContent = rt.action;

    $("#resultPointList").innerHTML = state.points.map((pt,i)=>{
      const tag = pt && pt.murmur ? ["tag-crackle","Murmur"] : ["tag-normal","Normal"];
      return `<div class="point-row done"><div class="point-num">${POINTS[i].code}</div><div class="point-name"><b style="text-transform:uppercase;">${POINTS[i].name}</b><span class="point-desc">${POINTS[i].desc}</span></div><span class="point-status pill-tag ${tag[0]}">${tag[1]}</span></div>`;
    }).join("");
  }

  /* ---------------- PENJELASAN AI (Grad-CAM) ---------------- */
  const ACOUSTIC_INFO = {
    murmur: { pattern:"murmur sistolik/diastolik", range:"100-600 Hz" },
    normal: { pattern:"pola suara jantung normal (S1-S2)", range:"20-150 Hz, tanpa bunyi tambahan" },
  };

  function renderPenjelasan(){
    const r = state.result;
    if(!r) return;
    const rt = RESULT_TEXT[r.tier];
    const key = r.probMurmur>=0.5 ? "murmur" : "normal";
    const info = ACOUSTIC_INFO[key];
    $("#clinicalInterpretationText").textContent =
      key === "normal"
        ? `Tidak ditemukan area intensitas tinggi (merah/kuning) yang signifikan pada spektrogram di keempat titik. Pola suara jantung berada dalam rentang normal (${info.range}), mendukung klasifikasi ${rt.label}.`
        : `Area dengan intensitas tinggi (merah/kuning) pada spektrogram menandakan fitur akustik yang paling berkontribusi terhadap keluaran Grad-CAM Model 1 (CNN). Pola ini terdeteksi pada titik dengan probabilitas murmur tertinggi, sering berkorelasi dengan indikasi ${info.pattern} (${info.range}), mendukung klasifikasi ${rt.label}.`;

    drawSpectrogram(rt.cls, key, info);
  }

  function drawSpectrogram(cls, key, info){
    const canvas = $("#spectroCanvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#0A0E14";
    ctx.fillRect(0,0,W,H);

    const margin = { left:42, right:64, top:14, bottom:26 };
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;
    const hotChance = cls==="high" ? 0.32 : 0.06;

    const cols = 46, rows = 20;
    const cw = plotW/cols, ch = plotH/rows;
    let hotXCenterSum = 0, hotCount = 0;

    for(let x=0;x<cols;x++){
      for(let y=0;y<rows;y++){
        const centerBias = 1 - Math.abs((y/rows)-0.72)*1.3; // aktivitas suara jantung terkonsentrasi di frekuensi rendah
        let v = Math.random()*0.45 + Math.random()*Math.max(centerBias,0)*0.5;
        if(Math.random() < hotChance*Math.max(centerBias,0) && x < cols*0.55){ v = 0.7 + Math.random()*0.3; hotXCenterSum += x; hotCount++; }
        const hue = v>0.62 ? lerpColor([201,54,74], [255,196,0], (v-0.62)/0.38) : lerpColor([10,40,55],[40,150,140], v/0.62);
        ctx.fillStyle = `rgb(${hue[0]},${hue[1]},${hue[2]})`;
        ctx.globalAlpha = 0.6 + v*0.4;
        ctx.fillRect(margin.left + x*cw, margin.top + (rows-1-y)*ch, cw+0.6, ch+0.6);
      }
    }
    ctx.globalAlpha = 1;

    /* ---- sumbu Y (Frekuensi, rentang suara jantung) ---- */
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, margin.top+plotH); ctx.lineTo(margin.left+plotW, margin.top+plotH);
    ctx.stroke();
    const yTicks = [["600",0.02],["450",0.27],["300",0.52],["150",0.74],["20",0.97]];
    yTicks.forEach(([label,frac])=>{
      const ypx = margin.top + plotH*frac;
      ctx.fillText(label, margin.left-6, ypx);
    });
    ctx.save();
    ctx.translate(11, margin.top+plotH/2);
    ctx.rotate(-Math.PI/2);
    ctx.textAlign = "center";
    ctx.fillText("Frekuensi (Hz)", 0, 0);
    ctx.restore();

    /* ---- sumbu X (Waktu) ---- */
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for(let t=0; t<=3.0001; t+=0.5){
      const xpx = margin.left + (t/3)*plotW;
      ctx.fillText(t.toFixed(1), xpx, margin.top+plotH+6);
    }
    ctx.fillText("Waktu (s)", margin.left+plotW/2, margin.top+plotH+16);

    /* ---- legend Aktivasi (kanan) ---- */
    const lgX = margin.left+plotW+16, lgY = margin.top+2, lgW = 10, lgH = plotH*0.62;
    const grad = ctx.createLinearGradient(0, lgY, 0, lgY+lgH);
    grad.addColorStop(0, "rgb(255,60,60)"); grad.addColorStop(0.5, "rgb(255,196,0)"); grad.addColorStop(1, "rgb(20,70,90)");
    ctx.fillStyle = grad;
    ctx.fillRect(lgX, lgY, lgW, lgH);
    ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.strokeRect(lgX, lgY, lgW, lgH);
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = "8.5px Inter, sans-serif";
    ctx.fillText("Aktivasi", lgX-2, lgY-9);
    ctx.fillText("Tinggi", lgX+lgW+4, lgY+4);
    ctx.fillText("Rendah", lgX+lgW+4, lgY+lgH-4);

    /* ---- anotasi pola dominan ---- */
    if(key !== "normal" && hotCount>0){
      const hotXFrac = (hotXCenterSum/hotCount)/cols;
      const bx = margin.left + hotXFrac*plotW + cw*2;
      const by = margin.top + plotH*0.68;
      const lx = bx + 34;
      ctx.strokeStyle = "rgba(255,180,190,.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by-16); ctx.lineTo(lx-8, by-16);
      ctx.lineTo(lx-8, by+16); ctx.lineTo(bx, by+16);
      ctx.moveTo(lx-8, by); ctx.lineTo(lx, by);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,205,210,.95)";
      ctx.font = "8.5px Inter, sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const label1 = "Aktivasi dominan:";
      const label2 = info.pattern;
      const label3 = `(${info.range})`;
      ctx.fillText(label1, lx+4, by-9);
      ctx.fillText(label2, lx+4, by+1);
      ctx.fillText(label3, lx+4, by+11);
    }
  }
  function lerpColor(a,b,t){
    t = clamp(t,0,1);
    return [ Math.round(a[0]+(b[0]-a[0])*t), Math.round(a[1]+(b[1]-a[1])*t), Math.round(a[2]+(b[2]-a[2])*t) ];
  }

  /* ---------------- KONTRIBUSI PARAMETER (Odds Ratio & LinearSHAP, ditampilkan terpisah) ---------------- */
  function factorRowOR_HTML(f){
    const orText = f.oddsRatio.toFixed(2) + "x";
    return `<div class="factor-row">
      <div class="factor-top"><b>${f.label}</b><span class="factor-shap ${f.oddsRatio>=1?'shap-pos':'shap-neg'}">${orText}</span></div>
      <div class="factor-track"><div class="factor-fill ${f.positive? (f.weight>=70?'fill-high':'fill-mid') : 'fill-low'}" style="width:${f.weight}%"></div></div>
    </div>`;
  }
  function factorRowSHAP_HTML(f){
    const shapText = (f.shap>=0?"+":"") + f.shap.toFixed(2);
    return `<div class="factor-row">
      <div class="factor-top"><b>${f.label}</b><span class="factor-shap ${f.positive?'shap-pos':'shap-neg'}">${shapText}</span></div>
      <div class="factor-track"><div class="factor-fill ${f.positive? (f.weight>=70?'fill-high':'fill-mid') : 'fill-low'}" style="width:${f.weight}%"></div></div>
    </div>`;
  }

  function renderFaktorRisiko(){
    const r = state.result; if(!r) return;
    $("#whyTitle").textContent = "Mengapa Terdeteksi " + (r.tier==="abnormal" ? "Abnormal" : "Normal") + "?";
    $("#factorBarsOR").innerHTML = r.factors.map(f=>factorRowOR_HTML(f)).join("");
    $("#factorBarsSHAP").innerHTML = r.factors.map(f=>factorRowSHAP_HTML(f)).join("");
    $("#confidenceVal").textContent = r.confidence.toFixed(1)+"%";
  }

  /* ---------------- SAVE / FINISH ---------------- */
  function fullDateTime(){
    const d = new Date();
    const tgl = d.toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });
    return `${tgl}, ${nowHHMM()}`;
  }

  function finishAndSave(){
    const r = state.result, p = state.patient;
    if(!r){ showToast("Belum ada hasil untuk disimpan"); return; }
    const entry = {
      name: p.name || "Pasien Tanpa Nama",
      id: "P-2026-" + String(9000+history.length),
      ageDisplay: r.ageDisplay,
      gender: p.gender || "-",
      weight: r.weight, height: r.height,
      tier: r.tier, probMurmur: r.probMurmur,
      when: fullDateTime(),
    };
    history.unshift(entry);
    saveHistory(history);
    showToast("Hasil pemeriksaan tersimpan ke riwayat");
    state.patient = { name:"", age:"", ageUnit:"tahun", gender:"", weight:"", height:"" };
    state.points = new Array(4).fill(null);
    state.result = null;
    resetPatientForm();
    setTimeout(()=> goTo("beranda"), 300);
  }

  function resetPatientForm(){
    if($("#pName")) $("#pName").value = "";
    if($("#pAge")) $("#pAge").value = "";
    if($("#pWeight")) $("#pWeight").value = "";
    if($("#pHeight")) $("#pHeight").value = "";
    if($("#pAgeError")) $("#pAgeError").style.display = "none";
    $$(".seg button").forEach(b=>b.classList.remove("selected"));
    $$("#pAgeUnit button").forEach(b=>b.classList.toggle("selected", b.dataset.val==="tahun"));
    if($("#pAgeUnitLabel")) $("#pAgeUnitLabel").textContent = "Tahun";
    validatePatientForm();
  }

  /* ---------------- RIWAYAT ---------------- */
  function riwayatCardHTML(h){
    const rt = RESULT_TEXT[h.tier];
    const borderColor = rt.cls==='high'?'var(--red-600)':'var(--green-500)';
    return `<div class="hist-card" style="border-top-color:${borderColor}">
      <div class="hist-top">
        <div>
          <h4>${h.name}</h4>
          <p>ID: ${h.id}</p>
        </div>
        <span style="font-size:10.5px; color:var(--ink-300);">${h.when}</span>
      </div>
      <div class="hist-meta">
        <span>👤 ${h.ageDisplay}</span>
        <span>${h.gender==='P'?'♀':'♂'} ${h.gender==='P'?'Perempuan':'Laki-laki'}</span>
        <span class="pill ${CLS_PILL[rt.cls]}">${CLS_LABEL[rt.cls]}</span>
      </div>
      <div class="vital-grid" style="margin-top:9px;">
        <div class="vital-box"><div class="lab">TINGGI</div><div class="val">${h.height}<span style="font-size:10px;"> Cm</span></div></div>
        <div class="vital-box"><div class="lab">BERAT</div><div class="val">${h.weight}<span style="font-size:10px;"> Kg</span></div></div>
        <div class="vital-box"><div class="lab">HASIL</div><div class="val ${rt.cls==='high'?'val-danger':'val-ok'}">${CLS_LABEL[rt.cls]}</div></div>
        <div class="vital-box"><div class="lab">PROB. MURMUR</div><div class="val ${h.probMurmur>=0.5?'val-danger':'val-ok'}">${Math.round(h.probMurmur*100)}%</div></div>
      </div>
    </div>`;
  }
  function renderRiwayat(list){
    const data = list || history;
    $("#riwayatList").innerHTML = data.map(riwayatCardHTML).join("") ||
      `<p style="font-size:12.5px;color:var(--ink-300);">Tidak ada data ditemukan.</p>`;
  }
  $("#searchRiwayat") && $("#searchRiwayat").addEventListener("input",(e)=>{
    const q = e.target.value.toLowerCase();
    renderRiwayat(history.filter(h=> h.name.toLowerCase().includes(q) || h.id.toLowerCase().includes(q)));
  });

  /* ---------------- EXPORT CSV ---------------- */
  function exportCsv(){
    if(!history.length){ showToast("Belum ada data riwayat"); return; }
    const header = "Nama,ID,Usia,Jenis Kelamin,Berat Badan (Kg),Tinggi Badan (Cm),Hasil,Probabilitas Murmur (%),Tanggal Periksa\n";
    const rows = history.map(h=>{
      const rt = RESULT_TEXT[h.tier];
      return [h.name, h.id, h.ageDisplay, h.gender==='P'?'Perempuan':'Laki-laki', h.weight, h.height, rt.label, Math.round(h.probMurmur*100), h.when].join(",");
    }).join("\n");
    const blob = new Blob([header+rows], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "Riwayat_TWINKHDS.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Riwayat berhasil diekspor ke CSV");
  }

  /* ---------------- REPORT DOWNLOAD ---------------- */
  function downloadReport(){
    const r = state.result;
    if(!r){ showToast("Belum ada hasil untuk diunduh"); return; }
    const p = state.patient, rt = RESULT_TEXT[r.tier];
    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
    <title>Laporan Skrining TWINKHDS: ${p.name||"Pasien"}</title>
    <style>
      body{font-family:Arial,sans-serif; max-width:640px; margin:40px auto; color:#151A18;}
      h1{color:#0E6E4A; font-size:22px; margin-bottom:2px;}
      .tag{display:inline-block; padding:6px 14px; border-radius:20px; font-weight:700; color:#fff; margin:10px 0 18px;
           background:${rt.cls==='high'?'#D9364A':'#0E6E4A'};}
      table{width:100%; border-collapse:collapse; margin-bottom:18px;}
      td{padding:7px 4px; border-bottom:1px solid #eee; font-size:13.5px;}
      td:first-child{color:#6B746F; width:45%;}
      h3{font-size:14px; color:#0E6E4A; margin:18px 0 8px;}
      .factor{font-size:13px; padding:6px 0; border-bottom:1px dashed #eee;}
      .factor .lbl{display:block; margin-bottom:2px;}
      .factor .vals{display:flex; justify-content:space-between; color:#6B746F;}
      footer{margin-top:26px; font-size:11px; color:#9AA39D; line-height:1.6;}
    </style></head><body>
      <h1>Laporan Hasil Skrining TWINKHDS</h1>
      <div class="tag">${rt.label}</div>
      <table>
        <tr><td>Nama Pasien</td><td>${p.name||"-"}</td></tr>
        <tr><td>Usia</td><td>${r.ageDisplay}</td></tr>
        <tr><td>Jenis Kelamin</td><td>${p.gender==='P'?'Perempuan':'Laki-laki'}</td></tr>
        <tr><td>Berat / Tinggi Badan</td><td>${r.weight} Kg / ${r.height} Cm</td></tr>
        <tr><td>Probabilitas Murmur (Agregasi MAX Pooling, Model 1 CNN)</td><td>${Math.round(r.probMurmur*100)}%</td></tr>
        <tr><td>Klasifikasi Akhir (Model 2, Logistic Regression)</td><td>${rt.label}</td></tr>
        <tr><td>Rekomendasi Tindakan</td><td>${rt.action}</td></tr>
        <tr><td>Skor Probabilitas Akhir</td><td>${r.confidence.toFixed(1)}%</td></tr>
        <tr><td>Tanggal Periksa</td><td>${fullDateTime()}</td></tr>
      </table>
      <h3>Odds Ratio</h3>
      ${r.factors.map(f=>`<div class="factor"><span class="lbl">${f.label}</span><div class="vals"><span>OR</span><span>${f.oddsRatio.toFixed(2)}x</span></div></div>`).join("")}
      <h3>LinearSHAP</h3>
      ${r.factors.map(f=>`<div class="factor"><span class="lbl">${f.label}</span><div class="vals"><span>SHAP</span><span>${(f.shap>=0?"+":"")+f.shap.toFixed(2)}</span></div></div>`).join("")}
      <footer>
        Dokumen ini dihasilkan oleh prototipe antarmuka TWINKHDS untuk keperluan demonstrasi Lomba Esai Nasional GEMASTE X EXPO 2026.
        Seluruh nilai bersifat simulasi dan tidak merepresentasikan hasil diagnosis medis sesungguhnya.
        Dibuat: ${new Date().toLocaleString("id-ID")}
      </footer>
    </body></html>`;
    const blob = new Blob([html], {type:"text/html"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Laporan_TWINKHDS_${(p.name||"pasien").replace(/\s+/g,"_")}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Laporan berhasil diunduh");
  }

  /* ---------------- clock ---------------- */
  function nowHHMM(){
    const d = new Date();
    return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
  }
  function tickClock(){ const el = $("#clock"); if(el) el.textContent = nowHHMM(); }

  /* ---------------- init ---------------- */
  function init(){
    renderBottomNav();
    goTo("beranda");
    tickClock();
    setInterval(tickClock, 15000);
    const grp = NAV_GROUP["beranda"];
    $$(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.navkey===grp));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
