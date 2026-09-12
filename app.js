(() => {
  "use strict";

  const D = window.KERMIS_DATA;
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const storage = {
    get(key, fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  };

  const state = {
    day: pickInitialDay(),
    view: storage.get("kl26-view","list"),
    search:"",
    locations:new Set(),
    genres:new Set(),
    liveOnly:false,
    favorites:new Set(storage.get("kl26-favorites",[])),
    theme: storage.get("kl26-theme",null)
  };

  const el = {
    dayTabs:$("#dayTabs"), search:$("#searchInput"), filtersButton:$("#filtersButton"),
    filtersPanel:$("#filtersPanel"), locationFilters:$("#locationFilters"), genreFilters:$("#genreFilters"),
    liveOnly:$("#liveOnly"), resetFilters:$("#resetFilters"), content:$("#content"), nowPanel:$("#nowPanel"),
    status:$("#statusLine"), theme:$("#themeToggle"), jumpNow:$("#jumpNow"), eventDialog:$("#eventDialog"),
    eventDetails:$("#eventDetails"), locationsDialog:$("#locationsDialog"), locationsNav:$("#locationsNav"),
    locationsList:$("#locationsList"), installHint:$("#installHint"), dismissInstallHint:$("#dismissInstallHint"),
    qualityNote:$("#qualityNote")
  };

  init();

  function init(){
    applyTheme();
    renderDayTabs();
    renderFilterControls();
    bindEvents();
    renderLocations();
    setView(state.view);
    renderNowPanel();
    renderQualityNote();
    maybeShowInstallHint();
    registerServiceWorker();
    setInterval(() => {
      renderNowPanel();
      if (isFestivalWindow()) render();
    }, 60000);
  }

  function effectiveFestivalDay(date=new Date()){
    const local = new Date(date.toLocaleString("en-US",{timeZone:"Europe/Amsterdam"}));
    if (local.getHours() < (D.meta.dayBoundaryHour || 5)) local.setDate(local.getDate()-1);
    return `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,"0")}-${String(local.getDate()).padStart(2,"0")}`;
  }

  function pickInitialDay(){
    const day = effectiveFestivalDay(new Date());
    if (D.days.some(d => d.id===day)) return day;
    const now = new Date();
    const first = new Date(D.days[0].id+"T05:00:00+02:00");
    const last = new Date("2026-09-16T05:00:00+02:00");
    if (now < first) return D.days[0].id;
    if (now >= last) return D.days.at(-1).id;
    return D.days[0].id;
  }

  function bindEvents(){
    el.search.addEventListener("input", e => { state.search=e.target.value.trim().toLowerCase(); render(); });
    el.filtersButton.addEventListener("click", () => {
      el.filtersPanel.hidden = !el.filtersPanel.hidden;
      el.filtersButton.setAttribute("aria-expanded", String(!el.filtersPanel.hidden));
    });
    el.liveOnly.addEventListener("change", e => { state.liveOnly=e.target.checked; render(); });
    el.resetFilters.addEventListener("click", () => {
      state.locations.clear(); state.genres.clear(); state.liveOnly=false; el.liveOnly.checked=false;
      renderFilterControls(); render();
    });
    el.theme.addEventListener("click", toggleTheme);
    el.jumpNow.addEventListener("click", jumpToNow);
    el.locationsNav.addEventListener("click", () => el.locationsDialog.showModal());
    el.dismissInstallHint?.addEventListener("click", () => {
      el.installHint.hidden=true; storage.set("kl26-installhint",true);
    });
    $$(".segmented button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    $$(".bottom-nav [data-nav]").forEach(b => b.addEventListener("click", () => setView(b.dataset.nav)));
  }

  function renderDayTabs(){
    el.dayTabs.innerHTML = D.days.map(day => `
      <button class="day-tab ${day.id===state.day?"active":""}" data-day="${day.id}" role="tab" aria-selected="${day.id===state.day}">
        <strong>${day.label}</strong><span>${day.dateLabel}</span>
      </button>`).join("");
    $$(".day-tab",el.dayTabs).forEach(b => b.addEventListener("click", () => {
      state.day=b.dataset.day; renderDayTabs(); render(); renderNowPanel(); renderQualityNote();
    }));
  }

  function renderFilterControls(){
    const usedLocs = [...new Set(D.events.map(e => e.location))];
    el.locationFilters.innerHTML = usedLocs.map(id => `<button class="chip ${state.locations.has(id)?"active":""}" data-loc="${id}">${esc(D.locations[id].name)}</button>`).join("");
    $$(".chip[data-loc]",el.locationFilters).forEach(b => b.addEventListener("click", () => {
      toggleSet(state.locations,b.dataset.loc); renderFilterControls(); render();
    }));

    const genres = [...new Set(D.events.flatMap(e => e.types || []))].sort((a,b)=>a.localeCompare(b,"nl"));
    el.genreFilters.innerHTML = genres.map(g => `<button class="chip ${state.genres.has(g)?"active":""}" data-genre="${esc(g)}">${esc(g)}</button>`).join("");
    $$(".chip[data-genre]",el.genreFilters).forEach(b => b.addEventListener("click", () => {
      toggleSet(state.genres,b.dataset.genre); renderFilterControls(); render();
    }));
  }

  function toggleSet(set, value){ set.has(value) ? set.delete(value) : set.add(value); }

  function setView(view){
    state.view=view; storage.set("kl26-view",view);
    $$(".segmented button").forEach(b => b.classList.toggle("active",b.dataset.view===view));
    $$(".bottom-nav [data-nav]").forEach(b => b.classList.toggle("active",b.dataset.nav===view || (view==="grid" && b.dataset.nav==="list")));
    render();
  }

  function filteredEvents(){
    return D.events
      .filter(e => e.day===state.day)
      .filter(e => !state.locations.size || state.locations.has(e.location))
      .filter(e => !state.genres.size || [...state.genres].some(g => (e.types||[]).includes(g)))
      .filter(e => !state.liveOnly || (e.types||[]).includes("live"))
      .filter(e => {
        if (!state.search) return true;
        const loc=D.locations[e.location]?.name || "";
        return [e.title,loc,(e.types||[]).join(" "),e.note||""].join(" ").toLowerCase().includes(state.search);
      })
      .sort((a,b)=>eventStart(a)-eventStart(b) || a.title.localeCompare(b.title,"nl"));
  }

  function render(){
    const events = filteredEvents();
    const favCount = D.events.filter(e => state.favorites.has(e.id)).length;
    el.status.textContent = `${D.events.length} items · ${favCount} favoriet${favCount===1?"":"en"}`;
    if (state.view==="grid") renderGrid(events);
    else if (state.view==="favorites") renderFavorites();
    else renderList(events);
  }

  function renderQualityNote(){
    const uncertain = D.events.filter(e=>e.day===state.day && (!e.end || e.window)).length;
    el.qualityNote.hidden = uncertain===0;
    if (!uncertain) return;
    el.qualityNote.innerHTML = `<strong>ℹ Broninfo:</strong> ${uncertain} item${uncertain===1?"":"s"} ${uncertain===1?"heeft":"hebben"} alleen een starttijd of globaal tijdvak; de app verzint geen ontbrekende tijden.`;
  }

  function renderList(events){
    if (!events.length){ el.content.innerHTML = emptyMessage(); return; }
    const groups = groupBy(events,e=>e.start);
    el.content.innerHTML = [...groups.entries()].map(([time,items]) => `
      <section class="time-group" id="time-${time.replace(":","")}">
        <div class="time-heading">${time}</div>
        <div class="event-list">${items.map(e => eventCard(e)).join("")}</div>
      </section>`).join("") + sourceNote();
    bindCards();
  }

  function renderFavorites(){
    const favs = D.events
      .filter(e=>e.day===state.day && state.favorites.has(e.id))
      .filter(e => !state.search || `${e.title} ${D.locations[e.location].name}`.toLowerCase().includes(state.search))
      .sort((a,b)=>eventStart(a)-eventStart(b));

    if (!favs.length){
      el.content.innerHTML = `<div class="empty"><strong>Nog niets gepland voor deze dag.</strong><br><br>Tik op ♥ bij een optreden om je eigen route samen te stellen.</div>${sourceNote()}`;
      return;
    }

    const {conflicts, uncertainCount} = findConflicts(favs);
    let overlapText = conflicts.size ? `⚠ ${conflicts.size} keuze${conflicts.size===1?"":"s"} met overlap` : "✓ Geen bevestigde overlap";
    if (uncertainCount) overlapText += ` · ${uncertainCount} tijd${uncertainCount===1?"":"en"} onzeker`;

    el.content.innerHTML = `
      <div class="plan-summary">
        <span class="summary-chip">♥ ${favs.length} gekozen</span>
        <span class="summary-chip">${overlapText}</span>
      </div>
      <div class="event-list">${favs.map(e => eventCard(e, conflicts.has(e.id))).join("")}</div>${sourceNote()}`;
    bindCards();
  }

  function eventCard(e, conflict=false){
    const loc = D.locations[e.location];
    const status = temporalStatus(e);
    const rating = artistRating(e);
    return `<article class="event-card ${status} ${e.window?"window":""}" style="--loc:${loc.color}">
      <button class="event-open" type="button" data-event="${e.id}" aria-label="Open details voor ${esc(e.title)}">
        <div class="event-topline">
          <span class="event-time">${formatRange(e)}</span>
          ${status==="live" ? `<span class="live-pill">NU</span>` : ""}
          ${e.window ? `<span class="window-pill">TIJDVAK</span>` : ""}
          ${conflict ? `<span class="conflict-pill">⚠ overlap</span>` : ""}
        </div>
        <h3 class="event-title">${esc(e.title)}</h3>
        <div class="event-location">${esc(loc.name)}</div>
        <div class="tags">
          ${(e.types||[]).slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}
          ${!e.end ? `<span class="tag info">eindtijd onbekend</span>`:""}
          ${rating ? `<span class="rating">${"★".repeat(rating)}${"☆".repeat(4-rating)}</span>`:""}
        </div>
      </button>
      <button class="favorite-button ${state.favorites.has(e.id)?"active":""}" type="button" data-fav="${e.id}" aria-label="${state.favorites.has(e.id)?"Verwijder uit":"Voeg toe aan"} planning">${state.favorites.has(e.id)?"♥":"♡"}</button>
    </article>`;
  }

  function bindCards(){
    $$("[data-event]",el.content).forEach(btn => btn.addEventListener("click", () => openEvent(btn.dataset.event)));
    $$("[data-fav]",el.content).forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation(); toggleFavorite(btn.dataset.fav);
    }));
  }

  function toggleFavorite(id){
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    storage.set("kl26-favorites",[...state.favorites]); render(); renderNowPanel();
  }

  function openEvent(id){
    const e = D.events.find(x=>x.id===id); if(!e) return;
    const loc=D.locations[e.location];
    const artistInfo = bestArtistInfo(e);
    const appleMaps = `https://maps.apple.com/?q=${encodeURIComponent(loc.query)}`;
    const googleMaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.query)}`;
    const fav = state.favorites.has(e.id);
    const artistNames = getArtistNames(e);

    el.eventDetails.innerHTML = `
      <div class="detail-head">
        <p class="eyebrow">${esc(dayLabel(e.day))} · ${formatRange(e)}</p>
        <h2>${esc(e.title)}</h2>
        <div class="detail-meta">
          <span class="tag" style="border-left:5px solid ${loc.color}">${esc(loc.name)}</span>
          ${(e.types||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}
          ${e.window?`<span class="tag info">programma-venster</span>`:""}
        </div>
      </div>

      ${artistInfo ? `<section class="detail-section">
        <h3>Wat kun je verwachten?</h3>
        <p>${esc(artistInfo.bio)}</p>
        ${artistInfo.songs?.length ? `<p style="margin-top:8px"><strong>Bekend van:</strong> ${artistInfo.songs.map(esc).join(" · ")}</p>`:""}
        ${artistInfo.rating ? `<p style="margin-top:8px"><strong>Onze indicatie:</strong> <span class="rating">${"★".repeat(artistInfo.rating)}${"☆".repeat(4-artistInfo.rating)}</span></p>`:""}
      </section>`:""}

      <section class="detail-section">
        <h3>Tijdinformatie</h3>
        <p>${e.window ? "Dit is een gepubliceerd tijdvak met meerdere sets/acts. De app behandelt het bewust niet als één ononderbroken optreden." : (!e.end ? "Alleen de starttijd is gepubliceerd; een eindtijd wordt niet geschat." : "Start- en eindtijd zijn in de gebruikte bron beschikbaar.")}</p>
      </section>

      ${e.note ? `<section class="detail-section"><h3>Programmanotitie</h3><p>${esc(e.note)}</p></section>`:""}

      ${artistNames.length ? `<section class="detail-section">
        <h3>Luisteren / bekijken</h3>
        <div class="artist-links">${artistNames.map(name => `
          <div class="artist-link-row">
            <strong>${esc(name)}</strong>
            <a class="action-link small" href="https://open.spotify.com/search/${encodeURIComponent(name)}" target="_blank" rel="noopener">Spotify</a>
            <a class="action-link small" href="https://www.youtube.com/results?search_query=${encodeURIComponent(name+" live")}" target="_blank" rel="noopener">YouTube</a>
          </div>`).join("")}
        </div>
      </section>`:""}

      <div class="detail-actions">
        <button class="primary-button" id="dialogFav" type="button">${fav?"♥ Verwijder favoriet":"♡ Zet in planning"}</button>
        <a class="action-link" href="${appleMaps}" target="_blank" rel="noopener"> Maps</a>
        <a class="action-link" href="${googleMaps}" target="_blank" rel="noopener">Google Maps</a>
        <a class="action-link" href="${D.meta.officialUrl}" target="_blank" rel="noopener">Officiële site</a>
      </div>`;
    el.eventDialog.showModal();
    $("#dialogFav",el.eventDetails).addEventListener("click",()=>{toggleFavorite(e.id);el.eventDialog.close();});
  }

  function renderGrid(events){
    if (!events.length){ el.content.innerHTML=emptyMessage(); return; }

    const locIds=[...new Set(events.map(e=>e.location))];
    const layout = assignLanes(events, locIds);

    const starts=events.map(eventStart);
    const displayEnds=events.map(e=>eventDisplayEnd(e));
    const min = floor5(new Date(Math.min(...starts.map(Number))));
    const max = ceil5(new Date(Math.max(...displayEnds.map(Number))));
    const rows=Math.max(1,Math.round((max-min)/300000));
    const totalLanes=locIds.reduce((sum,id)=>sum+layout.laneCounts[id],0);

    let html=`<div class="grid-shell"><div class="grid-timetable" style="--cols:${totalLanes};--rows:${rows}">`;
    html += `<div class="grid-corner" style="grid-column:1;grid-row:1">Tijd</div>`;

    let colCursor=2;
    const colStarts={};
    locIds.forEach(id=>{
      colStarts[id]=colCursor;
      const span=layout.laneCounts[id];
      html += `<div class="grid-location" style="grid-column:${colCursor}/span ${span};grid-row:1;border-top:4px solid ${D.locations[id].color}">${esc(shortLoc(D.locations[id].name))}</div>`;
      colCursor += span;
    });

    for(let r=0;r<rows;r++){
      const dt=new Date(min.getTime()+r*300000);
      const label = dt.getMinutes()%30===0 ? timeLabel(dt) : "";
      html += `<div class="grid-time" style="grid-column:1;grid-row:${r+2}">${label}</div>`;
      for(let c=0;c<totalLanes;c++) html += `<div class="grid-line" style="grid-column:${c+2};grid-row:${r+2}"></div>`;
    }

    events.forEach(e=>{
      const lane=layout.lanes[e.id]||0;
      const col=colStarts[e.location]+lane;
      const s=eventStart(e), en=eventDisplayEnd(e);
      const startRow=Math.max(0,Math.floor((s-min)/300000))+2;
      const span=Math.max(2,Math.ceil((en-s)/300000));
      const loc=D.locations[e.location];
      html += `<button class="grid-event ${state.favorites.has(e.id)?"favorite":""} ${!e.end?"unknown-end":""} ${e.window?"window":""}" type="button" data-event="${e.id}" style="--loc:${loc.color};grid-column:${col};grid-row:${startRow}/span ${span}">
        <strong>${esc(e.title)}</strong><span>${formatRange(e)}</span>
      </button>`;
    });

    html += `</div></div>${sourceNote()}`;
    el.content.innerHTML=html;
    $$("[data-event]",el.content).forEach(x=>x.addEventListener("click",()=>openEvent(x.dataset.event)));
  }

  function assignLanes(events, locIds){
    const lanes={}, laneCounts={};
    for(const loc of locIds){
      const list=events.filter(e=>e.location===loc).sort((a,b)=>eventStart(a)-eventStart(b));
      const laneEnds=[];
      for(const e of list){
        const s=eventStart(e), en=eventDisplayEnd(e);
        let lane=laneEnds.findIndex(end=>end<=s);
        if(lane<0){ lane=laneEnds.length; laneEnds.push(en); } else laneEnds[lane]=en;
        lanes[e.id]=lane;
      }
      laneCounts[loc]=Math.max(1,laneEnds.length);
    }
    return {lanes,laneCounts};
  }

  function renderNowPanel(){
    const now=new Date();
    const day=effectiveFestivalDay(now);
    if (!D.days.some(d=>d.id===day)){ el.nowPanel.hidden=true; return; }

    const nowEvents=D.events
      .filter(e=>e.day===day && !e.window && e.end && temporalStatus(e)==="live")
      .sort((a,b)=>eventStart(a)-eventStart(b));

    const upcoming=D.events
      .filter(e=>e.day===day && !e.window && eventStart(e)>now && eventStart(e)-now<=60*60000)
      .sort((a,b)=>eventStart(a)-eventStart(b));

    if (!nowEvents.length && !upcoming.length){ el.nowPanel.hidden=true; return; }
    el.nowPanel.hidden=false;
    el.nowPanel.innerHTML=`
      <div class="now-title"><strong>${nowEvents.length?"Nu bezig":"Binnen een uur"}</strong><span class="muted">${timeLabel(now)}</span></div>
      <div class="now-events">
        ${(nowEvents.length?nowEvents:upcoming).map(e=>`<button class="now-card" type="button" data-event="${e.id}">
          <strong>${esc(e.title)}</strong><div class="muted">${formatRange(e)} · ${esc(D.locations[e.location].name)}</div>
        </button>`).join("")}
      </div>`;
    $$(".now-card",el.nowPanel).forEach(c=>c.addEventListener("click",()=>openEvent(c.dataset.event)));
  }

  function jumpToNow(){
    const day=effectiveFestivalDay(new Date());
    if (D.days.some(d=>d.id===day)){
      state.day=day; renderDayTabs(); setView("list"); renderQualityNote();
      const now=new Date();
      const current = D.events.filter(e=>e.day===day && eventStart(e)<=now).sort((a,b)=>eventStart(b)-eventStart(a))[0];
      if(current) document.getElementById(`time-${current.start.replace(":","")}`)?.scrollIntoView({behavior:"smooth",block:"start"});
    } else {
      alert("De kermis is van 13 t/m 15 september 2026.");
      state.day=pickInitialDay(); renderDayTabs(); render(); renderQualityNote();
    }
  }

  function renderLocations(){
    el.locationsList.innerHTML = Object.entries(D.locations).map(([id,l]) => {
      const google=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.query)}`;
      const apple=`https://maps.apple.com/?q=${encodeURIComponent(l.query)}`;
      const count=D.events.filter(e=>e.location===id).length;
      return `<div class="location-card" style="--loc:${l.color}">
        <span class="location-dot"></span>
        <div><strong>${esc(l.name)}</strong><small>${count} programma-item${count===1?"":"s"}</small></div>
        <div class="location-actions"><a href="${apple}" target="_blank" rel="noopener"> Maps</a><a href="${google}" target="_blank" rel="noopener">Google Maps</a></div>
      </div>`;
    }).join("");
  }

  function findConflicts(events){
    const conflicts=new Set();
    let uncertainCount=0;
    const known=events.filter(e=>{
      const certain=!!e.end && !e.window;
      if(!certain) uncertainCount++;
      return certain;
    });

    for(let i=0;i<known.length;i++){
      for(let j=i+1;j<known.length;j++){
        const a=known[i], b=known[j], ae=eventEnd(a), be=eventEnd(b);
        if (eventStart(a)<be && eventStart(b)<ae){ conflicts.add(a.id); conflicts.add(b.id); }
      }
    }
    return {conflicts,uncertainCount};
  }

  function eventStart(e){ return dateFor(e.day,e.start); }
  function eventEnd(e){
    if(!e.end) return null;
    const d=dateFor(e.day,e.end);
    if (d<=eventStart(e)) d.setDate(d.getDate()+1);
    return d;
  }
  function eventDisplayEnd(e){
    const real=eventEnd(e);
    if(real) return real;
    return new Date(eventStart(e).getTime()+30*60000); // alleen visuele marker in de grid
  }
  function dateFor(day,time){ return new Date(`${day}T${time}:00+02:00`); }

  function temporalStatus(e){
    const now=new Date(), s=eventStart(e), en=eventEnd(e);
    if(e.window) return "";
    if(en && now>=s && now<en) return "live";
    if(en && now>=en) return "past";
    if(!en && now>=s && effectiveFestivalDay(now) > e.day) return "past";
    return "";
  }

  function formatRange(e){
    if(e.window && e.end) return `${e.start}–${e.end} · tijdvak`;
    return e.end ? `${e.start}–${e.end}` : `vanaf ${e.start}`;
  }

  function dayLabel(id){ return D.days.find(d=>d.id===id)?.label || id; }
  function groupBy(arr,fn){ const m=new Map(); arr.forEach(x=>{const k=fn(x); if(!m.has(k))m.set(k,[]);m.get(k).push(x)}); return m; }
  function shortLoc(name){ return name.replace("De Zaak op Straat · ","").replace("Kermis op de ","").replace("Tapperij ","").replace("Café ",""); }
  function timeLabel(date){ return new Intl.DateTimeFormat("nl-NL",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Amsterdam"}).format(date); }
  function floor5(d){ const x=new Date(d); x.setMinutes(Math.floor(x.getMinutes()/5)*5,0,0); return x; }
  function ceil5(d){ const x=floor5(d); if(x<d)x.setMinutes(x.getMinutes()+5); return x; }
  function isFestivalWindow(){ const n=new Date(); return n>=new Date("2026-09-13T05:00:00+02:00") && n<new Date("2026-09-16T05:00:00+02:00"); }

  function getArtistNames(e){
    if(e.artistNames?.length) return [...new Set(e.artistNames)];
    if(e.window) return [];
    if((e.types||[]).includes("familie") || (e.types||[]).includes("informatie")) return [];
    return [e.title];
  }

  function artistRating(e){
    const info=bestArtistInfo(e);
    return info?.rating || 0;
  }
  function bestArtistInfo(e){
    const candidates=[...(e.artistNames||[]),e.title,...e.title.split(" · ")];
    for(const c of candidates){ if(D.artists[c]) return D.artists[c]; }
    return null;
  }

  function emptyMessage(){ return `<div class="empty">Geen programma-items gevonden met deze filters.</div>${sourceNote()}`; }
  function sourceNote(){ return `<p class="source-note">Bron: ${esc(D.meta.source)}.<br>${esc(D.meta.dataNote)} · versie ${esc(D.meta.version)}</p>`; }
  function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }

  function applyTheme(){
    const theme=state.theme || (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
    document.documentElement.dataset.theme=theme;
    el.theme.textContent=theme==="dark"?"☀":"☾";
    document.querySelector('meta[name="theme-color"]').setAttribute("content",theme==="dark"?"#0f1014":"#f7f7fb");
  }
  function toggleTheme(){
    state.theme=document.documentElement.dataset.theme==="dark"?"light":"dark";
    storage.set("kl26-theme",state.theme); applyTheme();
  }

  function maybeShowInstallHint(){
    const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone=window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if(isIOS && !standalone && !storage.get("kl26-installhint",false)) el.installHint.hidden=false;
  }

  function registerServiceWorker(){
    if("serviceWorker" in navigator){
      window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
    }
  }
})();
