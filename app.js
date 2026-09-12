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
    theme: storage.get("kl26-theme-v2",null)
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
    el.locationFilters.innerHTML = usedLocs.map(id => {
      const loc=D.locations[id];
      return `<button class="chip location-chip ${state.locations.has(id)?"active":""}" data-loc="${id}" style="--loc:${loc.color};--loc2:${loc.color2||loc.color}">${locationLogo(loc,true)}<span>${esc(loc.short||loc.name)}</span></button>`;
    }).join("");
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
    const favCount = D.events.filter(e => state.favorites.has(e.id)).length;
    el.status.textContent = `${D.events.length} items · ${favCount} favoriet${favCount===1?"":"en"}`;

    // Zoeken is globaal over zondag, maandag en dinsdag.
    if (state.search) {
      renderGlobalSearch();
      return;
    }

    const events = filteredEvents();
    if (state.view==="grid") renderGrid(events);
    else if (state.view==="favorites") renderFavorites();
    else renderList(events);
  }

  function globalSearchEvents(){
    return D.events
      .filter(e => !state.locations.size || state.locations.has(e.location))
      .filter(e => !state.genres.size || [...state.genres].some(g => (e.types||[]).includes(g)))
      .filter(e => !state.liveOnly || (e.types||[]).includes("live"))
      .filter(e => {
        const loc=D.locations[e.location]?.name || "";
        return [e.title,loc,(e.types||[]).join(" "),e.note||""]
          .join(" ").toLowerCase().includes(state.search);
      })
      .sort((a,b)=>eventStart(a)-eventStart(b) || a.title.localeCompare(b.title,"nl"));
  }

  function renderGlobalSearch(){
    const events = globalSearchEvents();

    if (!events.length){
      el.content.innerHTML = `<div class="search-summary"><span>Zoeken in <strong>alle drie de dagen</strong></span><span>0 resultaten</span></div>
        <div class="empty">Geen artiest, act of locatie gevonden voor “${esc(state.search)}”.</div>${sourceNote()}`;
      return;
    }

    const byDay = groupBy(events,e=>e.day);
    el.content.innerHTML = `
      <div class="search-summary">
        <span>Zoeken in <strong>alle drie de dagen</strong></span>
        <span>${events.length} resultaat${events.length===1?"":"en"}</span>
      </div>
      ${D.days
        .filter(day=>byDay.has(day.id))
        .map(day=>{
          const items=byDay.get(day.id);
          return `<section class="search-day-group">
            <div class="search-day-heading">
              <strong>${esc(day.label)} ${esc(day.dateLabel)}</strong>
              <span>${items.length} resultaat${items.length===1?"":"en"}</span>
            </div>
            <div class="event-list">${items.map(eventCard).join("")}</div>
          </section>`;
        }).join("")}
      ${sourceNote()}`;
    bindCards();
  }

  function renderQualityNote(){
    const uncertain = D.events.filter(e=>e.day===state.day && (!e.end || e.window)).length;
    el.qualityNote.hidden = uncertain===0;
    if (!uncertain) return;
    el.qualityNote.innerHTML = `<strong>ℹ Broninfo</strong><span>${uncertain} onzekere tijd${uncertain===1?"":"en"} · ontbrekende eindtijden worden niet geschat</span>`;
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

  function locationMarkSvg(mark){
    const common=`viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" focusable="false"`;
    const icons={
      zaak:`<svg ${common}><path d="M10 22V8l12-3v13.2a4.4 4.4 0 1 1-2.4-3.9V9.2l-7.2 1.8V22a4.4 4.4 0 1 1-2.4-3.9Z" fill="currentColor"/></svg>`,
      stage:`<svg ${common}><path d="M5 24V11h22v13M7 11l4-5m14 5-4-5M8 16h16M10 20h12" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><circle cx="16" cy="9" r="2" fill="currentColor"/></svg>`,
      klaphok:`<svg ${common}><path d="M5 14 16 5l11 9v11H5Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M11 25v-8h10v8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 14h16" stroke="currentColor" stroke-width="2.2"/></svg>`,
      market:`<svg ${common}><path d="M5 12h22l-3-6H8Z" fill="currentColor"/><path d="M7 12v14m18-14v14M11 26V16h10v10" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`,
      vanoijen:`<svg ${common}><path d="M8 8h10v8a5 5 0 0 1-10 0Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M18 10h3a4 4 0 0 1 0 8h-3M13 21v5m-4 0h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
      kruupvanoijen:`<svg ${common}><path d="M13 10 9 6 4 11l5 5 4-4m6 10 4 4 5-5-5-5-4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="m11 21 10-10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
      dokleo:`<svg ${common}><path d="M16 4 26 8v7c0 7-4.7 11-10 13-5.3-2-10-6-10-13V8Z" fill="none" stroke="currentColor" stroke-width="2.1"/><path d="M16 9v11M10.5 14.5h11" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>`,
      kletskop:`<svg ${common}><path d="M5 7h22v15H14l-6 5v-5H5Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="11" cy="14.5" r="1.4" fill="currentColor"/><circle cx="16" cy="14.5" r="1.4" fill="currentColor"/><circle cx="21" cy="14.5" r="1.4" fill="currentColor"/></svg>`,
      triangle:`<svg ${common}><path d="M16 5 28 26H4Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="16" cy="19" r="2" fill="currentColor"/></svg>`,
      horseshoe:`<svg ${common}><path d="M9 7c-3 3-4 7-3 11 1 5 5 8 10 8s9-3 10-8c1-4 0-8-3-11l-4 4c1 2 2 4 1 6 0 3-2 5-4 5s-4-2-4-5c-1-2 0-4 1-6Z" fill="currentColor"/><circle cx="9" cy="10" r="1.3" fill="var(--surface)"/><circle cx="23" cy="10" r="1.3" fill="var(--surface)"/></svg>`,
      spark:`<svg ${common}><path d="m16 3 2.3 8.1L26 8l-5 6 8 2-8 2 5 6-7.7-3.1L16 29l-2.3-8.1L6 24l5-6-8-2 8-2-5-6 7.7 3.1Z" fill="currentColor"/></svg>`,
      coucou:`<svg ${common}><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M10 17c2 3 10 3 12 0M11 12h.01M21 12h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`
    };
    return icons[mark] || `<svg ${common}><circle cx="16" cy="16" r="10" fill="currentColor"/></svg>`;
  }

  function locationLogo(loc, compact=false){
    const mark=loc.mark || "";
    return `<span class="location-logo${compact?" compact":""}" style="--loc:${loc.color};--loc2:${loc.color2||loc.color}" aria-hidden="true">${locationMarkSvg(mark)}</span>`;
  }

  function eventArtistInfos(e){
    const names=[...(e.artistNames||[]),e.title,...e.title.split(" · ")];
    const seen=new Set(), infos=[];
    for(const name of names){
      const info=D.artists[name];
      if(info && !seen.has(name)){ seen.add(name); infos.push({name,info}); }
    }
    return infos;
  }

  function eventBadges(e){
    const badges=[];
    for(const {name,info} of eventArtistInfos(e)){
      for(const kind of (info.badges||[])){
        if(!badges.some(b=>b.kind===kind)) badges.push({kind,name,info});
      }
    }
    return badges;
  }

  function badgeHtml(e, compact=false){
    const defs={
      trending:{label:"🔥 Trending",mini:"🔥"},
      hitmaker:{label:"⭐ Hitmaker",mini:"⭐"},
      known:{label:"🌍 Bekend",mini:"🌍"}
    };
    return eventBadges(e).map(b=>{
      const d=defs[b.kind]||{label:b.kind,mini:"•"};
      return compact ? `<span class="grid-mini-badge" title="${esc(d.label)}">${d.mini}</span>` : `<span class="artist-badge ${esc(b.kind)}">${esc(d.label)}</span>`;
    }).join("");
  }

  function eventCard(e, conflict=false){
    const loc = D.locations[e.location];
    const status = temporalStatus(e);
    return `<article class="event-card ${status} ${e.window?"window":""} ${state.favorites.has(e.id)?"favorite":""}" style="--loc:${loc.color};--loc2:${loc.color2||loc.color}">
      <button class="event-open" type="button" data-event="${e.id}" aria-label="Open details voor ${esc(e.title)}">
        <div class="location-brand">${locationLogo(loc)}<span class="location-name">${esc(loc.short||loc.name)}</span></div>
        <div class="event-topline">
          <span class="event-time">${formatRange(e)}</span>
          ${status==="live" ? `<span class="live-pill">NU</span>` : ""}
          ${e.window ? `<span class="window-pill">TIJDVAK</span>` : ""}
          ${conflict ? `<span class="conflict-pill">⚠ overlap</span>` : ""}
        </div>
        <h3 class="event-title">${esc(e.title)}</h3>
        ${badgeHtml(e)?`<div class="artist-badges-row">${badgeHtml(e)}</div>`:""}
        <div class="tags">
          ${(e.types||[]).slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}
          ${!e.end ? `<span class="tag info">eindtijd onbekend</span>`:""}
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
    const badgeProofs=eventBadges(e).map(b=>{
      const labels={trending:"🔥 Trending",hitmaker:"⭐ Hitmaker",known:"🌍 Bekend"};
      return `<div class="badge-proof"><strong>${labels[b.kind]||b.kind} · ${esc(b.name)}</strong><br>${esc(b.info.badgeNote||"")}${b.info.badgeSource?` · <a href="${b.info.badgeSource}" target="_blank" rel="noopener">bron</a>`:""}</div>`;
    }).join("");

    el.eventDetails.innerHTML = `
      <div class="detail-head">
        <p class="eyebrow">${esc(dayLabel(e.day))} · ${formatRange(e)}</p>
        <div class="detail-location" style="--loc:${loc.color};--loc2:${loc.color2||loc.color}">${locationLogo(loc)}<strong>${esc(loc.name)}</strong></div>
        <h2>${esc(e.title)}</h2>
        <div class="detail-meta">
          ${badgeHtml(e)}
          ${(e.types||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}
          ${e.window?`<span class="tag info">programma-venster</span>`:""}
        </div>
      </div>

      ${artistInfo ? `<section class="detail-section">
        <h3>Wat kun je verwachten?</h3>
        <p>${esc(artistInfo.bio)}</p>
        ${artistInfo.songs?.length ? `<p style="margin-top:8px"><strong>Bekend van:</strong> ${artistInfo.songs.map(esc).join(" · ")}</p>`:""}
        ${artistInfo.rating ? `<p style="margin-top:8px"><strong>Onze indicatie:</strong> <span class="rating">${"★".repeat(artistInfo.rating)}${"☆".repeat(4-artistInfo.rating)}</span></p>`:""}
        ${badgeProofs}
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
    const gridStart=dateFor(state.day,"11:00");
    const visibleEvents=events.filter(e=>eventDisplayEnd(e)>gridStart);
    if (!visibleEvents.length){ el.content.innerHTML=emptyMessage(); return; }

    const locIds=[...new Set(visibleEvents.map(e=>e.location))];
    const layout = assignLanes(visibleEvents, locIds);
    const min = gridStart;
    const displayEnds=visibleEvents.map(e=>eventDisplayEnd(e));
    const max = ceil5(new Date(Math.max(...displayEnds.map(Number))));
    const rows=Math.max(1,Math.round((max-min)/300000));
    const totalLanes=locIds.reduce((sum,id)=>sum+layout.laneCounts[id],0);

    let html=`<div class="grid-intro"><span>Timetable start elke dag om <strong>11:00</strong></span><span>← swipe →</span></div><div class="grid-shell"><div class="grid-timetable" style="--cols:${totalLanes};--rows:${rows}">`;
    html += `<div class="grid-corner" style="grid-column:1;grid-row:1">11:00+</div>`;

    let colCursor=2;
    const colStarts={};
    locIds.forEach(id=>{
      const loc=D.locations[id];
      colStarts[id]=colCursor;
      const span=layout.laneCounts[id];
      html += `<div class="grid-location" style="--loc:${loc.color};--loc2:${loc.color2||loc.color};grid-column:${colCursor}/span ${span};grid-row:1;border-top:4px solid ${loc.color}">${locationLogo(loc,true)}<strong>${esc(loc.gridShort||loc.short||loc.name)}</strong></div>`;
      colCursor += span;
    });

    for(let r=0;r<rows;r++){
      const dt=new Date(min.getTime()+r*300000);
      const label = dt.getMinutes()%30===0 ? timeLabel(dt) : "";
      html += `<div class="grid-time" style="grid-column:1;grid-row:${r+2}">${label}</div>`;
      for(let c=0;c<totalLanes;c++) html += `<div class="grid-line" style="grid-column:${c+2};grid-row:${r+2}"></div>`;
    }

    visibleEvents.forEach(e=>{
      const lane=layout.lanes[e.id]||0;
      const col=colStarts[e.location]+lane;
      const realStart=eventStart(e), s=realStart<min?min:realStart, en=eventDisplayEnd(e);
      const startRow=Math.max(0,Math.floor((s-min)/300000))+2;
      const span=Math.max(2,Math.ceil((en-s)/300000));
      const loc=D.locations[e.location];
      html += `<button class="grid-event ${state.favorites.has(e.id)?"favorite":""} ${!e.end?"unknown-end":""} ${e.window?"window":""}" type="button" data-event="${e.id}" style="--loc:${loc.color};--loc2:${loc.color2||loc.color};grid-column:${col};grid-row:${startRow}/span ${span}">
        <strong>${esc(e.title)}</strong><span>${formatRange(e)}</span>${badgeHtml(e,true)?`<span class="grid-badges">${badgeHtml(e,true)}</span>`:""}
      </button>`;
    });

    html += `</div></div>${sourceNote()}`;
    el.content.innerHTML=html;
    $$('[data-event]',el.content).forEach(x=>x.addEventListener('click',()=>openEvent(x.dataset.event)));
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
        ${(nowEvents.length?nowEvents:upcoming).map(e=>{const l=D.locations[e.location];return `<button class="now-card" type="button" data-event="${e.id}">
          <div class="location-brand" style="--loc:${l.color};--loc2:${l.color2||l.color}">${locationLogo(l,true)}<span class="location-name">${esc(l.short||l.name)}</span></div>
          <strong>${esc(e.title)}</strong><div class="muted">${formatRange(e)}</div>
        </button>`}).join("")}
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
      return `<div class="location-card" style="--loc:${l.color};--loc2:${l.color2||l.color}">
        ${locationLogo(l)}
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
    const theme=state.theme || "dark";
    document.documentElement.dataset.theme=theme;
    el.theme.textContent=theme==="dark"?"☀":"☾";
    document.querySelector('meta[name="theme-color"]').setAttribute("content",theme==="dark"?"#06070d":"#f4f3fb");
  }
  function toggleTheme(){
    state.theme=document.documentElement.dataset.theme==="dark"?"light":"dark";
    storage.set("kl26-theme-v2",state.theme); applyTheme();
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
