/* =========================================================
   TWINKHDS - Physical Device Simulation
   Satu halaman LCD (sesuai referensi), 3 tombol (kiri/pilih/kanan).
   Device adalah "sumber kebenaran": saat merekam titik di device,
   perangkat mengirim event yang didengarkan oleh simulasi HP (app.js)
   agar progres & hasil selalu identik.

   4 titik auskultasi standar (listening posts):
   A = Aortic (sela iga ke-2 kanan) | P = Pulmonal (sela iga ke-2 kiri)
   T = Trikuspid (sela iga ke-4 kiri) | M = Mitral (apeks jantung)
   ========================================================= */
(function(){
  "use strict";

  const POINT_NAMES = [
    "Aortic (Sela Iga ke-2 Kanan)",
    "Pulmonal (Sela Iga ke-2 Kiri)",
    "Trikuspid (Sela Iga ke-4 Kiri)",
    "Mitral (Apeks Jantung)",
  ];
  const POINT_CODES = ["A","P","T","M"];
  // Posisi titik (dalam %) mengikuti lokasi anatomis pada gambar diagram dada
  const POINT_XY = [
    { x:39.95, y:36.6 },
    { x:59.57, y:36.6 },
    { x:63.6,  y:53.4 },
    { x:66.8,  y:61.9 },
  ];
  const REC_SECONDS = 3;          // durasi rekam per titik (dipercepat utk demo; alat asli 15 detik)
  const BAD_SIGNAL_CHANCE = 0.16; // peluang SQI (Signal Quality Index) gagal -> retry otomatis

  const D = {
    state: "idle",   // idle | recording | badsignal | complete | allDone
    cursor: 0,
    done: [false,false,false,false],
    results: [null,null,null,null], // {murmur, prob}
    recElapsed: 0,
    recTimer: null,
    phoneReady: false, // true only when phone/HP is on the "proses-auskultasi" screen
  };

  const $ = (sel) => document.querySelector(sel);
  const lcd = () => $("#deviceLcd");

  function emit(name, detail){
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  // Simulasi output Model 1 (CNN) per titik: probabilitas murmur.
  // Rasio Absent:Present pada dataset CirCor kira-kira 4:1, disimulasikan di sini.
  function weightedResult(){
    const murmur = Math.random() < 0.25;
    const prob = murmur ? (0.55 + Math.random()*0.42) : (0.03 + Math.random()*0.40);
    return { murmur, prob };
  }

  /* ---------- diagram titik auskultasi (pakai foto anatomis asli) ---------- */
  function bodyDiagram(){
    const markers = POINT_XY.map((pt,i)=>{
      const isActive = i === D.cursor;
      const done = D.results[i];
      let ringClass = "dlcd-marker";
      if(done) ringClass += " marker-done";
      if(isActive && D.state === "idle") ringClass += " marker-active";
      if(isActive && D.state === "recording") ringClass += " marker-recording";
      if(isActive && D.state === "badsignal") ringClass += " marker-badsignal";
      return `<div class="${ringClass}" style="left:${pt.x}%; top:${pt.y}%;"><span>${POINT_CODES[i]}</span></div>`;
    }).join("");
    return `<div class="dlcd-diagram-wrap">
      <img src="assets/auskultasi-4titik.jpg" class="dlcd-diagram-img" alt="4 titik auskultasi jantung">
      ${markers}
    </div>`;
  }

  function battWifi(){
    return `<div class="dlcd-status">
      <div class="dlcd-batt"><i></i><i></i><i></i><span class="cap"></span></div>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1C9660" stroke-width="2.6" stroke-linecap="round"><path d="M9 17H7a5 5 0 010-10h2"/><path d="M15 7h2a5 5 0 010 10h-2"/><path d="M8 12h8"/></svg>
    </div>`;
  }

  function updateLED(){
    const led = $("#deviceLed");
    if(!led) return;
    const isRecording = D.state === "recording";
    led.classList.toggle("led-green", isRecording);
    led.classList.toggle("led-red", !isRecording);
  }

  /* ---------- single-page render ---------- */
  function render(){
    const el = lcd();
    if(!el) return;
    updateLED();

    if(!D.phoneReady && D.state === "idle"){
      el.innerHTML = `
        <div class="dlcd-header"><b>TWINKHDS</b>${battWifi()}</div>
        <div class="dlcd-gate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>
          <b>Menunggu Perangkat</b>
          <span>Isi data pasien terlebih dahulu pada "Mulai Sekarang", lalu "Mulai Auskultasi" untuk mengaktifkan alat ini</span>
        </div>`;
      return;
    }

    const allDone = D.state === "allDone";
    const headerLabel = allDone ? "Selesai 4/4" : `Titik ${D.cursor+1}/4`;

    // progress bar
    let pct = 0, timeLabel = `15 detik`;
    if(D.state === "recording"){
      pct = Math.min(100, (D.recElapsed/REC_SECONDS)*100);
      const remain15 = Math.max(0, Math.ceil(15 - (D.recElapsed/REC_SECONDS)*15));
      timeLabel = `${remain15} detik`;
    } else if(D.state === "complete" || D.state === "badsignal" || allDone){
      pct = 100; timeLabel = "0 detik";
    }

    // bottom-left status block
    let resultHTML;
    const res = D.results[D.cursor];
    if(allDone){
      resultHTML = `<b style="color:#0E6E4A; font-size:11px;">✓ SELESAI</b><span>Lanjutkan di Web Lokal</span>`;
    } else if(D.state === "recording"){
      resultHTML = `<b style="color:#3A423F;">MEREKAM…</b><span>Jangan gerakkan stetoskop</span>`;
    } else if(D.state === "badsignal"){
      resultHTML = `<b style="color:#C98A00;">SQI GAGAL</b><span>Sinyal kurang jelas, mengulang…</span>`;
    } else if(res){
      resultHTML = `<b style="color:#007A7A;">✓ TEREKAM</b><span>Lanjut ke titik berikutnya</span>`;
    } else {
      resultHTML = `<b style="color:#3A423F; font-size:8px;">SIAP MEREKAM</b><span>Tekan PILIH untuk mulai</span>`;
    }

    const pointLabel = allDone ? "4/4 TITIK TEREKAM" : `${POINT_CODES[D.cursor]}: ${POINT_NAMES[D.cursor].toUpperCase()}`;

    el.innerHTML = `
      <div class="dlcd-header"><b>${headerLabel}</b>${battWifi()}</div>
      <div class="dlcd-bar-row" style="padding:0 6%;">
        <div class="dlcd-bar"><div class="dlcd-bar-fill" style="width:${pct}%"></div></div>
        <b>${timeLabel}</b>
      </div>
      <div class="dlcd-body">
        ${bodyDiagram()}
      </div>
      <div class="dlcd-resultrow">
        <div class="dlcd-result">${resultHTML}</div>
        <div class="dlcd-pointname">${pointLabel}</div>
      </div>`;
  }

  /* ---------- transitions ---------- */
  function flashDenied(){
    const el = $(".device");
    if(!el) return;
    el.classList.remove("denied");
    void el.offsetWidth; // restart animation
    el.classList.add("denied");
  }

  function pressKiri(){
    if(!D.phoneReady){ flashDenied(); return; }
    if(D.state !== "idle") return;
    D.cursor = (D.cursor + 3) % 4;
    render();
  }
  function pressKanan(){
    if(!D.phoneReady){ flashDenied(); return; }
    if(D.state !== "idle") return;
    D.cursor = (D.cursor + 1) % 4;
    render();
  }
  function pressPilih(){
    if(!D.phoneReady){ flashDenied(); return; }
    if(D.state === "idle"){
      startRecording();
      return;
    }
    if(D.state === "allDone"){
      D.done = [false,false,false,false];
      D.results = [null,null,null,null];
      D.cursor = 0;
      D.state = "idle";
      render();
      emit("twinkhds:reset", {});
      return;
    }
    // recording / badsignal: tombol tidak berfungsi, otomatis berjalan
  }

  function startRecording(){
    D.state = "recording";
    D.recElapsed = 0;
    render();
    emit("twinkhds:point-start", { index: D.cursor, name: POINT_NAMES[D.cursor], code: POINT_CODES[D.cursor], duration: REC_SECONDS });

    clearInterval(D.recTimer);
    D.recTimer = setInterval(()=>{
      D.recElapsed += 0.1;
      if(D.recElapsed >= REC_SECONDS){
        clearInterval(D.recTimer);
        finishRecording();
        return;
      }
      render();
    }, 100);
  }

  function finishRecording(){
    const badSignal = Math.random() < BAD_SIGNAL_CHANCE;
    if(badSignal){
      D.state = "badsignal";
      render();
      emit("twinkhds:signal-warning", { index: D.cursor });
      setTimeout(()=>{ startRecording(); }, 1500);
      return;
    }

    const { murmur, prob } = weightedResult();
    D.results[D.cursor] = { murmur, prob };
    D.done[D.cursor] = true;
    D.state = "complete";
    render();
    emit("twinkhds:point-result", { index: D.cursor, name: POINT_NAMES[D.cursor], code: POINT_CODES[D.cursor], murmur, prob });

    setTimeout(()=>{
      const next = D.done.findIndex(v=>!v);
      if(next === -1){
        D.state = "allDone";
        render();
        emit("twinkhds:all-done", {});
      } else {
        D.cursor = next;
        D.state = "idle";
        render();
      }
    }, 1100);
  }

  /* ---------- public snapshot for app.js ---------- */
  window.TwinkhdsDevice = {
    getSnapshot(){
      return {
        state: D.state,
        cursor: D.cursor,
        done: D.done.slice(),
        results: D.results.slice(),
        pointNames: POINT_NAMES.slice(),
        pointCodes: POINT_CODES.slice(),
      };
    }
  };

  /* ---------- button wiring with press visual feedback ---------- */
  function bind(){
    document.querySelectorAll(".device-btn").forEach(btn=>{
      const fire = ()=>{
        btn.classList.add("pressed");
        setTimeout(()=>btn.classList.remove("pressed"), 160);
        const which = btn.dataset.devbtn;
        if(which==="kiri") pressKiri();
        else if(which==="kanan") pressKanan();
        else if(which==="pilih") pressPilih();
      };
      btn.addEventListener("click", fire);
    });
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    bind();
    render();
  });

  document.addEventListener("twinkhds:phone-nav", (e)=>{
    const ready = e.detail.screen === "proses-auskultasi";
    if(ready !== D.phoneReady){
      D.phoneReady = ready;
      render();
    }
  });
})();
