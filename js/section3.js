/* SECTION 3: 최신 영상 */
async function refreshLatest(){
  const channels=await getAllChannels(); const out=[];
  for(const ch of channels){
    await ensureUploadsAndLatest(ch); if(!ch.uploadsPlaylistId) continue;
    let next=null, found=null;
    while(!found){
      const pl=await yt('playlistItems',{part:'snippet,contentDetails',playlistId:ch.uploadsPlaylistId,maxResults:10,pageToken:next||''});
      const ids=(pl.items||[]).map(i=>i.contentDetails.videoId); if(!ids.length) break;
      const d=await yt('videos',{part:'snippet,statistics,contentDetails',id:ids.join(',')});
      for(const v of (d.items||[])){
        if(moment.duration(v.contentDetails.duration).asSeconds()>180){
          const views=parseInt(v.statistics.viewCount||'0',10); const subs=parseInt(ch.subscriberCount||'1',10);
          out.push({id:v.id,title:v.snippet.title,thumbnail:v.snippet.thumbnails?.medium?.url||`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,viewCount:views,publishedAt:v.snippet.publishedAt,mutantIndex:subs>0?(views/subs).toFixed(2):'0.00',__ch:{subscriberCount:subs}}); found=true; break;
        }
      }
      next=pl.nextPageToken; if(!next) break;
    }
  }
  sortVideoCards(out,qs('sort-latest').value); renderVideoList(out,'latest-list','latest-keywords');
}