/* SECTION 2: 돌연변이 영상 */
async function refreshMutant(){
  const channels=await getAllChannels(); let list=[]; let minDate=null;
  if(currentMutantPeriod!=='all'){ const n=currentMutantPeriod==='1m'?1:currentMutantPeriod==='3m'?3:6; minDate=moment().subtract(n,'months'); }
  for(const ch of channels){
    await ensureUploadsAndLatest(ch); if(!ch.uploadsPlaylistId) continue;
    let ids=[], next=null, stop=false;
    while(!stop){
      const pl=await yt('playlistItems',{part:'snippet,contentDetails',playlistId:ch.uploadsPlaylistId,maxResults:50,pageToken:next||''});
      const items=pl.items||[]; const filtered=minDate? items.filter(i=>moment(i.snippet.publishedAt).isAfter(minDate)):items;
      ids.push(...filtered.map(i=>i.contentDetails.videoId)); next=pl.nextPageToken; if(!next || (minDate && filtered.length<items.length)) stop=true;
    }
    for(let i=0;i<ids.length;i+=50){
      const d=await yt('videos',{part:'snippet,statistics,contentDetails',id:ids.slice(i,i+50).join(',')});
      (d.items||[]).forEach(v=>{
        const dur=seconds(v.contentDetails.duration); if(dur<=180) return;
        const views=parseInt(v.statistics.viewCount||'0',10); const subs=parseInt(ch.subscriberCount||'1',10); if(views<subs*2) return;
        list.push({id:v.id,title:v.snippet.title,thumbnail:v.snippet.thumbnails?.medium?.url||`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,viewCount:views,publishedAt:v.snippet.publishedAt,mutantIndex:(subs>0?(views/subs).toFixed(2):'0.00'),__ch:{subscriberCount:subs}});
      });
    }
  }
  sortVideoCards(list,qs('sort-mutant').value); renderVideoList(list,'mutant-list','mutant-keywords');
}