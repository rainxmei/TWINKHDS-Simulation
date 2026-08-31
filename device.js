/* =========================================================
   TWINKHDS - Physical Device Simulation
   Satu halaman LCD (sesuai referensi), 3 tombol (kiri/pilih/kanan).
   Device adalah "sumber kebenaran": saat merekam titik di device,
   perangkat mengirim event yang didengarkan oleh simulasi HP (app.js)
   agar progres & hasil selalu identik.

   4 titik auskultasi standar (listening posts):
   A = Aorta (sela iga kedua kanan) | P = Pulmonal (sela iga kedua kiri)
   T = Trikuspid (sela iga keempat kiri) | M = Mitral (apeks jantung)
   ========================================================= */
(function(){
  "use strict";

  const POINT_NAMES = ["Aorta","Pulmonal","Trikuspid","Mitral"];
  const POINT_DESCS = [
    "Sela iga kedua kanan",
    "Sela iga kedua kiri",
    "Sela iga keempat kiri",
    "Apeks jantung",
  ];
  const POINT_CODES = ["A","P","T","M"];
  // Posisi titik (dalam %) mengikuti lokasi lingkaran nomor pada gambar LCD (versi berlabel)
  const POINT_XY = [
    { x:43.85, y:36.60 },
    { x:55.84, y:36.62 },
    { x:58.30, y:53.47 },
    { x:60.28, y:61.89 },
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
    probeAttached: false, // hanya dipakai internal simulasi; tidak ditampilkan sebagai status di LCD
    recordingHadContact: false, // snapshot kondisi probe saat tombol PILIH memulai rekaman
    lastWeakSignal: false, // menyimpan hasil sinyal lemah sampai pengguna memulai/memilih rekaman lain
    weakSignalIndex: null,
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
      <img src="assets/auskultasi-lcd.png" class="dlcd-diagram-img" alt="4 titik auskultasi jantung">
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
      resultHTML = `<b style="color:#0E6E4A;">✓ SELESAI</b><span>Lanjutkan di Web Lokal</span>`;
    } else if(D.state === "recording"){
      resultHTML = `<b style="color:#3A423F;">MEREKAM…</b><span>Jangan gerakkan stetoskop</span>`;
    } else if(D.state === "badsignal"){
      resultHTML = `<b style="color:#C98A00;">SINYAL LEMAH</b><span>Sinyal lemah, mengulang…</span>`;
    } else if(res){
      resultHTML = `<b style="color:#007A7A;">✓ TEREKAM</b><span>Lanjut ke titik berikutnya</span>`;
    } else if(D.lastWeakSignal && D.weakSignalIndex === D.cursor){
      resultHTML = `<b style="color:#C98A00;">SINYAL LEMAH</b><span>Ulangi rekaman titik ini</span>`;
    } else {
      // LCD sengaja tidak menampilkan apakah stetoskop sedang menempel atau tidak.
      // Pada alat nyata, posisi fisik stetoskop tidak bisa diketahui hanya dari UI ini.
      resultHTML = `<b style="color:#3A423F;">SIAP MEREKAM</b><span>Tempatkan stetoskop, lalu tekan PILIH</span>`;
    }

    const pointLabel = allDone
      ? `<b>4/4 TITIK TEREKAM</b>`
      : `<b>${POINT_CODES[D.cursor]}. ${POINT_NAMES[D.cursor].toUpperCase()}</b><br><span class="dlcd-pointdesc">${POINT_DESCS[D.cursor]}</span>`;

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

    syncPointVisuals();
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
    D.lastWeakSignal = false;
    D.weakSignalIndex = null;
    if(D.probeAttached){ D.probeAttached = false; resetProbePosition(true); }
    render();
  }
  function pressKanan(){
    if(!D.phoneReady){ flashDenied(); return; }
    if(D.state !== "idle") return;
    D.cursor = (D.cursor + 1) % 4;
    D.lastWeakSignal = false;
    D.weakSignalIndex = null;
    if(D.probeAttached){ D.probeAttached = false; resetProbePosition(true); }
    render();
  }
  function pressPilih(){
    if(!D.phoneReady){ flashDenied(); return; }
    if(D.state === "idle"){
      // Rekaman SELALU dimulai saat tombol PILIH ditekan.
      // Ada/tidaknya kontak stetoskop baru dinilai setelah durasi rekaman selesai.
      startRecording();
      return;
    }
    // allDone / recording / badsignal: tombol tidak berfungsi di state ini.
    // Lanjut ke analisis dilakukan lewat tombol di layar HP, bukan lewat alat.
  }

  function startRecording(){
    D.state = "recording";
    D.recordingHadContact = D.probeAttached;
    D.lastWeakSignal = false;
    D.weakSignalIndex = null;
    D.recElapsed = 0;
    render();
    emit("twinkhds:point-start", { index: D.cursor, name: POINT_NAMES[D.cursor], desc: POINT_DESCS[D.cursor], code: POINT_CODES[D.cursor], duration: REC_SECONDS });

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
    // Jika rekaman dimulai tanpa kontak stetoskop ke titik auskultasi,
    // alat tetap menyelesaikan durasi rekaman terlebih dahulu. Baru setelah itu
    // hasil kualitas sinyal dinyatakan lemah.
    const noHeartSignal = !D.recordingHadContact;
    const badSignal = noHeartSignal || Math.random() < BAD_SIGNAL_CHANCE;
    if(badSignal){
      D.state = "badsignal";
      render();
      emit("twinkhds:signal-warning", { index: D.cursor, noProbe: noHeartSignal });

      if(noHeartSignal){
        // Jangan auto-retry saat tidak ada sinyal jantung: pengguna perlu
        // menempatkan stetoskop lalu menekan PILIH lagi. Status lemah tetap
        // terlihat, tetapi kontrol kembali aktif setelah jeda singkat.
        setTimeout(()=>{
          D.state = "idle";
          D.lastWeakSignal = true;
          D.weakSignalIndex = D.cursor;
          render();
        }, 900);
      } else {
        // Gangguan SQI acak saat kontak sudah benar tetap mengulang otomatis.
        setTimeout(()=>{ startRecording(); }, 1500);
      }
      return;
    }

    const { murmur, prob } = weightedResult();
    D.results[D.cursor] = { murmur, prob };
    D.done[D.cursor] = true;
    D.state = "complete";
    D.probeAttached = false;
    render();
    resetProbePosition(true);
    emit("twinkhds:point-result", { index: D.cursor, name: POINT_NAMES[D.cursor], desc: POINT_DESCS[D.cursor], code: POINT_CODES[D.cursor], murmur, prob });

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
        emit("twinkhds:cursor-idle", { index: D.cursor });
      }
    }, 1100);
  }

  /* ---------- diagram markers (sinkron dengan D.cursor/D.done) ---------- */
  function syncPointVisuals(){
    const pts = document.querySelectorAll(".diagram-stage .point");
    if(!pts.length) return;
    pts.forEach((p, i)=>{
      const done = D.done[i];
      const isActive = i === D.cursor && D.state !== "allDone";
      p.classList.toggle("done", !!done);
      p.classList.toggle("selected", isActive && (D.state === "idle" || D.state === "recording" || D.state === "badsignal") && !done);
    });
  }

  /* ---------- drag-and-drop stetoskop (probe) ---------- */
  let dragging = false, dragOffX = 0, dragOffY = 0;

  function scaleFactor(){ return window.__twinkhdsScale || 1; }

  function stageEl(){ return $(".device-diagram-row"); }
  function probeEl(){ return $("#deviceProbe"); }
  function portEl(){ return $("#devicePort"); }
  function pointElsList(){ return Array.from(document.querySelectorAll(".diagram-stage .point")); }

  function updateCable(){
    const stage = stageEl(), probe = probeEl(), port = portEl();
    const path = $("#cablePath");
    if(!stage || !probe || !port || !path) return;
    const s = scaleFactor();
    const stageR = stage.getBoundingClientRect();
    const portR = port.getBoundingClientRect();
    const probeR = probe.getBoundingClientRect();
    const x0 = (portR.left - stageR.left)/s + portR.width/s/2;
    const y0 = (portR.top - stageR.top)/s + portR.height/s/2;
    const x1 = (probeR.left - stageR.left)/s + probeR.width/s/2;
    const y1 = (probeR.top - stageR.top)/s + probeR.height/s*0.28;
    const dist = Math.hypot(x1-x0, y1-y0);
    const sag = Math.min(70, dist*0.22);
    const mx = (x0+x1)/2, my = (y0+y1)/2 + sag;
    path.setAttribute("d", `M ${x0} ${y0} Q ${mx} ${my} ${x1} ${y1}`);
  }

  let cableAnimStopAt = 0;
  function animateCableFor(ms){
    const stopAt = performance.now() + ms;
    cableAnimStopAt = stopAt;
    function step(){
      updateCable();
      if(performance.now() < cableAnimStopAt) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function resetProbePosition(animate){
    const stage = stageEl(), probe = probeEl(), port = portEl();
    if(!stage || !probe || !port) return;
    probe.classList.toggle("snap-transition", !!animate);
    const s = scaleFactor();
    const stageR = stage.getBoundingClientRect();
    const portR = port.getBoundingClientRect();
    const x = (portR.left - stageR.left)/s - 4;
    const y = (portR.top - stageR.top)/s - 25;
    probe.style.left = x + "px";
    probe.style.top = y + "px";
    if(animate){
      animateCableFor(400);
      setTimeout(()=>probe.classList.remove("snap-transition"), 400);
    } else {
      requestAnimationFrame(updateCable);
    }
  }

  function findNearestPoint(clientX, clientY){
    let best = null, bestDist = 9999;
    pointElsList().forEach(p=>{
      if(p.classList.contains("done")) return;
      const r = p.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      const d = Math.hypot(clientX-cx, clientY-cy);
      if(d < 46 && d < bestDist){ bestDist = d; best = p; }
    });
    return best;
  }
  function clearDragoverHighlights(){
    pointElsList().forEach(p=>p.classList.remove("dragover"));
  }

  function dropOnPoint(idx){
    if(!D.phoneReady || D.state !== "idle") return;
    D.cursor = idx;
    D.probeAttached = true;
    D.lastWeakSignal = false;
    D.weakSignalIndex = null;
    render();
  }

  function bindProbeDrag(){
    const probe = probeEl();
    if(!probe) return;
    probe.addEventListener("pointerdown", (e)=>{
      if(!D.phoneReady || D.state !== "idle"){ flashDenied(); return; }
      dragging = true;
      D.probeAttached = false;
      render();
      probe.classList.remove("snap-transition");
      probe.setPointerCapture(e.pointerId);
      const s = scaleFactor();
      const r = probe.getBoundingClientRect();
      dragOffX = (e.clientX - r.left)/s; dragOffY = (e.clientY - r.top)/s;
    });
    probe.addEventListener("pointermove", (e)=>{
      if(!dragging) return;
      const s = scaleFactor();
      const stageR = stageEl().getBoundingClientRect();
      probe.style.left = ((e.clientX - stageR.left)/s - dragOffX) + "px";
      probe.style.top = ((e.clientY - stageR.top)/s - dragOffY) + "px";
      updateCable();
      clearDragoverHighlights();
      const p = findNearestPoint(e.clientX, e.clientY);
      if(p) p.classList.add("dragover");
    });
    probe.addEventListener("pointerup", (e)=>{
      if(!dragging) return;
      dragging = false;
      const target = findNearestPoint(e.clientX, e.clientY);
      clearDragoverHighlights();
      if(target){
        dropOnPoint(parseInt(target.dataset.idx, 10));
      } else {
        resetProbePosition(true);
      }
    });
  }

  window.addEventListener("resize", ()=>{ if(D.phoneReady) requestAnimationFrame(updateCable); });

  /* ---------- public snapshot for app.js ---------- */
  window.TwinkhdsDevice = {
    getSnapshot(){
      return {
        state: D.state,
        cursor: D.cursor,
        done: D.done.slice(),
        results: D.results.slice(),
        pointNames: POINT_NAMES.slice(),
        pointDescs: POINT_DESCS.slice(),
        pointCodes: POINT_CODES.slice(),
        lastWeakSignal: D.lastWeakSignal,
        weakSignalIndex: D.weakSignalIndex,
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
    bindProbeDrag();
    render();
    resetProbePosition(false);
  });

  window.addEventListener("load", ()=>{ resetProbePosition(false); });

  document.addEventListener("twinkhds:scale-changed", ()=>{
    if(!dragging) requestAnimationFrame(()=>resetProbePosition(false));
  });

  document.addEventListener("twinkhds:phone-nav", (e)=>{
    const ready = e.detail.screen === "proses-auskultasi";
    if(ready !== D.phoneReady){
      D.phoneReady = ready;
      render();
    }
    const probe = probeEl();
    if(probe) probe.classList.toggle("disabled", !ready);
    if(ready) requestAnimationFrame(()=>resetProbePosition(false));
  });
})();
