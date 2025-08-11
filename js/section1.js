/* SECTION 1: 채널 추가/목록 */
async function addChannelById(channelId){
  if(!channelId){ toast('올바른 채널 ID가 아닙니다.'); return false; }
  const exist=await idbGet('my_channels',channelId); if(exist){ toast('이미 등록된 채널입니다.'); return false; }
  const ch=await yt('channels',{part:'snippet,statistics,contentDetails',id:channelId});
  const it=ch.items?.[0]; if(!it) throw new Error('채널을 찾을 수 없습니다.');
  const uploads=it.contentDetails?.relatedPlaylists?.uploads||''; let latest=it.snippet.publishedAt; const country=it.snippet.country||'-';
  if(uploads){ try{ const pl=await yt('playlistItems',{part:'snippet',playlistId:uploads,maxResults:1}); if(pl.items && pl.items[0]) latest=pl.items[0].snippet.publishedAt||latest; }catch{} }
  const data={ id:it.id,title:it.snippet.title,thumbnail:it.snippet.thumbnails?.default?.url||'',subscriberCount:it.statistics.subscriberCount||'0',videoCount:it.statistics.videoCount||'0',uploadsPlaylistId:uploads,latestUploadDate:latest,country };
  await idbPut('my_channels',data); toast(`✅ ${data.title} 채널이 등록되었습니다.`); setTimeout(()=>refreshAll('channels'),50); return true;
}

async function refreshChannels(){
  const list=await getAllChannels();
  for(const ch of list){ await ensureUploadsAndLatest(ch); await updateDailySubSnapshot(ch); }
  sortChannels(list,qs('sort-channels').value);
  qs('channel-count').textContent=list.length;
  const wrap=qs('channel-list');
  if(!list.length){ wrap.innerHTML='<p class="muted">채널을 추가하세요.</p>'; return; }
  wrap.innerHTML='';
  for(const ch of list){
    const y=await getYesterdaySubCount(ch);
    const today=parseInt(ch.subscriberCount||'0',10);
    const diff=y==null? null : today-y;
    const diffStr=y==null? '<span class="v" style="color:#888">(전일 정보 없음)</span>'
      : diff>0? `<span class="v" style="color:#1db954">+${fmt(diff)}</span>`
      : diff<0? `<span class="v" style="color:#c4302b">${fmt(diff)}</span>`
      : `<span class="v" style="color:#888">0</span>`;
    const el=document.createElement('div');
    el.className='channel-card';
    el.innerHTML=`
      <a class="channel-thumb-link" href="https://www.youtube.com/channel/${ch.id}" target="_blank" rel="noopener">
        <img class="channel-thumb" src="${ch.thumbnail||''}" alt="${ch.title}">
      </a>
      <div class="channel-meta">
        <h3><a class="channel-title-link" href="https://www.youtube.com/channel/${ch.id}" target="_blank" rel="noopener">${ch.title}</a></h3>
        <div class="row">
          <span>구독자: <strong>${fmt(today)}</strong></span>
          <span>영상: <strong>${fmt(ch.videoCount)}</strong></span>
          <span>운영기간: <strong>${ch.firstUploadDate? moment().diff(moment(ch.firstUploadDate),'years')+'년 '+(moment().diff(moment(ch.firstUploadDate),'months')%12)+'개월':'-'}</strong></span>
        </div>
        <div class="latest">최신 업로드: ${ch.latestUploadDate? moment(ch.latestUploadDate).format('YYYY-MM-DD'):'-'} · 최초 업로드: ${ch.firstUploadDate? moment(ch.firstUploadDate).format('YYYY-MM-DD'):'-'}</div>
      </div>
      <div class="channel-actions">
        <button class="btn-danger" data-del="${ch.id}">삭제</button>
      </div>
      <div class="channel-insights">
        <div class="insights" id="ins-${ch.id}">
          <div><span class="k">전일대비</span> <span class="v">${diffStr}</span></div>
          <div><span class="k">평균조회</span> <span class="v">-</span></div>
          <div><span class="k">좋아요율</span> <span class="v">-</span></div>
          <div><span class="k">업로드빈도</span> <span class="v">-</span></div>
          <div><span class="k">평균길이</span> <span class="v">-</span></div>
          <div><span class="k">롱/숏</span> <span class="v">-</span></div>
          <div><span class="k">국가</span> <span class="v">${ch.country||'-'}</span></div>
          <div><span class="k">최다요일</span> <span class="v">-</span></div>
          <div style="grid-column:1/-1"><span class="k">카테고리</span> <span class="v">-</span></div>
        </div>
      </div>`;
    el.querySelector('[data-del]').onclick=async()=>{ if(confirm('채널을 삭제할까요?')){ await deleteChannel(ch.id); refreshAll('channels'); } };
    wrap.appendChild(el);
  }
}

/* 채널명/영상 검색 & URL 추가 (모달 내부) */
(function(){
  const CH_PSIZE=4; let chCache=[], chPage=1;
  const daysAgoStr=iso=>{ if(!iso) return '-'; const d=moment(iso); const diff=moment().diff(d,'days'); if(diff<=0) return '오늘'; if(diff===1) return '1일 전'; return `${diff}일 전`; };
  async function renderChPage(){
    const list=qs('ch-results'); if(!list) return; list.innerHTML='';
    const sort = (document.getElementById('ch-sort')||{}).value||'subs';
    const sorted=[...chCache].sort((a,b)=>{
      if(sort==='videos') return (parseInt(b.statistics?.videoCount||'0',10))-(parseInt(a.statistics?.videoCount||'0',10));
      if(sort==='latest') return new Date(b.latestUploadDate||0)-new Date(a.latestUploadDate||0);
      return (parseInt(b.statistics?.subscriberCount||'0',10))-(parseInt(a.statistics?.subscriberCount||'0',10));
    });
    const items=sorted.slice((chPage-1)*CH_PSIZE, chPage*CH_PSIZE);
    if(!items.length){ list.innerHTML='<div class="muted">결과가 없습니다.</div>'; const pg=qs('ch-pagination'); if(pg) pg.innerHTML=''; return; }
    items.forEach(ch=>{
      const row=document.createElement('div'); row.className='result-row';
      row.innerHTML=`
        <a href="https://www.youtube.com/channel/${ch.id}" target="_blank" rel="noopener"><img class="r-avatar" src="${ch.snippet.thumbnails?.default?.url||''}" alt=""></a>
        <div>
          <div class="r-title">${ch.snippet.title}</div>
          <div class="r-sub">${ch.snippet.description ? ch.snippet.description.substring(0,100)+'...' : '설명 없음'}</div>
          <div class="r-sub">구독자: ${fmt(ch.statistics?.subscriberCount||'0')} · 영상: ${fmt(ch.statistics?.videoCount||'0')} · 최신업로드: ${daysAgoStr(ch.latestUploadDate||'')}</div>
        </div>
        <button class="btn" data-add-ch="${ch.id}">추가</button>`;
      row.querySelector('[data-add-ch]').onclick=async()=>{
        const b=row.querySelector('[data-add-ch]'); const t=b.textContent; b.textContent='추가 중…'; b.disabled=true;
        try{ const ok=await addChannelById(ch.id); if(ok){ b.textContent='완료!'; b.style.background='#1db954'; setTimeout(()=>document.getElementById('modal-add').style.display='none',800);} else { b.textContent=t; b.disabled=false; } }
        catch{ b.textContent=t; b.disabled=false; toast('채널 추가 중 오류'); }
      };
      list.appendChild(row);
    });
    const total=Math.ceil(chCache.length/CH_PSIZE); const pg=qs('ch-pagination'); if(!pg) return; pg.innerHTML=''; if(total>1){ for(let i=1;i<=total;i++){ const btn=document.createElement('button'); btn.textContent=i; if(i===chPage){ btn.className='active'; } btn.onclick=()=>{chPage=i; renderChPage();}; pg.appendChild(btn);} }
  }
  async function searchChannels(){
    const q=qs('ch-query')?.value?.trim(); if(!q){ showError('ch-results','검색어를 입력해주세요.'); return; }
    qs('ch-results').innerHTML='<div class="muted">검색 중...</div>'; qs('ch-pagination').innerHTML='';
    const res=await yt('search',{part:'snippet',q,type:'channel',maxResults:25});
    if(!res.items?.length){ qs('ch-results').innerHTML='<div class="muted">검색 결과가 없습니다.</div>'; return; }
    const ids=res.items.map(i=>i.snippet.channelId).filter(Boolean);
    const details=await yt('channels',{part:'snippet,statistics,contentDetails',id:ids.join(',')});
    const enriched=[];
    for(const it of (details.items||[])){
      let latest=it.snippet.publishedAt;
      try{
        const upl=it.contentDetails?.relatedPlaylists?.uploads;
        if(upl){ const pl=await yt('playlistItems',{part:'snippet',playlistId:upl,maxResults:1}); if(pl.items?.[0]) latest=pl.items[0].snippet.publishedAt||latest; }
      }catch{}
      enriched.push({...it, latestUploadDate: latest});
    }
    chCache=enriched; chPage=1; renderChPage();
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const btn=qs('btn-ch-search'); if(btn) btn.onclick=searchChannels;
    const q=qs('ch-query'); if(q) q.onkeydown=e=>{ if(e.key==='Enter') searchChannels(); };
    const sel=document.getElementById('ch-sort'); if(sel) sel.onchange=()=>renderChPage();
  });

  /* 영상 검색(롱폼) */
  const VID_PSIZE=4; let vidCache=[], vidPage=1;
  async function renderVidPage(){
    const list=qs('vid-results'); if(!list) return; list.innerHTML='';
    const sort=(document.getElementById('vid-sort')||{}).value||'views';
    const sorted=[...vidCache].sort((a,b)=>{
      if(sort==='subs') return (parseInt(b.__ch?.subscriberCount||'0',10))-(parseInt(a.__ch?.subscriberCount||'0',10));
      if(sort==='date') return new Date(b.snippet.publishedAt)-new Date(a.snippet.publishedAt);
      return (parseInt(b.__vid?.viewCount||'0',10))-(parseInt(a.__vid?.viewCount||'0',10));
    });
    const items=sorted.slice((vidPage-1)*VID_PSIZE, vidPage*VID_PSIZE);
    if(!items.length){ list.innerHTML='<div class="muted">결과가 없습니다.</div>'; const pg=qs('vid-pagination'); if(pg) pg.innerHTML=''; return; }
    items.forEach(v=>{
      const row=document.createElement('div'); row.className='result-row';
      row.innerHTML=`
        <a href="https://www.youtube.com/watch?v=${v.id.videoId}" target="_blank" rel="noopener"><img class="r-thumb" src="${v.snippet.thumbnails?.default?.url||''}" alt=""></a>
        <div>
          <div class="r-title">${v.snippet.title}</div>
          <div class="r-sub">${v.snippet.channelTitle} · 채널 구독자: ${fmt(v.__ch?.subscriberCount)} · 채널 영상: ${fmt(v.__ch?.videoCount)} · 영상 조회수: ${fmt(v.__vid?.viewCount)} · 업로드: ${moment(v.snippet.publishedAt).format('YYYY-MM-DD')}</div>
        </div>
        <button class="btn" data-add-ch-from-vid="${v.snippet.channelId}">채널 추가</button>`;
      row.querySelector('[data-add-ch-from-vid]').onclick=async()=>{
        const b=row.querySelector('[data-add-ch-from-vid]'); const t=b.textContent; b.textContent='추가 중…'; b.disabled=true;
        try{ const ok=await addChannelById(v.snippet.channelId); if(ok){ b.textContent='완료!'; b.style.background='#1db954'; setTimeout(()=>document.getElementById('modal-add').style.display='none',800);} else { b.textContent=t; b.disabled=false; } }
        catch{ b.textContent=t; b.disabled=false; toast('채널 추가 중 오류'); }
      };
      list.appendChild(row);
    });
    const total=Math.ceil(vidCache.length/VID_PSIZE); const pg=qs('vid-pagination'); if(!pg) return; pg.innerHTML=''; if(total>1){ for(let i=1;i<=total;i++){ const btn=document.createElement('button'); btn.textContent=i; if(i===vidPage){ btn.className='active'; } btn.onclick=()=>{vidPage=i; renderVidPage();}; pg.appendChild(btn);} }
  }
  async function searchVideos(){
    const q=qs('vid-query')?.value?.trim(); if(!q) return;
    const res=await yt('search',{part:'snippet',q,type:'video',videoDuration:'long',maxResults:25});
    if(!res.items?.length){ qs('vid-results').innerHTML='<div class="muted">검색 결과가 없습니다.</div>'; const pg=qs('vid-pagination'); if(pg) pg.innerHTML=''; return; }
    const ids = res.items.map(i=>i.id.videoId||i.id).filter(Boolean);
    let stats = {items:[]};
    if(ids.length){
      try{ stats = await yt('videos',{part:'statistics', id: ids.join(',')}); }catch{}
    }
    const chIds = Array.from(new Set(res.items.map(i=>i.snippet.channelId).filter(Boolean)));
    let chs = {items:[]};
    if(chIds.length){
      try{ chs = await yt('channels',{part:'statistics', id: chIds.join(',')}); }catch(e){}
    }
    const statById = new Map(); (stats.items||[]).forEach(s=>statById.set(s.id, s.statistics||{}));
    const chStatById = new Map(); (chs.items||[]).forEach(c=>chStatById.set(c.id, c.statistics||{}));
    vidCache = res.items.map(it=>{
      return Object.assign({}, it, {
        __vid: statById.get(it.id.videoId||it.id)||{},
        __ch: {
          subscriberCount: parseInt((chStatById.get(it.snippet.channelId)||{}).subscriberCount||'0',10),
          videoCount: parseInt((chStatById.get(it.snippet.channelId)||{}).videoCount||'0',10)
        }
      });
    });
    vidPage=1; renderVidPage();
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const btn=qs('btn-vid-search'); if(btn) btn.onclick=searchVideos;
    const q=qs('vid-query'); if(q) q.onkeydown=e=>{ if(e.key==='Enter') searchVideos(); };
  });

  // URL 직접 추가
  document.addEventListener('DOMContentLoaded',()=>{
    const urlBtn=qs('btn-url-add'); if(urlBtn) urlBtn.onclick=async()=>{
      const input=qs('url-input'); const v=(input?.value||'').trim();
      if(!v){ showError('url-result','URL 또는 채널 ID를 입력해주세요.'); return; }
      let channelId=v;
      const match=v.match(/channel\/([A-Za-z0-9_\-]+)/); if(match) channelId=match[1];
      const btn=urlBtn; const t=btn.textContent; btn.textContent='추가 중…'; btn.disabled=true;
      try{ const ok=await addChannelById(channelId); if(ok){ showSuccess('url-result','채널이 추가되었습니다.'); input.value=''; setTimeout(()=>document.getElementById('modal-add').style.display='none',700);} }
      catch(e){ showError('url-result','채널 추가 실패: '+(e.message||e)); }
      finally{ btn.textContent=t; btn.disabled=false; }
    };
  });
})();