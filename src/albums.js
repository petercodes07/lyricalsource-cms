const {escape:e,layout,cmsUrl}=require('./views');
const {request}=require('./site-api');
const {cover,edit}=require('./library-ui');
module.exports=(app,requireLogin,sitePublic)=>{
  const curator=(req,res,next)=>req.user.role==='author'?res.status(403).send('Album editing requires an editor role'):next();
  function form(album,error='') {
    return `<h1>Edit album</h1>${error?`<p class="notice" role="alert">${e(error)}</p>`:''}<div class="album-summary">${cover(album.image,sitePublic,album.title)}<div><h2>${e(album.title)}</h2><p>${e(album.artistName)}</p><p>${e(album.slug)}</p></div></div><form class="card" method="post"><div class="row"><label>Album title<input name="title" required maxlength="300" value="${e(album.title)}"></label><label>Release date<input name="releaseDate" type="date" value="${e(album.releaseDate)}"></label></div><div class="row"><label>Artist name<input name="artistName" required maxlength="255" value="${e(album.artistName)}"></label><label>Artist slug<input name="artistSlug" required value="${e(album.artistSlug)}"></label></div><label>Cover image URL<input name="image" value="${e(album.image)}"></label><label>Description<textarea name="description" maxlength="20000">${e(album.description)}</textarea></label><p class="row actions"><button>Save album</button><a class="button secondary" href="${e(sitePublic+'/albums/'+album.slug)}" target="_blank" rel="noopener noreferrer">View album on website</a></p></form><h2>Track list (${(album.tracks||[]).length})</h2><div class="card"><table><tr><th>Track</th><th>Song</th><th>Artist</th><th>Actions</th></tr>${(album.tracks||[]).map(t=>`<tr><td>${Number(t.trackNumber)}</td><td>${e(t.songName||t.title)}</td><td>${e(t.artistName)}</td><td>${edit('/songs/'+Number(t.id),t.songName||t.title)}</td></tr>`).join('')||'<tr><td colspan="4">No tracks linked to this album.</td></tr>'}</table></div>${album.qa?.length?`<h2>Album questions</h2><div class="card">${album.qa.map(item=>`<h3>${e(item.question)}</h3><p>${e(item.answer)}</p>`).join('')}</div>`:''}`;
  }
  app.get('/albums',requireLogin,curator,async(req,res)=>{
    try {
      const q=String(req.query.q||'').slice(0,200),page=Math.max(1,Math.floor(Number(req.query.page)||1));
      const {albums,total}=await request('GET',`albums?q=${encodeURIComponent(q)}&page=${page}`);
      const rows=albums.map(a=>`<tr><td><div class="story-cell">${cover(a.image,sitePublic,a.title)}<div><a class="story-title" href="/albums/${Number(a.id)}">${e(a.title)}</a><span class="story-slug">${e(a.slug)}</span></div></div></td><td>${e(a.artistName)}</td><td>${e(a.releaseDate||'—')}</td><td>${Number(a.trackCount)}</td><td>${edit('/albums/'+Number(a.id),a.title)}</td></tr>`).join('');
      res.send(layout('Albums',req.user,`<h1>Albums</h1><p>Manage the albums already on LyricalSource.</p><form method="get"><label>Search albums or artists<input name="q" value="${e(q)}"></label><button>Search</button></form><div class="card table-card"><table><tr><th>Album</th><th>Artist</th><th>Release date</th><th>Tracks</th><th>Actions</th></tr>${rows||'<tr><td colspan="5">No albums found.</td></tr>'}</table></div><p>${Number(total)} albums</p><p>${page>1?`<a class="button secondary" href="/albums?page=${page-1}&q=${e(encodeURIComponent(q))}">Previous</a>`:''} ${page*50<total?`<a class="button secondary" href="/albums?page=${page+1}&q=${e(encodeURIComponent(q))}">Next</a>`:''}</p>`,req.query.notice));
    }catch(error){res.status(502).send(layout('Albums',req.user,'<h1>Albums unavailable</h1>',error.message));}
  });
  app.get('/albums/:id',requireLogin,curator,async(req,res)=>{
    try{const {album}=await request('GET',`albums?id=${encodeURIComponent(req.params.id)}`);res.send(layout('Edit album',req.user,form(album),req.query.notice));}
    catch(error){res.status(502).send(layout('Albums',req.user,'<h1>Cannot open album</h1>',error.message));}
  });
  app.post('/albums/:id',requireLogin,curator,async(req,res)=>{
    const id=Number(req.params.id);let album;
    try{
      album=(await request('GET',`albums?id=${id}`)).album;
      const fields={title:req.body.title,artistName:req.body.artistName,artistSlug:req.body.artistSlug,releaseDate:req.body.releaseDate,image:req.body.image,description:req.body.description};
      album={...album,...fields};await request('PUT','albums',{id,...fields});res.redirect(cmsUrl(`/albums/${id}?notice=Album+saved`));
    }catch(error){res.status(400).send(layout('Edit album',req.user,album?form(album,error.message):'<h1>Album unavailable</h1>',album?'':error.message));}
  });
};
